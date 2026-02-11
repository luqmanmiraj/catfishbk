// Load environment variables from .env file
require('dotenv').config();

const AWS = require('aws-sdk');
const { v4: uuidv4 } = require('uuid');
const { wrapHandler, captureException } = require('./middleware/errorHandler');

// Configure AWS SDK
const awsConfig = {
  region: process.env.AWS_REGION || 'us-east-1',
};

const isLambda = !!process.env.AWS_LAMBDA_FUNCTION_NAME;
if (!isLambda && process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
  awsConfig.accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  awsConfig.secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
}

AWS.config.update(awsConfig);

const dynamodb = new AWS.DynamoDB.DocumentClient();
const cognito = new AWS.CognitoIdentityServiceProvider();

// Configuration
const TOKENS_TABLE = process.env.TOKENS_TABLE || 'image-analysis-dev-tokens';
const PURCHASES_TABLE = process.env.PURCHASES_TABLE || 'image-analysis-dev-purchases';
const USER_POOL_ID = process.env.COGNITO_USER_POOL_ID || '';

// Legacy table names for backward compatibility (if needed)
const SUBSCRIPTIONS_TABLE = process.env.SUBSCRIPTIONS_TABLE || 'image-analysis-dev-subscriptions';
const SCAN_COUNTS_TABLE = process.env.SCAN_COUNTS_TABLE || 'image-analysis-dev-scan-counts';

// Token pack configurations
const TOKEN_PACKS = {
  'pack_15': { tokens: 15, price: 4.99 },
  'pack_50': { tokens: 50, price: 9.99 },
  'pack_100': { tokens: 100, price: 16.99 },
};

/**
 * Save purchase record to DynamoDB
 */
async function savePurchase(userId, packId, tokens, price, transactionId) {
  const purchaseId = `purchase-${Date.now()}-${uuidv4()}`;
  const purchaseDate = new Date().toISOString();
  
  const purchaseItem = {
    purchaseId: purchaseId,
    userId: userId,
    packId: packId,
    tokens: tokens,
    price: price,
    transactionId: transactionId || null,
    purchaseDate: purchaseDate,
    status: 'completed',
    createdAt: purchaseDate,
  };
  
  try {
    await dynamodb.put({
      TableName: PURCHASES_TABLE,
      Item: purchaseItem,
    }).promise();
    
    console.log(`✅ Purchase saved: ${purchaseId} for user ${userId}`);
    return purchaseItem;
  } catch (error) {
    console.error('Error saving purchase:', error);
    // Don't throw - purchase should still succeed even if logging fails
    return null;
  }
}

/**
 * Get token balance for a user
 */
async function getTokenBalance(userId) {
  try {
    console.log('🔍 getTokenBalance called with userId:', userId);
    console.log('  - Querying table:', TOKENS_TABLE);
    
    const result = await dynamodb.get({
      TableName: TOKENS_TABLE,
      Key: { userId: userId },
    }).promise();

    console.log('  - DynamoDB get result:', JSON.stringify(result, null, 2));

    if (!result.Item) {
      // No token record, default to 0
      console.log('  - ⚠️ No token record found for userId:', userId);
      return 0;
    }

    const balance = result.Item.balance || 0;
    console.log('  - ✅ Found token record, balance:', balance);
    return balance;
  } catch (error) {
    console.error('❌ Error getting token balance:', error);
    console.error('  - Error details:', {
      message: error.message,
      code: error.code,
      userId: userId,
      tableName: TOKENS_TABLE,
    });
    return 0;
  }
}

/**
 * Decrement token balance by 1 (used when a scan is performed)
 */
