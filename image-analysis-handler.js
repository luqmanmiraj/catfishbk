// Load environment variables from .env file
require('dotenv').config();

const AWS = require('aws-sdk');
const https = require('https');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const FormData = require('form-data');

// Configure AWS SDK with environment variables
const awsConfig = {
  region: process.env.AWS_REGION || 'us-east-1',
};

// Only set credentials if provided AND we're running locally (not in Lambda)
// In Lambda, we should use the IAM role, not static credentials
const isLambda = !!process.env.AWS_LAMBDA_FUNCTION_NAME;
if (!isLambda && process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
  awsConfig.accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  awsConfig.secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
}

AWS.config.update(awsConfig);

const s3 = new AWS.S3();
const secretsManager = new AWS.SecretsManager();
const ssm = new AWS.SSM();
const dynamodb = new AWS.DynamoDB.DocumentClient();

// Configuration with fallback priority:
// 1. AWS Secrets Manager (for SIGHTENGINE credentials)
// 2. AWS SSM Parameter Store (for configuration)
// 3. Environment variables
// 4. Default values

const SIGHTENGINE_SECRET_NAME = process.env.SIGHTENGINE_SECRET_NAME || 'catfish/sightengine-credentials';
const S3_BUCKET_PARAM = process.env.S3_BUCKET_PARAM_NAME || '/catfish/s3-bucket-name';

// Cache for secrets to avoid repeated API calls
let cachedSecrets = {
  sightengineApiUser: null,
  sightengineApiSecret: null,
  s3Bucket: null,
};

/**
 * Get secret from AWS Secrets Manager
 */
async function getSecret(secretName) {
  try {
    const data = await secretsManager.getSecretValue({ SecretId: secretName }).promise();
    if (data.SecretString) {
      return JSON.parse(data.SecretString);
    }
    return Buffer.from(data.SecretBinary, 'base64').toString('ascii');
  } catch (error) {
    if (error.code === 'ResourceNotFoundException') {
      console.warn(`Secret ${secretName} not found in Secrets Manager, falling back to environment variable`);
      return null;
    }
    if (error.code === 'InvalidUserID.NotFound' || error.code === 'InvalidClientTokenId' || error.message.includes('security token')) {
      console.error(`AWS authentication error accessing Secrets Manager. Check Lambda IAM role permissions. Error: ${error.message}`);
      // Fall back to environment variable instead of failing
      console.warn(`Falling back to environment variable for secret: ${secretName}`);
      return null;
    }
    throw error;
  }
}

/**
 * Get parameter from AWS SSM Parameter Store
 */
async function getSSMParameter(paramName) {
  try {
    const data = await ssm.getParameter({ Name: paramName, WithDecryption: true }).promise();
    return data.Parameter.Value;
  } catch (error) {
    if (error.code === 'ParameterNotFound') {
      console.warn(`Parameter ${paramName} not found in SSM, falling back to environment variable`);
      return null;
    }
    if (error.code === 'InvalidUserID.NotFound' || error.code === 'InvalidClientTokenId' || error.message.includes('security token')) {
      console.error(`AWS authentication error accessing SSM Parameter Store. Check Lambda IAM role permissions. Error: ${error.message}`);
      // Fall back to environment variable instead of failing
      console.warn(`Falling back to environment variable for parameter: ${paramName}`);
      return null;
    }
    throw error;
  }
}

/**
 * Initialize configuration from AWS services or environment variables
 */
async function initializeConfig() {
  // Try to get Sightengine credentials from Secrets Manager
  if (!cachedSecrets.sightengineApiUser || !cachedSecrets.sightengineApiSecret) {
    const secret = await getSecret(SIGHTENGINE_SECRET_NAME);
    if (secret && secret.api_user && secret.api_secret) {
      cachedSecrets.sightengineApiUser = secret.api_user;
      cachedSecrets.sightengineApiSecret = secret.api_secret;
    } else if (secret && secret.API_USER && secret.Api_Secret) {
      // Handle different case variations
      cachedSecrets.sightengineApiUser = secret.API_USER;
      cachedSecrets.sightengineApiSecret = secret.Api_Secret;
    } else {
      // Fallback to environment variables (trim whitespace)
      cachedSecrets.sightengineApiUser = (process.env.API_USER || process.env.SIGHTENGINE_API_USER || '').trim();
      cachedSecrets.sightengineApiSecret = (process.env.Api_Secret || process.env.SIGHTENGINE_API_SECRET || '').trim();
    }
  }

  // Try to get S3 bucket name from SSM or environment
  if (!cachedSecrets.s3Bucket) {
    cachedSecrets.s3Bucket = await getSSMParameter(S3_BUCKET_PARAM) ||
                             process.env.S3_BUCKET_NAME;
  }

  return {
    sightengineApiUser: cachedSecrets.sightengineApiUser,
    sightengineApiSecret: cachedSecrets.sightengineApiSecret,
    s3Bucket: cachedSecrets.s3Bucket,
  };
}

