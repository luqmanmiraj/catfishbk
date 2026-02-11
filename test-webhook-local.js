/**
 * Local test script for the RevenueCat Webhook Lambda function
 * 
 * Usage: 
 *   node test-webhook-local.js [event-type] [user-id]
 * 
 * Examples:
 *   node test-webhook-local.js INITIAL_PURCHASE user123
 *   node test-webhook-local.js RENEWAL user123
 *   node test-webhook-local.js CANCELLATION user123
 *   node test-webhook-local.js EXPIRATION user123
 *   node test-webhook-local.js BILLING_ISSUE user123
 *   node test-webhook-local.js UNCANCELLATION user123
 *   node test-webhook-local.js all
 * 
 * Environment variables are loaded from .env file automatically.
 * Set REVENUECAT_SECRET_KEY in .env to test signature verification.
 */

// Load environment variables from .env file
require('dotenv').config();

const handler = require('./webhook-handler');
const crypto = require('crypto');

// Default test values
const DEFAULT_EVENT_TYPE = 'INITIAL_PURCHASE';
const DEFAULT_USER_ID = 'test-user-' + Date.now();

/**
 * Generate a valid RevenueCat webhook signature
 */
function generateSignature(body, secretKey) {
  if (!secretKey) return '';
  const hmac = crypto.createHmac('sha256', secretKey);
  hmac.update(body);
  return hmac.digest('hex');
}

/**
 * Create a mock Lambda context for local testing
 * Sentry's wrapper expects a context object with callbackWaitsForEmptyEventLoop
 */
function createMockContext() {
  return {
    callbackWaitsForEmptyEventLoop: false,
    functionName: 'webhook-handler',
    functionVersion: '$LATEST',
    invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:webhook-handler',
    memoryLimitInMB: '128',
    awsRequestId: `test-request-${Date.now()}`,
    logGroupName: '/aws/lambda/webhook-handler',
    logStreamName: `2024/01/01/[\$LATEST]test-${Date.now()}`,
    getRemainingTimeInMillis: () => 30000,
    done: () => {},
    fail: () => {},
    succeed: () => {},
  };
}

/**
 * Create a mock RevenueCat webhook event
 */
function createMockEvent(eventType, userId, includeSignature = true) {
  const now = Date.now();
  const expiresAt = now + (30 * 24 * 60 * 60 * 1000); // 30 days from now
  
  // Base event structure matching RevenueCat's actual format
  let event = {
    id: `test-event-${now}`,
    event_timestamp_ms: now,
    product_id: 'catfish_pro_monthly',
    period_type: 'NORMAL',
    purchased_at_ms: now,
    expiration_at_ms: expiresAt,
    environment: 'SANDBOX',
    entitlement_ids: ['pro'],
    transaction_id: `test-txn-${now}`,
    original_transaction_id: `test-txn-${now}`,
    is_family_share: false,
    country_code: 'US',
    app_user_id: userId,
    original_app_user_id: userId,
    aliases: [`$RCAnonymousID:${userId}`],
    currency: 'USD',
    price: 9.99,
    price_in_purchased_currency: 9.99,
    store: 'APP_STORE',
    type: eventType,
    app_id: 'test-app-id',
    subscriber_attributes: {
      '$email': {
        updated_at_ms: now,
        value: `${userId}@example.com`
      }
    }
  };

  // Add entitlements based on event type
  if (eventType === 'INITIAL_PURCHASE' || eventType === 'RENEWAL' || eventType === 'UNCANCELLATION') {
    event.entitlements = {
      pro: {
        expires_date: new Date(expiresAt).toISOString(),
        product_identifier: 'catfish_pro_monthly',
        purchase_date: new Date(now).toISOString(),
      }
    };
  } else if (eventType === 'CANCELLATION') {
    // User cancelled but still has access until expiration
    event.entitlements = {
      pro: {
        expires_date: new Date(expiresAt).toISOString(),
        product_identifier: 'catfish_pro_monthly',
        purchase_date: new Date(now).toISOString(),
      }
    };
  } else if (eventType === 'EXPIRATION') {
    // Subscription expired - no active entitlements
    event.entitlements = {};
    event.entitlement_ids = [];
  } else if (eventType === 'BILLING_ISSUE') {
    // Payment failed but give grace period
    event.entitlements = {
      pro: {
        expires_date: new Date(expiresAt).toISOString(),
        product_identifier: 'catfish_pro_monthly',
        purchase_date: new Date(now).toISOString(),
      }
    };
  } else {
    event.entitlements = {};
  }

  // Wrap in RevenueCat webhook format (as RevenueCat actually sends it)
  const webhookPayload = {
    event: event,
    api_version: '1.0'
  };

  const bodyString = JSON.stringify(webhookPayload);
  
  // Generate signature if secret key is configured
  const secretKey = process.env.REVENUECAT_SECRET_KEY || '';
  const signature = includeSignature && secretKey ? generateSignature(bodyString, secretKey) : '';

  // Create Lambda event (as API Gateway would send it)
  const lambdaEvent = {
    httpMethod: 'POST',
    body: bodyString,
    headers: {
      'Content-Type': 'application/json',
      'X-RevenueCat-Signature': signature,
      'X-RevenueCat-Event-Name': eventType,
    },
    requestContext: {
      requestId: `test-request-${now}`,
      identity: {
        sourceIp: '127.0.0.1',
      },
    },
  };

  return lambdaEvent;
}

