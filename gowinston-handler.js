// Load environment variables from .env file
require('dotenv').config();

const AWS = require('aws-sdk');
const https = require('https');
const { v4: uuidv4 } = require('uuid');
const ssm = new AWS.SSM();

// Configure AWS SDK with environment variables
const awsConfig = {
  region: process.env.AWS_REGION || 'us-east-1',
};

// Only set credentials if provided AND we're running locally (not in Lambda)
const isLambda = !!process.env.AWS_LAMBDA_FUNCTION_NAME;
if (!isLambda && process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
  awsConfig.accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  awsConfig.secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
}

AWS.config.update(awsConfig);

const s3 = new AWS.S3();
const dynamodb = new AWS.DynamoDB.DocumentClient();

// Cache for configuration
let cachedConfig = {
  gowinstonToken: null,
  s3Bucket: null,
};

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
  // Try to get Gowinston token from environment variables
  if (!cachedConfig.gowinstonToken) {
    cachedConfig.gowinstonToken = process.env.GOWINSTON_TOKEN || process.env.GOWINSTON_API_KEY;
  }

  // Try to get S3 bucket name from SSM or environment
  if (!cachedConfig.s3Bucket) {
    const S3_BUCKET_PARAM = process.env.S3_BUCKET_PARAM_NAME || '/catfish/s3-bucket-name';
    cachedConfig.s3Bucket = await getSSMParameter(S3_BUCKET_PARAM) ||
                             process.env.S3_BUCKET_NAME;
  }

  return {
    gowinstonToken: cachedConfig.gowinstonToken,
    s3Bucket: cachedConfig.s3Bucket,
  };
}

/**
 * CORS headers
 */
function getCorsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Device-ID,Device-ID',
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
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
  
  // Validate image size (max 20MB)
  const MAX_IMAGE_SIZE = 20 * 1024 * 1024; // 20MB
  const imageSizeMB = (data.length / (1024 * 1024)).toFixed(2);
  
  console.log(`Image parsed - Type: ${contentType}, Size: ${imageSizeMB}MB, Extension: ${extension}`);
  
  if (data.length > MAX_IMAGE_SIZE) {
    throw new Error(`Image too large: ${imageSizeMB}MB. Maximum size is 20MB. Please compress or resize the image.`);
  }
  
  // Validate supported formats
  const supportedFormats = ['image/jpeg', 'image/png', 'image/webp'];
  if (!supportedFormats.includes(contentType)) {
    console.warn(`Warning: Image format ${contentType} may not be supported. Supported formats: JPEG, PNG, WebP`);
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
 * Upload image to S3 and return the public URL
 */
async function uploadToS3(imageBuffer, contentType, extension, bucketName) {
  if (!bucketName) {
    console.warn('S3 bucket name not configured, skipping S3 upload');
    return null;
  }

  const key = `images/${uuidv4()}.${extension}`;
  
  const params = {
    Bucket: bucketName,
    Key: key,
    Body: imageBuffer,
    ContentType: contentType,
    CacheControl: 'max-age=3600', // Cache for 1 hour
  };

  console.log(`Uploading to S3: bucket=${bucketName}, key=${key}, size=${(imageBuffer.length / 1024).toFixed(2)}KB`);
  await s3.putObject(params).promise();
  console.log('S3 upload completed');
  
  // Return the public URL using regional endpoint format
  const region = AWS.config.region || 'us-east-1';
  const url = region === 'us-east-1' 
    ? `https://${bucketName}.s3.amazonaws.com/${key}`
    : `https://${bucketName}.s3.${region}.amazonaws.com/${key}`;
  
  // Wait a moment for S3 to propagate
  await new Promise(resolve => setTimeout(resolve, 500));
  
  return url;
}

/**
 * Call Gowinston API to detect AI images
 */
async function detectAIImage(url, version, token) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      url: url,
      version: version || 'v2',
    });

    const options = {
      method: 'POST',
      hostname: 'api.gowinston.ai',
      path: '/v2/image-detection',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
      },
      timeout: 60000, // 60 second timeout
    };

    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const jsonData = JSON.parse(data);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({
              success: true,
              data: jsonData,
              statusCode: res.statusCode,
            });
          } else {
            resolve({
              success: false,
              error: jsonData.message || jsonData.error || 'API request failed',
              statusCode: res.statusCode,
              data: jsonData,
            });
          }
        } catch (parseError) {
          resolve({
            success: false,
            error: 'Failed to parse response',
            rawResponse: data,
            statusCode: res.statusCode,
          });
        }
      });
    });

    req.on('error', (error) => {
      reject({
        success: false,
        error: error.message || 'Network error',
      });
    });

    req.on('timeout', () => {
      req.destroy();
      reject({
        success: false,
        error: 'Request timeout',
      });
    });

    req.setTimeout(60000);
    req.write(postData);
    req.end();
  });
}