async function decrementToken(userId) {
  try {
    const result = await dynamodb.update({
      TableName: TOKENS_TABLE,
      Key: { userId: userId },
      UpdateExpression: 'SET #balance = if_not_exists(#balance, :zero) - :dec, #updatedAt = :now',
      ConditionExpression: '#balance > :zero',
      ExpressionAttributeNames: {
        '#balance': 'balance',
        '#updatedAt': 'updatedAt',
      },
      ExpressionAttributeValues: {
        ':zero': 0,
        ':dec': 1,
        ':now': new Date().toISOString(),
      },
      ReturnValues: 'ALL_NEW',
    }).promise();

    return result.Attributes.balance;
  } catch (error) {
    if (error.code === 'ConditionalCheckFailedException') {
      // User has 0 tokens
      throw new Error('Insufficient tokens');
    }
    console.error('Error decrementing token:', error);
    throw error;
  }
}

/**
 * Add tokens to user balance (used when purchasing a token pack)
 */
async function addTokens(userId, amount) {
  try {
    const result = await dynamodb.update({
      TableName: TOKENS_TABLE,
      Key: { userId: userId },
      UpdateExpression: 'SET #balance = if_not_exists(#balance, :zero) + :amount, #updatedAt = :now',
      ExpressionAttributeNames: {
        '#balance': 'balance',
        '#updatedAt': 'updatedAt',
      },
      ExpressionAttributeValues: {
        ':zero': 0,
        ':amount': amount,
        ':now': new Date().toISOString(),
      },
      ReturnValues: 'ALL_NEW',
    }).promise();

    return result.Attributes.balance;
  } catch (error) {
    console.error('Error adding tokens:', error);
    throw error;
  }
}

/**
 * Check if user can perform a scan
 */
async function canUserScan(userId) {
  const tokenBalance = await getTokenBalance(userId);
  const canScan = tokenBalance > 0;

  return {
    canScan: canScan,
    reason: canScan ? 'tokens_available' : 'no_tokens',
    scansRemaining: tokenBalance,
    tokenBalance: tokenBalance,
  };
}

/**
 * Lambda handler for subscription status check (wrapped with Sentry)
 */
