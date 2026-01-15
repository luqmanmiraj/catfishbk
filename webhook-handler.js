// Load environment variables from .env file
require('dotenv').config();

const AWS = require('aws-sdk');
const { wrapHandler } = require('./middleware/errorHandler');
const crypto = require('crypto');

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
const REVENUECAT_SECRET_KEY = process.env.REVENUECAT_SECRET_KEY || '';
const SUBSCRIPTIONS_TABLE = process.env.SUBSCRIPTIONS_TABLE || 'image-analysis-dev-subscriptions';
const USER_POOL_ID = process.env.COGNITO_USER_POOL_ID || '';

/**
 * Verify RevenueCat webhook signature
 */
function verifyWebhookSignature(body, signature, secretKey) {
  if (!secretKey) {
    console.warn('RevenueCat secret key not configured, skipping signature verification');
    return true; // Allow in development, but log warning
  }

  try {
    const hmac = crypto.createHmac('sha256', secretKey);
    hmac.update(body);
    const calculatedSignature = hmac.digest('hex');
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(calculatedSignature)
    );
  } catch (error) {
    console.error('Error verifying webhook signature:', error);
    return false;
  }
}

/**
 * Extract user ID from RevenueCat event
 * RevenueCat uses app_user_id which we'll link to Cognito user ID
 */
function extractUserId(event) {
  // RevenueCat event has app_user_id field
  // We store Cognito user ID in custom attributes or metadata
  return event.app_user_id || event.original_app_user_id || null;
}

/**
 * Update subscription in DynamoDB
 */
async function updateSubscription(event) {
  const userId = extractUserId(event);
  if (!userId) {
    console.error('No user ID found in webhook event');
    return;
  }

  const eventType = event.type;
  const productId = event.product_id || '';
  const entitlementIds = event.entitlements || {};
  const isPro = entitlementIds.pro && entitlementIds.pro.expires_date;

  const subscriptionStatus = isPro ? 'active' : 'inactive';
  const expiresAt = isPro ? entitlementIds.pro.expires_date : null;

  const subscriptionData = {
    userId: userId,
    status: subscriptionStatus,
    tier: isPro ? 'pro' : 'free',
    productId: productId,
    eventType: eventType,
    expiresAt: expiresAt,
    updatedAt: new Date().toISOString(),
    // Store full event for debugging
    eventData: JSON.stringify(event),
  };

  try {
    await dynamodb.put({
      TableName: SUBSCRIPTIONS_TABLE,
      Item: subscriptionData,
    }).promise();

    console.log(`Subscription updated for user ${userId}: ${subscriptionStatus}`);

    // Optionally update Cognito user attributes
    if (USER_POOL_ID && userId) {
      try {
        await cognito.adminUpdateUserAttributes({
          UserPoolId: USER_POOL_ID,
          Username: userId,
          UserAttributes: [
            {
              Name: 'custom:subscription_tier',
              Value: isPro ? 'pro' : 'free',
            },
            {
              Name: 'custom:subscription_status',
              Value: subscriptionStatus,
            },
          ],
        }).promise();
        console.log(`Updated Cognito attributes for user ${userId}`);
      } catch (cognitoError) {
        // Non-fatal error, log but continue
        console.warn('Failed to update Cognito attributes:', cognitoError.message);
      }
    }
  } catch (error) {
    console.error('Error updating subscription in DynamoDB:', error);
    throw error;
  }
}

/**
 * Handle different webhook event types
 */
async function handleWebhookEvent(event) {
  const eventType = event.type;

  console.log(`Processing webhook event: ${eventType}`);

  switch (eventType) {
    case 'INITIAL_PURCHASE':
    case 'RENEWAL':
    case 'UNCANCELLATION':
      // User has active subscription
      await updateSubscription(event);
      break;

    case 'CANCELLATION':
      // User cancelled but still has access until expiration
      await updateSubscription(event);
      break;

    case 'EXPIRATION':
      // Subscription expired
      await updateSubscription(event);
      break;

    case 'BILLING_ISSUE':
      // Payment failed, but give grace period
      await updateSubscription(event);
      break;

    case 'NON_RENEWING_PURCHASE':
      // One-time purchase (if you add this later)
      await updateSubscription(event);
      break;

    default:
      console.log(`Unhandled event type: ${eventType}`);
  }
}

/**
 * Lambda handler (wrapped with Sentry)
 */
const handler = async (event) => {
  console.log('Received webhook event:', JSON.stringify(event, null, 2));

  const headers = {
    'Content-Type': 'application/json',
  };

  try {
    // Handle preflight OPTIONS request
    if (event.httpMethod === 'OPTIONS') {
      return {
        statusCode: 200,
        headers: {
          ...headers,
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-RevenueCat-Event-Name',
          'Access-Control-Allow-Methods': 'POST,OPTIONS',
        },
        body: '',
      };
    }

    // Verify webhook signature if secret key is configured
    const signature = event.headers?.['X-RevenueCat-Signature'] || 
                     event.headers?.['x-revenuecat-signature'] || '';
    const requestBody = typeof event.body === 'string' ? event.body : JSON.stringify(event.body);

    if (REVENUECAT_SECRET_KEY && !verifyWebhookSignature(requestBody, signature, REVENUECAT_SECRET_KEY)) {
      console.error('Invalid webhook signature');
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: 'Invalid signature' }),
      };
    }

    // Parse webhook event
    let webhookEvent;
    try {
      webhookEvent = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
      
      // RevenueCat sends events in event.event format
      if (webhookEvent.event) {
        webhookEvent = webhookEvent.event;
      }
    } catch (parseError) {
      console.error('Error parsing webhook body:', parseError);
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Invalid JSON in request body' }),
      };
    }

    // Process the webhook event
    await handleWebhookEvent(webhookEvent);

    return {
      statusCode: 200,
      headers: {
        ...headers,
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ success: true, message: 'Webhook processed successfully' }),
    };
  } catch (error) {
    console.error('Error processing webhook:', error);

    return {
      statusCode: 500,
      headers: {
        ...headers,
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        success: false,
        error: error.message,
      }),
    };
  }
};

// Wrap handler with Sentry error tracking
exports.handler = wrapHandler(handler);