/**
 * Extract device information from API Gateway event
 */
function extractDeviceInfo(event) {
  const requestHeaders = event.headers || {};
  const requestContext = event.requestContext || {};
  
  const deviceId = 
    requestHeaders['X-Device-ID'] || 
    requestHeaders['x-device-id'] || 
    requestHeaders['Device-ID'] ||
    requestHeaders['device-id'] ||
    null;
  
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
    const tokenParts = token.split('.');
    if (tokenParts.length !== 3) {
      console.warn('Invalid JWT token format: expected 3 parts, got', tokenParts.length);
      return null;
    }
    
    let payload;
    try {
      payload = JSON.parse(Buffer.from(tokenParts[1], 'base64').toString());
    } catch (e) {
      const base64Url = tokenParts[1].replace(/-/g, '+').replace(/_/g, '/');
      const base64 = base64Url + '='.repeat((4 - base64Url.length % 4) % 4);
      payload = JSON.parse(Buffer.from(base64, 'base64').toString());
    }
    
    const userId = payload.sub || payload['cognito:username'] || payload.username;
    
    if (userId) {
      console.log('✅ Successfully extracted Cognito user ID from token:', userId);
      return userId;
    } else {
      console.warn('❌ Token payload does not contain user ID');
      return null;
    }
  } catch (tokenError) {
    console.error('❌ Error extracting user ID from token:', tokenError.message);
    return null;
  }
}

/**
 * Extract user ID from request (Authorization header or body)
 */