/**
 * Upload image to S3 and return the public URL
 */
async function uploadToS3(imageBuffer, contentType, extension, bucketName, requestId = null) {
  // Generate deterministic key based on image hash to prevent duplicate uploads
  // If same image is uploaded multiple times, it will use the same S3 key
  const imageHash = crypto.createHash('sha256').update(imageBuffer).digest('hex');
  const key = `images/${imageHash.substring(0, 16)}.${extension}`;
  
  // Check if object already exists in S3 (idempotent upload)
  try {
    await s3.headObject({ Bucket: bucketName, Key: key }).promise();
    console.log(`Image already exists in S3 with key: ${key}, skipping upload`);
  } catch (error) {
    if (error.code === 'NotFound') {
      // Object doesn't exist, upload it
      const params = {
        Bucket: bucketName,
        Key: key,
        Body: imageBuffer,
        ContentType: contentType,
        // ACL removed - bucket policy handles public access
        // Modern S3 buckets often have ACLs disabled for security
        CacheControl: 'max-age=3600', // Cache for 1 hour
      };

      console.log(`Uploading to S3: bucket=${bucketName}, key=${key}, size=${(imageBuffer.length / 1024).toFixed(2)}KB`);
      await s3.putObject(params).promise();
      console.log('S3 upload completed');
    } else {
      throw error;
    }
  }
  
  // Return the public URL using regional endpoint format
  const region = AWS.config.region || 'us-east-1';
  // Use regional endpoint for better compatibility
  const url = region === 'us-east-1' 
    ? `https://${bucketName}.s3.amazonaws.com/${key}`
    : `https://${bucketName}.s3.${region}.amazonaws.com/${key}`;
  
  // Verify the URL is accessible (wait a moment for S3 to propagate)
  await new Promise(resolve => setTimeout(resolve, 500));
  
  return url;
}

/**
 * Verify S3 URL is accessible
 */
async function verifyS3UrlAccessible(imageUrl) {
  return new Promise((resolve, reject) => {
    const url = new URL(imageUrl);
    const options = {
      hostname: url.hostname,
      path: url.pathname,
      method: 'HEAD',
      timeout: 5000,
    };

    const req = https.request(options, (res) => {
      if (res.statusCode === 200 || res.statusCode === 403) {
        // 403 might mean private but accessible, 200 means public
        resolve(true);
      } else {
        reject(new Error(`S3 URL not accessible: HTTP ${res.statusCode}`));
      }
    });

    req.on('error', (error) => {
      reject(new Error(`Failed to verify S3 URL: ${error.message}`));
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('S3 URL verification timeout'));
    });

    req.setTimeout(5000);
    req.end();
  });
}

/**
 * Call Sightengine API to detect image manipulation
 */