/**
 * Test the webhook handler with a specific event type
 */
async function testWebhook(eventType, userId) {
  console.log('\n' + '='.repeat(70));
  console.log('TESTING REVENUECAT WEBHOOK HANDLER');
  console.log('='.repeat(70));
  console.log('Event Type:', eventType);
  console.log('User ID:', userId);
  console.log('\nCalling handler...\n');

  try {
    // Test with signature
    const testEvent = createMockEvent(eventType, userId, true);
    
    console.log('📤 Sending webhook event:');
    const payload = JSON.parse(testEvent.body);
    console.log(JSON.stringify(payload, null, 2));
    console.log('\n');

    const mockContext = createMockContext();
    const result = await handler.handler(testEvent, mockContext);
    const responseBody = typeof result.body === 'string' ? JSON.parse(result.body) : result.body;

    console.log('Status Code:', result.statusCode);
    console.log('\n' + '-'.repeat(70));
    console.log('RESPONSE:');
    console.log('-'.repeat(70));

    if (result.statusCode === 200) {
      console.log('✅ SUCCESS');
      console.log('Message:', responseBody.message || responseBody.success);
    } else {
      console.log('❌ ERROR');
      console.log('Error:', responseBody.error || responseBody.message || 'Unknown error');
    }

    console.log('\n' + '-'.repeat(70));
    console.log('FULL RESPONSE:');
    console.log('-'.repeat(70));
    console.log(JSON.stringify(responseBody, null, 2));
    console.log('='.repeat(70) + '\n');

    return { success: result.statusCode === 200, responseBody };

  } catch (error) {
    console.error('\n❌ Error processing webhook:', error.message);
    if (error.stack) {
      console.error('\nStack trace:');
      console.error(error.stack);
    }
    return { success: false, error: error.message };
  }
}

/**
 * Test webhook without signature (should work if REVENUECAT_SECRET_KEY is not set)
 */
async function testWebhookWithoutSignature(eventType, userId) {
  console.log('\n' + '='.repeat(70));
  console.log('TESTING WEBHOOK WITHOUT SIGNATURE');
  console.log('='.repeat(70));
  
  const testEvent = createMockEvent(eventType, userId, false);
  testEvent.headers['X-RevenueCat-Signature'] = '';
  
  const mockContext = createMockContext();
  const result = await handler.handler(testEvent, mockContext);
  const responseBody = typeof result.body === 'string' ? JSON.parse(result.body) : result.body;
  
  console.log('Status Code:', result.statusCode);
  if (result.statusCode === 200) {
    console.log('✅ SUCCESS (signature verification skipped)');
  } else if (result.statusCode === 401) {
    console.log('❌ FAILED (signature required)');
  }
  console.log('='.repeat(70) + '\n');
  
  return { success: result.statusCode === 200, responseBody };
}

