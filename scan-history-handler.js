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
 * Update scan history item (label and note)
 */
async function updateScanHistory(userId, scanId, updateData) {
  if (!userId) {
    throw new Error('User ID is required');
  }
  
  if (!scanId) {
    throw new Error('Scan ID is required');
  }

  // First, verify the scan belongs to the user
  try {
    const getParams = {
      TableName: SCAN_HISTORY_TABLE,
      Key: {
        userId: userId,
        scanId: scanId,
      },
    };
    
    const existingItem = await dynamodb.get(getParams).promise();
    
    if (!existingItem.Item) {
      throw new Error('Scan not found or access denied');
    }
    
    // Build update expression
    const updateExpressions = [];
    const expressionAttributeNames = {};
    const expressionAttributeValues = {};
    
    if (updateData.label !== undefined) {
      updateExpressions.push('#label = :label');
      expressionAttributeNames['#label'] = 'label';
      expressionAttributeValues[':label'] = updateData.label || null;
    }
    
    if (updateData.note !== undefined) {
      updateExpressions.push('#note = :note');
      expressionAttributeNames['#note'] = 'note';
      expressionAttributeValues[':note'] = updateData.note || null;
    }
    
    if (updateExpressions.length === 0) {
      throw new Error('No fields to update');
    }
    
    const updateParams = {
      TableName: SCAN_HISTORY_TABLE,
      Key: {
        userId: userId,
        scanId: scanId,
      },
      UpdateExpression: `SET ${updateExpressions.join(', ')}`,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
      ReturnValues: 'ALL_NEW',
    };
    
    const result = await dynamodb.update(updateParams).promise();
    
    console.log(`✅ Scan history updated successfully for user: ${userId}, scan: ${scanId}`);
    return result.Attributes;
  } catch (error) {
    console.error('Error updating scan history:', error);
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
    'Access-Control-Allow-Methods': 'GET,PATCH,PUT,OPTIONS',
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

    // Handle PATCH/PUT requests for updating scan history
    if (event.httpMethod === 'PATCH' || event.httpMethod === 'PUT') {
      // Extract scanId from path parameters or body
      let scanId = null;
      let updateData = {};
      
      // Try to get scanId from path parameters (e.g., /scan-history/{scanId})
      if (event.pathParameters && event.pathParameters.scanId) {
        scanId = event.pathParameters.scanId;
      }
      
      // Parse request body
      let body = {};
      if (event.body) {
        try {
          body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
        } catch (e) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({
              success: false,
              error: 'Invalid request body',
            }),
          };
        }
      }
      
      // Get scanId from body if not in path
      if (!scanId && body.scanId) {
        scanId = body.scanId;
      }
      
      if (!scanId) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({
            success: false,
            error: 'Scan ID is required',
          }),
        };
      }
      
      // Extract label and note from body
      if (body.label !== undefined) {
        updateData.label = body.label;
      }
      if (body.note !== undefined) {
        updateData.note = body.note;
      }
      
      if (Object.keys(updateData).length === 0) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({
            success: false,
            error: 'No fields to update. Provide label and/or note.',
          }),
        };
      }
      
      // Update scan history
      const updatedScan = await updateScanHistory(userId, scanId, updateData);
      
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          scan: updatedScan,
        }),
      };
    }

    // Handle GET requests for retrieving scan history
    if (event.httpMethod === 'GET') {
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
    }

    // Method not allowed
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({
        success: false,
        error: 'Method not allowed',
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
