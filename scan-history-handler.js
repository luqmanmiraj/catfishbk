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

// Configuration
const SCAN_HISTORY_TABLE = process.env.SCAN_HISTORY_TABLE || 'image-analysis-dev-scan-history';

/**
 * Extract token from request headers
 */
function extractToken(event) {
  const requestHeaders = event.headers || {};
  const authHeader = requestHeaders.Authorization || requestHeaders.authorization;
  
  if (!authHeader) {
    return null;
  }
  
  // Remove 'Bearer ' prefix if present
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  return token || null;
}

/**
 * Extract Cognito user ID from JWT token
 */
function getCognitoUserIdFromToken(token) {
  if (!token) {
    return null;
  }
  
  try {
    // Decode JWT to get user ID
    const tokenParts = token.split('.');
    if (tokenParts.length !== 3) {
      console.warn('Invalid JWT token format: expected 3 parts, got', tokenParts.length);
      return null;
    }
    
    // Decode the payload (second part)
    let payload;
    try {
      payload = JSON.parse(Buffer.from(tokenParts[1], 'base64').toString());
    } catch (e) {
      // Try base64url encoding
      const base64Url = tokenParts[1].replace(/-/g, '+').replace(/_/g, '/');
      const base64 = base64Url + '='.repeat((4 - base64Url.length % 4) % 4);
      payload = JSON.parse(Buffer.from(base64, 'base64').toString());
    }
    
    const userId = payload.sub || payload['cognito:username'] || payload.username;
    return userId;
  } catch (tokenError) {
    console.error('Error extracting user ID from token:', tokenError.message);
    return null;
  }
}

/**
 * Extract user ID from request
 */
function extractUserId(event) {
  const token = extractToken(event);
  if (token) {
    return getCognitoUserIdFromToken(token);
  }
  
  // Fallback: get from query string
  const queryParams = event.queryStringParameters || {};
  return queryParams.userId || queryParams.user_id || null;
}

/**
 * Get scan history for a user
 */
async function getScanHistory(userId, limit = 50, lastEvaluatedKey = null) {
  if (!userId) {
    throw new Error('User ID is required');
  }

  const params = {
    TableName: SCAN_HISTORY_TABLE,
    KeyConditionExpression: 'userId = :userId',
    ExpressionAttributeValues: {
      ':userId': userId,
    },
    ScanIndexForward: false, // Sort descending (newest first)
    Limit: limit,
  };

  if (lastEvaluatedKey) {
    params.ExclusiveStartKey = lastEvaluatedKey;
  }

  try {
    const result = await dynamodb.query(params).promise();
    return {
      items: result.Items || [],
      lastEvaluatedKey: result.LastEvaluatedKey || null,
      count: result.Count || 0,
    };
  } catch (error) {
    console.error('Error getting scan history:', error);
    throw error;
  }
}

/**
 * Lambda handler
 */
exports.handler = async (event) => {
  console.log('Scan history handler event:', JSON.stringify(event, null, 2));

  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Allow-Methods': 'GET,OPTIONS',
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
    // Extract user ID from token
    const userId = extractUserId(event);
    
    if (!userId) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({
          success: false,
          error: 'Unauthorized: User ID is required. Please provide a valid authentication token.',
        }),
      };
    }

    // Get query parameters
    const queryParams = event.queryStringParameters || {};
    const limit = parseInt(queryParams.limit || '50', 10);
    const lastEvaluatedKey = queryParams.lastEvaluatedKey 
      ? JSON.parse(decodeURIComponent(queryParams.lastEvaluatedKey))
      : null;

    // Validate limit
    if (limit < 1 || limit > 100) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          success: false,
          error: 'Invalid limit. Limit must be between 1 and 100.',
        }),
      };
    }

    // Get scan history
    const history = await getScanHistory(userId, limit, lastEvaluatedKey);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        scans: history.items,
        count: history.count,
        hasMore: !!history.lastEvaluatedKey,
        lastEvaluatedKey: history.lastEvaluatedKey,
      }),
    };
  } catch (error) {
    console.error('Error processing scan history request:', error);
    
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: error.message || 'Internal server error',
      }),
    };
  }
};