/**
 * Test invalid signature
 */
async function testWebhookInvalidSignature(eventType, userId) {
  console.log('\n' + '='.repeat(70));
  console.log('TESTING WEBHOOK WITH INVALID SIGNATURE');
  console.log('='.repeat(70));
  
  const testEvent = createMockEvent(eventType, userId, false);
  testEvent.headers['X-RevenueCat-Signature'] = 'invalid-signature-12345';
  
  const mockContext = createMockContext();
  const result = await handler.handler(testEvent, mockContext);
  const responseBody = typeof result.body === 'string' ? JSON.parse(result.body) : result.body;
  
  console.log('Status Code:', result.statusCode);
  if (result.statusCode === 401) {
    console.log('✅ CORRECTLY REJECTED invalid signature');
  } else {
    console.log('❌ SHOULD HAVE REJECTED invalid signature');
  }
  console.log('='.repeat(70) + '\n');
  
  return { success: result.statusCode === 401, responseBody };
}

/**
 * Run all tests
 */
async function runAllTests() {
  const userId = process.argv[3] || DEFAULT_USER_ID;
  
  console.log('🧪 Running comprehensive webhook tests...\n');
  
  const eventTypes = [
    'INITIAL_PURCHASE',
    'RENEWAL',
    'CANCELLATION',
    'EXPIRATION',
    'BILLING_ISSUE',
    'UNCANCELLATION'
  ];
  
  const results = [];
  
  for (const eventType of eventTypes) {
    console.log(`\n📋 Testing ${eventType}...`);
    const result = await testWebhook(eventType, userId);
    results.push({ eventType, ...result });
    
    // Small delay between tests
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  // Test signature validation
  console.log('\n📋 Testing signature validation...');
  await testWebhookWithoutSignature('INITIAL_PURCHASE', userId);
  await testWebhookInvalidSignature('INITIAL_PURCHASE', userId);
  
  // Summary
  console.log('\n' + '='.repeat(70));
  console.log('TEST SUMMARY');
  console.log('='.repeat(70));
  results.forEach(({ eventType, success }) => {
    console.log(`${success ? '✅' : '❌'} ${eventType}`);
  });
  console.log('='.repeat(70) + '\n');
}

/**
 * Main test function
 */
async function test() {
  const eventType = process.argv[2] || DEFAULT_EVENT_TYPE;
  const userId = process.argv[3] || DEFAULT_USER_ID;
  
  // Check if running all tests
  if (eventType === 'all' || eventType === 'ALL') {
    await runAllTests();
    return;
  }
  
  console.log('Testing RevenueCat Webhook handler locally...\n');
  
  // Check environment
  const secretKey = process.env.REVENUECAT_SECRET_KEY || '';
  if (secretKey) {
    console.log('✅ REVENUECAT_SECRET_KEY found (signature verification enabled)');
    console.log('   Key preview:', secretKey.substring(0, 10) + '...' + secretKey.substring(secretKey.length - 4));
  } else {
    console.log('⚠️  REVENUECAT_SECRET_KEY not set (signature verification disabled)');
    console.log('   Webhook will accept requests without signature verification');
  }
  
  console.log('📋 Table:', process.env.SUBSCRIPTIONS_TABLE || 'image-analysis-dev-subscriptions');
  console.log('📋 User Pool:', process.env.COGNITO_USER_POOL_ID || 'Not configured');
  console.log('');
  
  const result = await testWebhook(eventType, userId);
  
  if (!result.success) {
    process.exit(1);
  }
}

test();