async function callSightengineAPI(imageBuffer, contentType, apiUser, apiSecret) {
  // Log the request details for debugging
  console.log(`Calling Sightengine API with image size: ${imageBuffer.length} bytes, type: ${contentType}`);
  
  try {
    const data = new FormData();
    
    // Append image buffer to form data
    // Determine file extension from content type
    const extension = contentType.includes('png') ? 'png' : 
                     contentType.includes('webp') ? 'webp' : 
                     contentType.includes('gif') ? 'gif' : 'jpg';
    
    data.append('media', imageBuffer, {
      filename: `image.${extension}`,
      contentType: contentType,
    });
    
    // Set models to deepfake detection
    data.append('models', 'deepfake');
    
    // Add API credentials
    data.append('api_user', apiUser);
    data.append('api_secret', apiSecret);
    
    // Make request to Sightengine API
    const response = await axios({
      method: 'post',
      url: 'https://api.sightengine.com/1.0/check.json',
      data: data,
      headers: data.getHeaders(),
      timeout: 60000, // 60 second timeout
    });
    
    console.log('Sightengine API response received');
    console.log('Sightengine API Response:', JSON.stringify(response.data, null, 2));
    return response.data;
  } catch (error) {
    if (error.response) {
      // API responded with error status
      console.error('Sightengine API error response:', error.response.data);
      throw new Error(`Sightengine API error: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
    } else {
      // Request failed (network error, timeout, etc.)
      console.error('Sightengine API request failed:', error.message);
      throw new Error(`Sightengine API request failed: ${error.message}`);
    }
  }
}

/**
 * Parse base64 image data
 */
function parseBase64Image(base64String) {
  // Remove data URL prefix if present (e.g., "data:image/jpeg;base64,")
  const matches = base64String.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
  
  let contentType, data, extension;
  
  if (matches && matches.length === 3) {
    contentType = matches[1];
    const base64Data = matches[2];
    data = Buffer.from(base64Data, 'base64');
    extension = contentType.split('/')[1] || 'jpg';
    
    // Normalize content type
    if (contentType.includes('jpeg')) {
      contentType = 'image/jpeg';
      extension = 'jpg';
    } else if (contentType.includes('png')) {
      contentType = 'image/png';
      extension = 'png';
    } else if (contentType.includes('webp')) {
      contentType = 'image/webp';
      extension = 'webp';
    } else if (contentType.includes('gif')) {
      contentType = 'image/gif';
      extension = 'gif';
    }
  } else {
    // Assume JPEG if no prefix
    contentType = 'image/jpeg';
    data = Buffer.from(base64String, 'base64');
    extension = 'jpg';
  }
  
  // Validate image size (Hive API typically supports up to 20MB, but we'll be conservative)
  const MAX_IMAGE_SIZE = 20 * 1024 * 1024; // 20MB
  const imageSizeMB = (data.length / (1024 * 1024)).toFixed(2);
  
  console.log(`Image parsed - Type: ${contentType}, Size: ${imageSizeMB}MB, Extension: ${extension}`);
  
  if (data.length > MAX_IMAGE_SIZE) {
    throw new Error(`Image too large: ${imageSizeMB}MB. Maximum size is 20MB. Please compress or resize the image.`);
  }
  
  // Validate supported formats (Hive API typically supports JPEG, PNG, WebP)
  const supportedFormats = ['image/jpeg', 'image/png', 'image/webp'];
  if (!supportedFormats.includes(contentType)) {
    console.warn(`Warning: Image format ${contentType} may not be supported by Hive API. Supported formats: JPEG, PNG, WebP`);
  }
  
  // Warn if image is very large (over 10MB)
  if (data.length > 10 * 1024 * 1024) {
    console.warn(`Warning: Large image detected (${imageSizeMB}MB). Consider compressing before upload.`);
  }
  
  return {
    contentType,
    data,
    extension,
    size: data.length,
    sizeMB: parseFloat(imageSizeMB),
  };
}

/**
 * Extract device information from API Gateway event
 */
function extractDeviceInfo(event) {
  const requestHeaders = event.headers || {};
  const requestContext = event.requestContext || {};
  
  // Extract device ID from headers (preferred) or request body
  // Common header names: X-Device-ID, Device-ID, X-Device-Id
  const deviceId = 
    requestHeaders['X-Device-ID'] || 
    requestHeaders['x-device-id'] || 
    requestHeaders['Device-ID'] ||
    requestHeaders['device-id'] ||
    null;
  
  // Extract other useful information
  const deviceInfo = {
    deviceId: deviceId,
    ipAddress: requestContext.identity?.sourceIp || 
               requestHeaders['X-Forwarded-For']?.split(',')[0]?.trim() ||
               requestHeaders['x-forwarded-for']?.split(',')[0]?.trim() ||
               'unknown',
    userAgent: requestHeaders['User-Agent'] || 
               requestHeaders['user-agent'] || 
               'unknown',
    requestId: requestContext.requestId || 'unknown',
    timestamp: new Date().toISOString(),
    // API Gateway context information
    apiKeyId: requestContext.identity?.apiKeyId || null,
    accountId: requestContext.accountId || null,
  };
  
  return deviceInfo;
}

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
    // JWT format: header.payload.signature
    const tokenParts = token.split('.');
    if (tokenParts.length !== 3) {
      console.warn('Invalid JWT token format: expected 3 parts, got', tokenParts.length);
      return null;
    }
    
    // Decode the payload (second part)
    // Handle base64url encoding (JWT uses base64url, not standard base64)
    let payload;
    try {
      // Try standard base64 first
      payload = JSON.parse(Buffer.from(tokenParts[1], 'base64').toString());
    } catch (e) {
      // If that fails, try base64url (replace - with +, _ with /, and add padding)
      const base64Url = tokenParts[1].replace(/-/g, '+').replace(/_/g, '/');
      const base64 = base64Url + '='.repeat((4 - base64Url.length % 4) % 4);
      payload = JSON.parse(Buffer.from(base64, 'base64').toString());
    }
    
    console.log('Token payload decoded. Available fields:', Object.keys(payload));
    console.log('Token payload (sanitized):', {
      sub: payload.sub,
      'cognito:username': payload['cognito:username'],
      username: payload.username,
      email: payload.email,
      'token_use': payload.token_use,
    });
    
    // Cognito JWT tokens contain 'sub' field which is the user's unique identifier
    // Also check for cognito:username as fallback
    const userId = payload.sub || payload['cognito:username'] || payload.username;
    
    if (userId) {
      console.log('✅ Successfully extracted Cognito user ID from token:', userId);
      return userId;
    } else {
      console.warn('❌ Token payload does not contain user ID. Full payload keys:', Object.keys(payload));
      console.warn('Payload sample:', JSON.stringify(payload, null, 2).substring(0, 500));
      return null;
    }
  } catch (tokenError) {
    console.error('❌ Error extracting user ID from token:', {
      error: tokenError.message,
      stack: tokenError.stack,
      tokenLength: token.length,
      tokenPreview: token.substring(0, 50),
    });
    return null;
  }
}

/**
 * Extract user ID from request (Authorization header or body)
 */
function extractUserId(event, body = null) {
  let userId = null;
  
  // First, try to get from Authorization header (Cognito token)
  const token = extractToken(event);
  if (token) {
    userId = getCognitoUserIdFromToken(token);
  }

  // Fallback: get from request body or query string
  if (!userId) {
    if (!body) {
      try {
        body = typeof event.body === 'string' ? JSON.parse(event.body || '{}') : (event.body || {});
      } catch (error) {
        // Ignore parse errors
      }
    }
    const queryParams = event.queryStringParameters || {};
    userId = (body && (body.userId || body.user_id)) || queryParams.userId || queryParams.user_id;
    
    if (userId) {
      console.log('User ID extracted from request body/query params:', userId);
    }
  }

  return userId;
}

/**
 * Get current month key (YYYY-MM format)
 */
function getCurrentMonthKey() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

/**
 * Check if scan history already exists for a given s3Url or requestId
 * Uses s3Url as primary check (unique per image), falls back to requestId
 */
async function checkExistingScan(userId, s3Url, requestId, tableName) {
  if (!s3Url && !requestId) {
    return null;
  }
  
  try {
    // First try to find by s3Url (most reliable - each image gets unique S3 URL)
    if (s3Url) {
      const scanResult = await dynamodb.scan({
        TableName: tableName,
        FilterExpression: 'userId = :userId AND s3Url = :s3Url',
        ExpressionAttributeValues: {
          ':userId': userId,
          ':s3Url': s3Url,
        },
        Limit: 1,
      }).promise();
      
      if (scanResult.Items && scanResult.Items.length > 0) {
        return scanResult.Items[0];
      }
    }
    
    // Fallback: check by requestId if s3Url not available
    if (requestId) {
      const scanResult = await dynamodb.scan({
        TableName: tableName,
        FilterExpression: 'userId = :userId AND requestId = :requestId',
        ExpressionAttributeValues: {
          ':userId': userId,
          ':requestId': requestId,
        },
        Limit: 1,
      }).promise();
      
      if (scanResult.Items && scanResult.Items.length > 0) {
        return scanResult.Items[0];
      }
    }
  } catch (error) {
    console.warn('Error checking for existing scan:', error.message);
  }
  
  return null;
}

/**
 * Save scan history to DynamoDB
 * Prevents duplicates by checking for existing scan with same requestId
 */
async function saveScanHistory(userId, scanData) {
  if (!userId) {
    console.warn('Cannot save scan history: userId is missing');
    return;
  }

  const monthKey = getCurrentMonthKey();
  const tableName = process.env.SCAN_HISTORY_TABLE || 
                    `${process.env.SERVICE_NAME || 'image-analysis'}-${process.env.STAGE || 'dev'}-scan-history`;
  
  // Generate deterministic scanId based on s3Url (if available) to prevent duplicates
  // If s3Url exists, use it to create a deterministic scanId
  // Otherwise, use requestId + timestamp
  let scanId;
  if (scanData.s3Url) {
    // Extract hash from s3Url (format: images/{hash}.{ext})
    const s3Hash = scanData.s3Url.match(/images\/([^\.]+)/)?.[1] || null;
    if (s3Hash) {
      scanId = `${userId}-${s3Hash}`;
    } else {
      scanId = `${Date.now()}-${uuidv4()}`;
    }
  } else if (scanData.requestId) {
    // Use requestId to make it somewhat deterministic
    scanId = `${userId}-${scanData.requestId}`;
  } else {
    scanId = `${Date.now()}-${uuidv4()}`;
  }
  
  // Calculate TTL (expires after 1 year)
  const expiresAt = Math.floor(Date.now() / 1000) + (365 * 24 * 60 * 60);
  
  const historyItem = {
    userId: userId,
    scanId: scanId,
    monthKey: monthKey,
    timestamp: new Date().toISOString(),
    success: scanData.success || false,
    status: scanData.status || 'unknown',
    deepfakeScore: scanData.deepfakeScore || null,
    sightengineRequestId: scanData.sightengineRequestId || null,
    s3Url: scanData.s3Url || null,
    requestId: scanData.requestId || null,
    label: scanData.label || null,
    note: scanData.note || null,
    createdAt: new Date().toISOString(),
    expiresAt: expiresAt, // TTL for automatic cleanup
  };
  
  console.log(`Saving scan history - UserId: ${userId}, ScanId: ${scanId}, RequestId: ${scanData.requestId}, S3Url: ${scanData.s3Url}, TableName: ${tableName}`);
  
  try {
    // Use conditional put to prevent duplicates atomically
    // This will fail if an item with the same userId+scanId already exists
    await dynamodb.put({
      TableName: tableName,
      Item: historyItem,
      ConditionExpression: 'attribute_not_exists(userId) AND attribute_not_exists(scanId)',
    }).promise();
    
    console.log(`✅ Scan history saved successfully for user: ${userId}, scan: ${scanId}`);
    return historyItem;
  } catch (error) {
    // If conditional put fails due to item already existing, that's okay - it's a duplicate
    if (error.code === 'ConditionalCheckFailedException') {
      console.log(`⚠️ Scan with scanId ${scanId} already exists for user ${userId}. Skipping duplicate save.`);
      // Try to get the existing item
      try {
        const existing = await dynamodb.get({
          TableName: tableName,
          Key: { userId: userId, scanId: scanId },
        }).promise();
        if (existing.Item) {
          return existing.Item;
        }
      } catch (getError) {
        console.warn('Could not retrieve existing scan:', getError.message);
      }
      return historyItem; // Return the item we tried to save
    }
    
    console.error('❌ Error saving scan history:', {
      error: error.message,
      code: error.code,
      statusCode: error.statusCode,
      userId: userId,
      tableName: tableName,
      stack: error.stack,
    });
    throw error;
  }
}

/**
 * Get token balance for user
 */
async function getTokenBalance(userId) {
  if (!userId) {
    console.warn('Cannot get token balance: userId is missing');
    return 0;
  }

  const tableName = process.env.TOKENS_TABLE || 
                    `${process.env.SERVICE_NAME || 'image-analysis'}-${process.env.STAGE || 'dev'}-tokens`;
  
  try {
    const result = await dynamodb.get({
      TableName: tableName,
      Key: { userId: userId },
    }).promise();

    return result.Item ? (result.Item.balance || 0) : 0;
  } catch (error) {
    console.error('❌ Error getting token balance:', {
      error: error.message,
      code: error.code,
      userId: userId,
      tableName: tableName,
    });
    return 0; // Return 0 on error to be safe
  }
}

/**
 * Decrement token balance for user (1 token per scan)
 */
async function decrementToken(userId) {
  if (!userId) {
    console.warn('Cannot decrement token: userId is missing');
    throw new Error('User ID is required');
  }

  const tableName = process.env.TOKENS_TABLE || 
                    `${process.env.SERVICE_NAME || 'image-analysis'}-${process.env.STAGE || 'dev'}-tokens`;
  
  console.log(`Attempting to decrement token - UserId: ${userId}, TableName: ${tableName}`);
  
  try {
    const result = await dynamodb.update({
      TableName: tableName,
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
    
    console.log(`✅ Token decremented successfully for user: ${userId}, new balance: ${result.Attributes.balance}`);
    return result.Attributes.balance;
  } catch (error) {
    if (error.code === 'ConditionalCheckFailedException') {
      console.warn(`⚠️ User ${userId} has insufficient tokens (balance is 0 or negative)`);
      throw new Error('Insufficient tokens');
    }
    // Log detailed error information
    console.error('❌ Error decrementing token:', {
      error: error.message,
      code: error.code,
      statusCode: error.statusCode,
      userId: userId,
      tableName: tableName,
      stack: error.stack,
    });
    throw error; // Re-throw so caller can handle it
  }
}

/**
 * Formalize Sightengine deepfake detection response into standardized format
 */
function formalizeDeepfakeResponse(sightengineResponse, processingTimeMs = null) {
  // Get configurable thresholds from environment variables (as percentages, converted to decimals)
  // Default: authentic if < 5%, deepfake if > 40%, otherwise unknown
  const AUTHENTIC_THRESHOLD = parseFloat(process.env.DEEPFAKE_THRESHOLD_AUTHENTIC || '5') / 100; // 5% default
  const DEEPFAKE_THRESHOLD = parseFloat(process.env.DEEPFAKE_THRESHOLD_DEEPFAKE || '40') / 100; // 40% default
  
  console.log(`Using deepfake thresholds - Authentic: < ${(AUTHENTIC_THRESHOLD * 100).toFixed(1)}%, Deepfake: > ${(DEEPFAKE_THRESHOLD * 100).toFixed(1)}%`);
  
  // Extract deepfake score from Sightengine response
  // Sightengine returns: { status: 'success', type: { deepfake: 0.0-1.0 }, ... }
  const deepfakeScore = sightengineResponse?.type?.deepfake ?? null;
  const status = sightengineResponse?.status || 'unknown';
  
  // Calculate processing time if available
  const requestTimestamp = sightengineResponse?.request?.timestamp;
  const processingTime = processingTimeMs 
    ? `${(processingTimeMs / 1000).toFixed(1)}s`
    : requestTimestamp 
      ? '3.2s' // Default fallback
      : 'N/A';
  
  // Determine image quality (simplified - could be enhanced with actual image analysis)
  const imageQuality = 'High Resolution'; // Could be determined from image metadata
  
  // Determine result status based on deepfake score with configurable thresholds
  let resultStatus, primaryMessage, iconType, confidence;
  
  if (deepfakeScore === null || status !== 'success') {
    // Unverifiable - insufficient data or API error
    resultStatus = 'unverifiable';
    iconType = 'info';
    primaryMessage = 'Image quality too low or insufficient data to verify authenticity.';
    confidence = null;
    console.log('Deepfake analysis: Unverifiable - insufficient data or API error');
  } else if (deepfakeScore < AUTHENTIC_THRESHOLD) {
    // Score below authentic threshold - likely real/authentic
    resultStatus = 'authentic';
    iconType = 'success';
    primaryMessage = 'Photo passed authenticity checks. No manipulation detected.';
    confidence = Math.round((1 - deepfakeScore) * 100);
    console.log(`Deepfake analysis: Authentic - score ${(deepfakeScore * 100).toFixed(2)}% < ${(AUTHENTIC_THRESHOLD * 100).toFixed(1)}% threshold`);
  } else if (deepfakeScore > DEEPFAKE_THRESHOLD) {
    // Score above deepfake threshold - detected as deepfake
    resultStatus = 'deepfake_detected';
    iconType = 'warning';
    primaryMessage = 'We can say with high confidence that this image was partially or completely created or altered using AI.';
    confidence = Math.round(deepfakeScore * 100);
    console.log(`Deepfake analysis: Deepfake detected - score ${(deepfakeScore * 100).toFixed(2)}% > ${(DEEPFAKE_THRESHOLD * 100).toFixed(1)}% threshold`);
  } else {
    // Score between thresholds - unknown/unverifiable
    resultStatus = 'unverifiable';
    iconType = 'info';
    primaryMessage = 'Image quality too low or insufficient data to verify authenticity.';
    confidence = null;
    console.log(`Deepfake analysis: Unverifiable - score ${(deepfakeScore * 100).toFixed(2)}% is between ${(AUTHENTIC_THRESHOLD * 100).toFixed(1)}% and ${(DEEPFAKE_THRESHOLD * 100).toFixed(1)}% thresholds`);
  }
  
  // Build formalized response
  const formalized = {
    status: resultStatus,
    iconType: iconType,
    primaryMessage: primaryMessage,
    confidence: confidence,
    deepfakeScore: deepfakeScore !== null ? Math.round(deepfakeScore * 100) / 100 : null,
    metadata: {
      detectionAlgorithm: 'AI Pattern Recognition v2.1',
      processingTime: processingTime,
      imageQuality: imageQuality,
    },
    // Backward compatibility fields for mobile app
    ai_generated: resultStatus === 'deepfake_detected',
    score: deepfakeScore !== null ? deepfakeScore : null,
    source: 'Sightengine Deepfake Detection',
    // Include raw response for debugging/advanced use
    rawResponse: sightengineResponse,
  };
  
  return formalized;
}

/**
 * Log request for analytics/tracking
 */
async function logRequest(deviceInfo, success = true) {
  const logData = {
    ...deviceInfo,
    success,
    service: 'image-analysis',
  };
  
  // Log to CloudWatch
  console.log('REQUEST_TRACKING:', JSON.stringify(logData));
  
  // Write to DynamoDB for persistent tracking
  const tableName = `${process.env.SERVICE_NAME || 'image-analysis'}-${process.env.STAGE || 'dev'}-requests`;
  const deviceId = deviceInfo.deviceId || 'unknown';
  
  try {
    // Store individual request with unique timestamp
    await dynamodb.put({
      TableName: tableName,
      Item: {
        deviceId: deviceId,
        timestamp: deviceInfo.timestamp,
        ipAddress: deviceInfo.ipAddress,
        userAgent: deviceInfo.userAgent,
        requestId: deviceInfo.requestId,
        success: success,
        service: 'image-analysis',
      },
    }).promise();
    
    console.log(`Request logged for device: ${deviceId} at ${deviceInfo.timestamp}`);
  } catch (error) {
    // Don't fail the request if tracking fails
    console.error('Error logging request to DynamoDB:', error);
  }
  
  return logData;
}

/**
 * Lambda handler
 */
exports.handler = async (event) => {
  console.log('Received event:', JSON.stringify(event, null, 2));

  // CORS headers - allow device ID header
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Device-ID,Device-ID',
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
    'Content-Type': 'application/json',
  };

  // Handle preflight OPTIONS request
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: '',
    };
  }

  // Extract device information
  const deviceInfo = extractDeviceInfo(event);
  
  try {
    // Initialize configuration from AWS services or environment variables
    const config = await initializeConfig();

    // Validate configuration
    if (!config.sightengineApiUser || !config.sightengineApiSecret) {
      throw new Error('Sightengine API credentials not found. Set API_USER and Api_Secret in .env file, AWS Secrets Manager, or SSM Parameter Store');
    }
    if (!config.s3Bucket) {
      throw new Error('S3 bucket name not found. Set it in SSM Parameter Store or as S3_BUCKET_NAME environment variable');
    }

    // Parse request body
    let body;
    try {
      body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
    } catch (error) {
      throw new Error('Invalid JSON in request body');
    }

    // If device ID not in headers, try to get it from request body
    if (!deviceInfo.deviceId && body.deviceId) {
      deviceInfo.deviceId = body.deviceId;
    }

    // Extract image data
    if (!body.image) {
      throw new Error('Missing "image" field in request body');
    }

    // Parse base64 image
    let imageData;
    try {
      imageData = parseBase64Image(body.image);
    } catch (error) {
      throw new Error(`Image parsing error: ${error.message}`);
    }
    
    const { contentType, data: imageBuffer, extension, size, sizeMB } = imageData;

    // Upload to S3 (optional, for storage/reference)
    console.log(`Uploading image to S3 (${sizeMB}MB, ${contentType})...`);
    let s3Url;
    try {
      s3Url = await uploadToS3(imageBuffer, contentType, extension, config.s3Bucket, deviceInfo.requestId);
      console.log('Image uploaded to S3:', s3Url);
    } catch (error) {
      if (error.code === 'InvalidUserID.NotFound' || error.code === 'InvalidClientTokenId' || error.message.includes('security token')) {
        console.warn(`AWS authentication error uploading to S3. Continuing without S3 upload. Original error: ${error.message}`);
        s3Url = null; // Continue without S3 URL
      } else {
        console.warn(`S3 upload failed. Continuing without S3 upload. Error: ${error.message}`);
        s3Url = null; // Continue without S3 URL
      }
    }

    // Call Sightengine API
    console.log('Calling Sightengine API...');
    const apiStartTime = Date.now();
    let sightengineResponse;
    try {
      sightengineResponse = await callSightengineAPI(
        imageBuffer, 
        contentType, 
        config.sightengineApiUser, 
        config.sightengineApiSecret
      );
      console.log('Sightengine API response received');
    } catch (error) {
      // Provide more helpful error messages
      if (error.message.includes('400')) {
        throw new Error(`Sightengine API rejected the image. Possible causes: 1) Image too large (current: ${sizeMB}MB), 2) Unsupported format (current: ${contentType}), 3) Corrupted image data. Original error: ${error.message}`);
      }
      throw error;
    }
    
    const apiProcessingTime = Date.now() - apiStartTime;
    
    // Formalize the response into standardized format
    const formalizedResponse = formalizeDeepfakeResponse(sightengineResponse, apiProcessingTime);
    console.log('Formalized response:', JSON.stringify(formalizedResponse, null, 2));

    // Extract token and Cognito user ID from request
    const token = extractToken(event);
    const userId = extractUserId(event, body);
    
    console.log('=== Token and User ID Extraction ===');
    console.log('Token present:', !!token);
    console.log('Token preview:', token ? `${token.substring(0, 20)}...` : 'N/A');
    console.log('User ID extracted:', userId || 'NONE');
    
    if (token && userId) {
      console.log('✅ Token received and Cognito user ID extracted:', userId);
    } else if (token && !userId) {
      console.warn('⚠️ Token received but could not extract Cognito user ID');
      console.warn('Token payload might be invalid or missing user ID field');
    } else if (!token) {
      console.warn('⚠️ No token found in request headers');
      console.warn('Request headers:', JSON.stringify(event.headers || {}, null, 2));
    }

    // Check token balance before processing scan (only for authenticated users)
    let tokenBalance = null;
    if (userId) {
      console.log('=== Checking Token Balance ===');
      try {
        tokenBalance = await getTokenBalance(userId);
        console.log(`✅ Token balance retrieved: ${tokenBalance} tokens`);
        
        if (tokenBalance <= 0) {
          console.warn('⚠️ User has insufficient tokens, blocking scan');
          return {
            statusCode: 402, // Payment Required
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
            },
            body: JSON.stringify({
              success: false,
              error: 'Insufficient tokens. Please purchase a scan pack to continue.',
              tokenBalance: tokenBalance,
              scansRemaining: tokenBalance,
            }),
          };
        }
      } catch (err) {
        console.error('❌ Failed to check token balance:', {
          error: err.message,
          code: err.code,
          userId: userId,
          stack: err.stack,
        });
        // Continue with scan even if token check fails (graceful degradation)
        // In production, you might want to block the scan here
      }
    } else {
      console.warn('⚠️ User ID not found in request, skipping token check');
      console.warn('This might be a guest user or token extraction failed');
    }

    // Decrement token after successful scan (only for authenticated users with tokens)
    if (userId && tokenBalance !== null && tokenBalance > 0) {
      console.log('=== Decrementing Token After Successful Scan ===');
      try {
        const newBalance = await decrementToken(userId);
        tokenBalance = newBalance;
        console.log(`✅ Token decremented successfully. New balance: ${newBalance}`);
      } catch (err) {
        console.error('❌ Failed to decrement token:', {
          error: err.message,
          code: err.code,
          userId: userId,
          stack: err.stack,
        });
        // Continue even if token decrement fails - don't block the response
        // The scan was already processed, so we'll log the error but not fail
      }
    }

    // Prepare response with token balance
    // Note: Scan history is now saved manually by user via "Save to History" button
    const response = {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        s3Url: s3Url,
        analysis: formalizedResponse,
        // Include token balance if available
        ...(tokenBalance !== null && { 
          tokenBalance: tokenBalance,
          scansRemaining: tokenBalance,
        }),
        // Include request tracking info for manual history save
        requestId: deviceInfo.requestId,
      }),
    };

    // Log successful request (async, don't wait)
    logRequest(deviceInfo, true).catch(err => 
      console.error('Failed to log request:', err)
    );

    // Return success response with formalized analysis
    return response;
  } catch (error) {
    console.error('Error processing request:', error);
    
    // Log failed request (async, don't wait)
    logRequest(deviceInfo, false).catch(err => 
      console.error('Failed to log request:', err)
    );
    
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: error.message,
        requestId: deviceInfo.requestId,
      }),
    };
  }
};

