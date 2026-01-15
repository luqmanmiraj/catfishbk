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
const s3 = new AWS.S3();

/**
 * CORS headers
 */
function getCorsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Allow-Methods': 'GET,OPTIONS',
    'Content-Type': 'application/json',
  };
}

/**
 * Handle preflight OPTIONS request
 */
function handleOptions() {
  return {
    statusCode: 200,
    headers: getCorsHeaders(),
    body: '',
  };
}

/**
 * Check DynamoDB connectivity
 */
async function checkDynamoDB() {
  try {
    // Try to list tables (lightweight operation)
    const dynamodbService = new AWS.DynamoDB();
    await dynamodbService.listTables({ Limit: 1 }).promise();
    return { healthy: true, error: null };
  } catch (error) {
    return { healthy: false, error: error.message };
  }
}

/**
 * Check Cognito connectivity
 */
async function checkCognito() {
  try {
    const userPoolId = process.env.COGNITO_USER_POOL_ID;
    if (!userPoolId) {
      return { healthy: false, error: 'COGNITO_USER_POOL_ID not configured' };
    }
    
    await cognito.describeUserPool({ UserPoolId: userPoolId }).promise();
    return { healthy: true, error: null };
  } catch (error) {
    return { healthy: false, error: error.message };
  }
}

/**
 * Check S3 connectivity
 */
async function checkS3() {
  try {
    const bucketName = process.env.S3_BUCKET_NAME;
    if (!bucketName) {
      return { healthy: false, error: 'S3_BUCKET_NAME not configured' };
    }
    
    // Try to head the bucket (lightweight operation)
    await s3.headBucket({ Bucket: bucketName }).promise();
    return { healthy: true, error: null };
  } catch (error) {
    return { healthy: false, error: error.message };
  }
}

/**
 * Full health check - checks all services
 */
async function performHealthCheck() {
  const checks = {
    dynamodb: await checkDynamoDB(),
    cognito: await checkCognito(),
    s3: await checkS3(),
  };

  const allHealthy = Object.values(checks).every(check => check.healthy);
  const statusCode = allHealthy ? 200 : 503;

  return {
    statusCode,
    headers: getCorsHeaders(),
    body: JSON.stringify({
      status: allHealthy ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      checks,
    }),
  };
}

/**
 * Liveness probe - simple ping
 */
function performLivenessCheck() {
  return {
    statusCode: 200,
    headers: getCorsHeaders(),
    body: JSON.stringify({
      status: 'alive',
      timestamp: new Date().toISOString(),
    }),
  };
}

/**
 * Lambda handler
 */
exports.handler = async (event) => {
  console.log('Health check event:', JSON.stringify(event, null, 2));

  // Handle OPTIONS request
  if (event.httpMethod === 'OPTIONS') {
    return handleOptions();
  }

  const path = event.path || event.requestContext?.path || '';
  
  // Route to appropriate health check
  if (path.includes('/health/live') || path.includes('/live')) {
    return performLivenessCheck();
  }

  // Default to full health check
  return performHealthCheck();
};
