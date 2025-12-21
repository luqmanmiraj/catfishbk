// Load environment variables from .env file
require('dotenv').config();

const AWS = require('aws-sdk');

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
const SUBSCRIPTIONS_TABLE = process.env.SUBSCRIPTIONS_TABLE || 'image-analysis-dev-subscriptions';
const SCAN_COUNTS_TABLE = process.env.SCAN_COUNTS_TABLE || 'image-analysis-dev-scan-counts';
const USER_POOL_ID = process.env.COGNITO_USER_POOL_ID || '';

// Constants
const FREE_TIER_SCAN_LIMIT = 3;
const MONTHS = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'];

/**
 * Get current month key (YYYY-MM format)
 */
function getCurrentMonthKey() {
  const now = new Date();
  const year = now.getFullYear();
  const month = MONTHS[now.getMonth()];
  return `${year}-${month}`;
}

/**
 * Get subscription status for a user
 */
async function getSubscriptionStatus(userId) {
  try {
    const result = await dynamodb.get({
      TableName: SUBSCRIPTIONS_TABLE,
      Key: { userId: userId },
    }).promise();

    if (!result.Item) {
      // No subscription record, default to free
      return {
        tier: 'free',
        status: 'active',
        isPro: false,
      };
    }

    const subscription = result.Item;
    const isPro = subscription.tier === 'pro' && 
                  subscription.status === 'active' &&
                  (!subscription.expiresAt || new Date(subscription.expiresAt) > new Date());

    return {
      tier: subscription.tier || 'free',
      status: subscription.status || 'active',
      isPro: isPro,
      expiresAt: subscription.expiresAt,
    };
  } catch (error) {
    console.error('Error getting subscription status:', error);
    // Default to free tier on error
    return {
      tier: 'free',
      status: 'active',
      isPro: false,
    };
  }
}

/**
 * Get scan count for user in current month
 */
async function getScanCount(userId) {
  const monthKey = getCurrentMonthKey();
  
  try {
    const result = await dynamodb.get({
      TableName: SCAN_COUNTS_TABLE,
      Key: {
        userId: userId,
        monthKey: monthKey,
      },
    }).promise();

    return result.Item ? result.Item.count || 0 : 0;
  } catch (error) {
    console.error('Error getting scan count:', error);
    return 0;
  }
}

/**
 * Increment scan count for user
 */
async function incrementScanCount(userId) {
  const monthKey = getCurrentMonthKey();
  
  try {
    await dynamodb.update({
      TableName: SCAN_COUNTS_TABLE,
      Key: {
        userId: userId,
        monthKey: monthKey,
      },
      UpdateExpression: 'SET #count = if_not_exists(#count, :zero) + :inc, #updatedAt = :now',
      ExpressionAttributeNames: {
        '#count': 'count',
        '#updatedAt': 'updatedAt',
      },
      ExpressionAttributeValues: {
        ':zero': 0,
        ':inc': 1,
        ':now': new Date().toISOString(),
      },
    }).promise();
  } catch (error) {
    console.error('Error incrementing scan count:', error);
    // Non-fatal, log but continue
  }
}

/**
 * Check if user can perform a scan
 */
async function canUserScan(userId) {
  const subscription = await getSubscriptionStatus(userId);
  
  // Pro users have unlimited scans
  if (subscription.isPro) {
    return {
      canScan: true,
      reason: 'pro_subscription',
      scansRemaining: Infinity,
      scanLimit: Infinity,
    };
  }

  // Free users have limited scans
  const scanCount = await getScanCount(userId);
  const scansRemaining = Math.max(0, FREE_TIER_SCAN_LIMIT - scanCount);
  const canScan = scansRemaining > 0;

  return {
    canScan: canScan,
    reason: canScan ? 'free_tier_available' : 'free_tier_limit_reached',
    scansRemaining: scansRemaining,
    scanCount: scanCount,
    scanLimit: FREE_TIER_SCAN_LIMIT,
    subscription: subscription,
  };
}

/**
 * Lambda handler for subscription status check
 */
exports.handler = async (event) => {
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

    // GET /subscription/status - Get subscription status
    if ((method === 'GET' && path.includes('/status')) || method === 'GET') {
      const subscription = await getSubscriptionStatus(userId);
      const scanCount = await getScanCount(userId);
      const scanLimit = subscription.isPro ? Infinity : FREE_TIER_SCAN_LIMIT;
      const scansRemaining = subscription.isPro ? Infinity : Math.max(0, scanLimit - scanCount);

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          subscription: subscription,
          scanCount: scanCount,
          scanLimit: scanLimit,
          scansRemaining: scansRemaining,
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

    // POST /subscription/increment - Increment scan count (called after successful scan)
    if (method === 'POST' && path.includes('/increment')) {
      const subscription = await getSubscriptionStatus(userId);
      
      // Only increment for free users (pro users are unlimited)
      if (!subscription.isPro) {
        await incrementScanCount(userId);
      }

      const scanCount = await getScanCount(userId);
      const scanLimit = FREE_TIER_SCAN_LIMIT;
      const scansRemaining = Math.max(0, scanLimit - scanCount);

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          message: 'Scan count incremented',
          scanCount: subscription.isPro ? 0 : scanCount,
          scansRemaining: subscription.isPro ? Infinity : scansRemaining,
        }),
      };
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