const handler = async (event) => {
  console.log('Subscription handler event:', JSON.stringify(event, null, 2));

  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  };

  // Handle preflight OPTIONS request
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: '',
    };
  }

  try {
    // Extract user ID from headers or body
    let userId = null;

    // Try to get from Authorization header (Cognito token)
    if (event.headers && event.headers.Authorization) {
      try {
        const token = event.headers.Authorization.replace('Bearer ', '');
        // Decode JWT to get user ID (simplified - in production use proper JWT library)
        const tokenParts = token.split('.');
        if (tokenParts.length === 3) {
          const payload = JSON.parse(Buffer.from(tokenParts[1], 'base64').toString());
          userId = payload.sub || payload['cognito:username'];
        }
      } catch (tokenError) {
        console.warn('Error extracting user ID from token:', tokenError.message);
      }
    }

    // Fallback: get from request body or query string
    if (!userId) {
      const body = typeof event.body === 'string' ? JSON.parse(event.body || '{}') : (event.body || {});
      const queryParams = event.queryStringParameters || {};
      userId = body.userId || queryParams.userId || body.user_id || queryParams.user_id;
    }

    if (!userId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          success: false,
          error: 'User ID is required',
        }),
      };
    }

    // Determine action based on path or method
    const path = event.path || '';
    const method = event.httpMethod || 'GET';

    // GET /subscription/status - Get token balance (maintained for backward compatibility)
    if ((method === 'GET' && path.includes('/status')) || method === 'GET') {
      console.log('📊 GET /subscription/status - Fetching token balance');
      console.log('  - Extracted userId:', userId);
      console.log('  - Table name:', TOKENS_TABLE);
      
      const tokenBalance = await getTokenBalance(userId);
      
      console.log('  - Token balance from DB:', tokenBalance);
      console.log('  - Returning response with tokenBalance:', tokenBalance);

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          tokenBalance: tokenBalance,
          scansRemaining: tokenBalance,
          // Legacy fields for backward compatibility
          subscription: {
            tier: 'token',
            status: 'active',
            isPro: false,
          },
          scanCount: 0,
          scanLimit: Infinity,
        }),
      };
    }

    // POST /subscription/check - Check if user can scan
    if (method === 'POST' && path.includes('/check')) {
      const checkResult = await canUserScan(userId);
      
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          ...checkResult,
        }),
      };
    }

    // POST /subscription/decrement - Decrement token (called after successful scan)
    if (method === 'POST' && path.includes('/decrement')) {
      try {
        const newBalance = await decrementToken(userId);

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            success: true,
            message: 'Token decremented',
            tokenBalance: newBalance,
            scansRemaining: newBalance,
          }),
        };
      } catch (error) {
        if (error.message === 'Insufficient tokens') {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({
              success: false,
              error: 'Insufficient tokens',
              tokenBalance: await getTokenBalance(userId),
              scansRemaining: await getTokenBalance(userId),
            }),
          };
        }
        throw error;
      }
    }

    // POST /subscription/purchase - Add tokens after purchase
    if (method === 'POST' && path.includes('/purchase')) {
      const body = typeof event.body === 'string' ? JSON.parse(event.body || '{}') : (event.body || {});
      const { packId, transactionId } = body;

      if (!packId || !TOKEN_PACKS[packId]) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({
            success: false,
            error: 'Invalid pack ID',
          }),
        };
      }

      try {
        const pack = TOKEN_PACKS[packId];
        const newBalance = await addTokens(userId, pack.tokens);

        // Save purchase record to DynamoDB
        await savePurchase(userId, packId, pack.tokens, pack.price, transactionId);

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            success: true,
            message: 'Tokens added successfully',
            tokenBalance: newBalance,
            scansRemaining: newBalance,
            packPurchased: packId,
            tokensAdded: pack.tokens,
          }),
        };
      } catch (error) {
        console.error('Error adding tokens:', error);
        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({
            success: false,
            error: error.message,
          }),
        };
      }
    }

    // POST /subscription/test/add-tokens - TEST ENDPOINT: Manually add tokens for testing
    // This endpoint allows you to add any number of tokens for testing purposes
    // Usage: POST /subscription/test/add-tokens with body: { userId: "...", tokens: 10 }
    if (method === 'POST' && path.includes('/test/add-tokens')) {
      const body = typeof event.body === 'string' ? JSON.parse(event.body || '{}') : (event.body || {});
      const { tokens: tokensToAdd } = body;
      
      // Allow userId to be passed in body for testing (or use extracted userId)
      const testUserId = body.userId || userId;

      if (!testUserId) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({
            success: false,
            error: 'User ID is required. Provide userId in request body or Authorization header.',
          }),
        };
      }

      if (!tokensToAdd || typeof tokensToAdd !== 'number' || tokensToAdd <= 0) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({
            success: false,
            error: 'Invalid tokens amount. Must be a positive number.',
          }),
        };
      }

      try {
        const newBalance = await addTokens(testUserId, tokensToAdd);

        console.log(`[TEST] Manual token addition: userId=${testUserId}, tokens=${tokensToAdd}, newBalance=${newBalance}`);

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            success: true,
            message: `Successfully added ${tokensToAdd} tokens for testing`,
            tokenBalance: newBalance,
            scansRemaining: newBalance,
            tokensAdded: tokensToAdd,
            userId: testUserId,
            note: 'This is a test endpoint for development purposes',
          }),
        };
      } catch (error) {
        console.error('Error adding test tokens:', error);
        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({
            success: false,
            error: error.message,
          }),
        };
      }
    }

    return {
      statusCode: 404,
      headers,
      body: JSON.stringify({
        success: false,
        error: 'Endpoint not found',
      }),
    };
  } catch (error) {
    console.error('Error in subscription handler:', error);

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: error.message,
      }),
    };
  }
};

// Wrap handler with Sentry error tracking
exports.handler = wrapHandler(handler);