function extractUserId(event, body = null) {
  let userId = null;
  
  const token = extractToken(event);
  if (token) {
    userId = getCognitoUserIdFromToken(token);
  }

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
 * Save scan history to DynamoDB
 */
async function saveScanHistory(userId, scanData) {
  if (!userId) {
    console.warn('Cannot save scan history: userId is missing');
    return;
  }

  const monthKey = getCurrentMonthKey();
  const tableName = process.env.SCAN_HISTORY_TABLE || 
                    `${process.env.SERVICE_NAME || 'image-analysis'}-${process.env.STAGE || 'dev'}-scan-history`;
  
  const scanId = `${Date.now()}-${uuidv4()}`;
  const expiresAt = Math.floor(Date.now() / 1000) + (365 * 24 * 60 * 60);
  
  const historyItem = {
    userId: userId,
    scanId: scanId,
    monthKey: monthKey,
    timestamp: new Date().toISOString(),
    success: scanData.success || false,
    status: scanData.status || 'unknown',
    deepfakeScore: scanData.deepfakeScore || null,
    aiProbability: scanData.aiProbability || null,
    humanProbability: scanData.humanProbability || null,
    gowinstonRequestId: scanData.gowinstonRequestId || null,
    s3Url: scanData.s3Url || null,
    requestId: scanData.requestId || null,
    source: 'gowinston',
    createdAt: new Date().toISOString(),
    expiresAt: expiresAt,
  };
  
  console.log(`Saving scan history - UserId: ${userId}, ScanId: ${scanId}, TableName: ${tableName}`);
  
  try {
    await dynamodb.put({
      TableName: tableName,
      Item: historyItem,
    }).promise();
    
    console.log(`✅ Scan history saved successfully for user: ${userId}, scan: ${scanId}`);
    return historyItem;
  } catch (error) {
    console.error('❌ Error saving scan history:', {
      error: error.message,
      code: error.code,
      statusCode: error.statusCode,
      userId: userId,
      tableName: tableName,
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
 * Log request for analytics/tracking
 */
async function logRequest(deviceInfo, success = true) {
  const logData = {
    ...deviceInfo,
    success,
    service: 'gowinston',
  };
  
  console.log('REQUEST_TRACKING:', JSON.stringify(logData));
  
  const tableName = `${process.env.SERVICE_NAME || 'image-analysis'}-${process.env.STAGE || 'dev'}-requests`;
  const deviceId = deviceInfo.deviceId || 'unknown';
  
  try {
    await dynamodb.put({
      TableName: tableName,
      Item: {
        deviceId: deviceId,
        timestamp: deviceInfo.timestamp,
        ipAddress: deviceInfo.ipAddress,
        userAgent: deviceInfo.userAgent,
        requestId: deviceInfo.requestId,
        success: success,
        service: 'gowinston',
      },
    }).promise();
    
    console.log(`Request logged for device: ${deviceId} at ${deviceInfo.timestamp}`);
  } catch (error) {
    console.error('Error logging request to DynamoDB:', error);
  }
  
  return logData;
}

/**
 * Formalize Gowinston detection response into standardized format
 */
function formalizeGowinstonResponse(gowinstonResponse, processingTimeMs = null) {
  // Get configurable thresholds from environment variables (as percentages, converted to decimals)
  // Default: authentic if ai_probability < 20%, deepfake if > 80%, otherwise unknown
  const AUTHENTIC_THRESHOLD = parseFloat(process.env.GOWINSTON_THRESHOLD_AUTHENTIC || '20') / 100; // 20% default
  const DEEPFAKE_THRESHOLD = parseFloat(process.env.GOWINSTON_THRESHOLD_DEEPFAKE || '80') / 100; // 80% default
  
  console.log(`Using Gowinston thresholds - Authentic: ai_probability < ${(AUTHENTIC_THRESHOLD * 100).toFixed(1)}%, Deepfake: > ${(DEEPFAKE_THRESHOLD * 100).toFixed(1)}%`);
  
  // Extract probabilities from Gowinston response
  const aiProbability = gowinstonResponse?.ai_probability ?? null;
  const humanProbability = gowinstonResponse?.human_probability ?? null;
  const score = gowinstonResponse?.score ?? null;
  const mimeType = gowinstonResponse?.mime_type || null;
  const version = gowinstonResponse?.version || '2';
  const aiWatermarkDetected = gowinstonResponse?.ai_watermark_detected || false;
  
  // Calculate processing time
  const processingTime = processingTimeMs 
    ? `${(processingTimeMs / 1000).toFixed(1)}s`
    : 'N/A';
  
  // Determine image quality
  const imageQuality = mimeType ? `${mimeType.split('/')[1].toUpperCase()} Format` : 'Standard Quality';
  
  // Determine result status based on AI probability with configurable thresholds
  let resultStatus, primaryMessage, iconType, confidence;
  
  if (aiProbability === null || humanProbability === null) {
    // Unverifiable - insufficient data or API error
    resultStatus = 'unverifiable';
    iconType = 'info';
    primaryMessage = 'Image quality too low or insufficient data to verify authenticity.';
    confidence = null;
    console.log('Gowinston analysis: Unverifiable - insufficient data');
  } else if (aiProbability < AUTHENTIC_THRESHOLD) {
    // Low AI probability - likely authentic/human
    resultStatus = 'authentic';
    iconType = 'success';
    primaryMessage = 'Photo passed authenticity checks. No AI manipulation detected.';
    confidence = Math.round(humanProbability * 100);
    console.log(`Gowinston analysis: Authentic - ai_probability ${(aiProbability * 100).toFixed(2)}% < ${(AUTHENTIC_THRESHOLD * 100).toFixed(1)}% threshold`);
  } else if (aiProbability > DEEPFAKE_THRESHOLD) {
    // High AI probability - detected as AI-generated
    resultStatus = 'deepfake_detected';
    iconType = 'warning';
    primaryMessage = 'We can say with high confidence that this image was partially or completely created or altered using AI.';
    confidence = Math.round(aiProbability * 100);
    console.log(`Gowinston analysis: Deepfake detected - ai_probability ${(aiProbability * 100).toFixed(2)}% > ${(DEEPFAKE_THRESHOLD * 100).toFixed(1)}% threshold`);
  } else {
    // Probability between thresholds - unknown/unverifiable
    resultStatus = 'unverifiable';
    iconType = 'info';
    primaryMessage = 'Image quality too low or insufficient data to verify authenticity.';
    confidence = null;
    console.log(`Gowinston analysis: Unverifiable - ai_probability ${(aiProbability * 100).toFixed(2)}% is between ${(AUTHENTIC_THRESHOLD * 100).toFixed(1)}% and ${(DEEPFAKE_THRESHOLD * 100).toFixed(1)}% thresholds`);
  }
  
  // Build formalized response matching analyze endpoint format
  const formalized = {
    status: resultStatus,
    iconType: iconType,
    primaryMessage: primaryMessage,
    confidence: confidence,
    deepfakeScore: aiProbability !== null ? Math.round(aiProbability * 100) / 100 : null,
    metadata: {
      detectionAlgorithm: `Gowinston AI Detection v${version}`,
      processingTime: processingTime,
      imageQuality: imageQuality,
      aiWatermarkDetected: aiWatermarkDetected,
    },
    // Backward compatibility fields for mobile app
    ai_generated: resultStatus === 'deepfake_detected',
    score: score !== null ? score : (aiProbability !== null ? aiProbability : null),
    source: 'Gowinston AI Detection',
    // Include raw response for debugging/advanced use
    rawResponse: gowinstonResponse,
    // Additional Gowinston-specific fields
    aiProbability: aiProbability,
    humanProbability: humanProbability,
    creditsUsed: gowinstonResponse?.credits_used || null,
    creditsRemaining: gowinstonResponse?.credits_remaining || null,
  };
  
  return formalized;
}

/**
 * Main Lambda handler
 */
exports.handler = async (event) => {
  console.log('Received event:', JSON.stringify(event, null, 2));

  const headers = getCorsHeaders();

  try {
    // Handle OPTIONS request for CORS
    if (event.httpMethod === 'OPTIONS') {
      return handleOptions();
    }

    // Only allow POST requests
    if (event.httpMethod !== 'POST') {
      return {
        statusCode: 405,
        headers,
        body: JSON.stringify({
          success: false,
          error: 'Method not allowed. Only POST requests are supported.',
        }),
      };
    }

    // Initialize configuration
    const config = await initializeConfig();

    if (!config.gowinstonToken) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          success: false,
          error: 'Gowinston API token not configured. Please set GOWINSTON_TOKEN in environment variables.',
        }),
      };
    }

    // Extract device information
    const deviceInfo = extractDeviceInfo(event);

    // Parse request body
    let body;
    try {
      body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
    } catch (parseError) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          success: false,
          error: 'Invalid JSON in request body',
        }),
      };
    }

    // If device ID not in headers, try to get it from request body
    if (!deviceInfo.deviceId && body.deviceId) {
      deviceInfo.deviceId = body.deviceId;
    }

    // Extract image data - support both base64 image and URL
    let imageUrl;
    let s3Url = null;

    if (body.image) {
      // Base64 image provided - parse and upload to S3
      let imageData;
      try {
        imageData = parseBase64Image(body.image);
      } catch (error) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({
            success: false,
            error: `Image parsing error: ${error.message}`,
          }),
        };
      }

      const { contentType, data: imageBuffer, extension, size, sizeMB } = imageData;

      // Upload to S3 (optional, for storage/reference)
      if (config.s3Bucket) {
        console.log(`Uploading image to S3 (${sizeMB}MB, ${contentType})...`);
        try {
          s3Url = await uploadToS3(imageBuffer, contentType, extension, config.s3Bucket);
          console.log('Image uploaded to S3:', s3Url);
          imageUrl = s3Url; // Use S3 URL for Gowinston API
        } catch (error) {
          console.warn(`S3 upload failed. Continuing without S3 upload. Error: ${error.message}`);
          s3Url = null;
        }
      } else {
        console.warn('S3 bucket not configured, cannot upload image');
        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({
            success: false,
            error: 'S3 bucket not configured. Cannot process image upload.',
          }),
        };
      }
    } else if (body.url) {
      // URL provided directly - use it
      imageUrl = body.url;
      console.log('Using provided image URL:', imageUrl);
    } else {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          success: false,
          error: 'Missing required field: either "image" (base64) or "url" (image URL) is required',
        }),
      };
    }

    // Get version parameter (default to v2)
    const version = body.version || 'v2';

    // Call Gowinston API
    console.log('Calling Gowinston API...');
    const apiStartTime = Date.now();
    let gowinstonResult;
    try {
      gowinstonResult = await detectAIImage(imageUrl, version, config.gowinstonToken);
      console.log('Gowinston API response received');
    } catch (error) {
      console.error('Gowinston API error:', error);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          success: false,
          error: `Gowinston API request failed: ${error.error || error.message}`,
          requestId: deviceInfo.requestId,
        }),
      };
    }

    const apiProcessingTime = Date.now() - apiStartTime;

    if (!gowinstonResult.success) {
      // Gowinston API returned an error
      const errorMessage = gowinstonResult.error || 'Gowinston API request failed';
      const statusCode = gowinstonResult.statusCode || 500;

      // Log failed request
      logRequest(deviceInfo, false).catch(err => 
        console.error('Failed to log request:', err)
      );

      return {
        statusCode: statusCode >= 400 && statusCode < 600 ? statusCode : 500,
        headers,
        body: JSON.stringify({
          success: false,
          error: errorMessage,
          requestId: deviceInfo.requestId,
          ...(gowinstonResult.data && { details: gowinstonResult.data }),
        }),
      };
    }

    // Formalize the response into standardized format
    const formalizedResponse = formalizeGowinstonResponse(gowinstonResult.data, apiProcessingTime);
    console.log('Formalized response:', JSON.stringify(formalizedResponse, null, 2));

    // Extract token and Cognito user ID from request
    const token = extractToken(event);
    const userId = extractUserId(event, body);
    
    console.log('=== Token and User ID Extraction ===');
    console.log('Token present:', !!token);
    console.log('User ID extracted:', userId || 'NONE');

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

    // Save scan history synchronously
    let scanHistorySaved = false;
    if (userId) {
      console.log('=== Saving Scan History (Synchronously) ===');
      const historyData = {
        success: true,
        status: formalizedResponse.status,
        deepfakeScore: formalizedResponse.deepfakeScore,
        aiProbability: formalizedResponse.aiProbability,
        humanProbability: formalizedResponse.humanProbability,
        gowinstonRequestId: gowinstonResult.data?.request_id || deviceInfo.requestId,
        s3Url: s3Url,
        requestId: deviceInfo.requestId,
      };
      
      try {
        await saveScanHistory(userId, historyData);
        scanHistorySaved = true;
        console.log('✅ Scan history saved successfully (synchronously)');
      } catch (err) {
        console.error('❌ Failed to save scan history:', err.message);
        scanHistorySaved = false;
        // Continue even if scan history save fails
      }
    } else {
      console.warn('⚠️ User ID not found in request, skipping scan history save');
    }

    // Prepare response with token balance and history save status
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
        // Include scan history save status
        scanHistorySaved: scanHistorySaved,
        // Include request tracking info
        requestId: deviceInfo.requestId,
      }),
    };

    // Log successful request (async, don't wait)
    logRequest(deviceInfo, true).catch(err => 
      console.error('Failed to log request:', err)
    );

    return response;
  } catch (error) {
    console.error('Error processing request:', error);

    // Extract device info for error logging
    let deviceInfo;
    try {
      deviceInfo = extractDeviceInfo(event);
    } catch (e) {
      deviceInfo = { requestId: 'unknown', timestamp: new Date().toISOString() };
    }
    
    // Log failed request (async, don't wait)
    logRequest(deviceInfo, false).catch(err => 
      console.error('Failed to log request:', err)
    );
    
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: error.message || 'Internal server error',
        requestId: deviceInfo.requestId,
      }),
    };
  }
};
