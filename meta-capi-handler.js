/**
 * Meta Conversions API (CAPI) Lambda Handler
 * Receives events from mobile app and forwards them to Meta CAPI
 */

const metaCapiService = require('./meta-capi-service');

// Configuration from environment variables
const META_PIXEL_ID = process.env.META_PIXEL_ID || '';
const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN || '';
const META_ACCESS_TOKEN_SECRET_NAME = process.env.META_ACCESS_TOKEN_SECRET_NAME || 'catfish/meta-access-token';

const AWS = require('aws-sdk');
const secretsManager = new AWS.SecretsManager();

/**
 * Get Meta Access Token from Secrets Manager or environment
 */
async function getMetaAccessToken() {
  if (META_ACCESS_TOKEN) {
    return META_ACCESS_TOKEN;
  }

  try {
    const secret = await secretsManager.getSecretValue({
      SecretId: META_ACCESS_TOKEN_SECRET_NAME,
    }).promise();
    
    const secretData = JSON.parse(secret.SecretString);
    return secretData.access_token || secretData.META_ACCESS_TOKEN || secret.SecretString;
  } catch (error) {
    console.error('Error getting Meta access token from Secrets Manager:', error);
    throw new Error('Meta access token not configured');
  }
}

/**
 * Extract client IP from API Gateway event
 */
function getClientIp(event) {
  return event.requestContext?.identity?.sourceIp || 
         event.headers?.['x-forwarded-for']?.split(',')[0]?.trim() ||
         event.headers?.['X-Forwarded-For']?.split(',')[0]?.trim() ||
         '0.0.0.0';
}

/**
 * Extract user agent from API Gateway event
 */
function getUserAgent(event) {
  return event.headers?.['user-agent'] || 
         event.headers?.['User-Agent'] ||
         '';
}

/**
 * Lambda handler
 */
exports.handler = async (event) => {
  console.log('Meta CAPI handler event:', JSON.stringify(event, null, 2));

  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
  };

  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ message: 'OK' }),
    };
  }

  // Only allow POST requests
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({
        success: false,
        error: 'Method not allowed',
      }),
    };
  }

  try {
    // Parse request body
    const body = typeof event.body === 'string' ? JSON.parse(event.body) : (event.body || {});
    const { eventName, eventParams, eventId } = body;

    if (!eventName) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          success: false,
          error: 'eventName is required',
        }),
      };
    }

    if (!META_PIXEL_ID) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          success: false,
          error: 'Meta Pixel ID not configured',
        }),
      };
    }

    // Get access token
    const accessToken = await getMetaAccessToken();

    // Extract client information from event
    const clientIp = getClientIp(event);
    const userAgent = getUserAgent(event);

    // Add client information to event params
    const enhancedParams = {
      ...eventParams,
      client_ip_address: clientIp,
      client_user_agent: userAgent,
    };

    // Format event for CAPI
    const capiEvent = metaCapiService.formatEventForCAPI(
      eventName,
      enhancedParams,
      eventId
    );

    // Send to Meta CAPI
    const result = await metaCapiService.sendEventToCAPI(
      capiEvent,
      META_PIXEL_ID,
      accessToken
    );

    console.log('Meta CAPI response:', JSON.stringify(result, null, 2));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        data: result,
      }),
    };
  } catch (error) {
    console.error('Error in Meta CAPI handler:', error);
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
