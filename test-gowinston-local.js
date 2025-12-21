/**
 * Local test script for the Gowinston Lambda function
 * 
 * Usage: 
 *   node test-gowinston-local.js [image-url] [version]
 * 
 * Examples:
 *   node test-gowinston-local.js
 *   node test-gowinston-local.js https://example.com/image.jpg
 *   node test-gowinston-local.js https://example.com/image.jpg v1
 * 
 * Environment variables are loaded from .env file automatically.
 * Make sure to set GOWINSTON_TOKEN in your .env file.
 */

// Load environment variables from .env file
require('dotenv').config();

const handler = require('./gowinston-handler');

// Default test image URL (you can replace this with your own)
const DEFAULT_TEST_URL = 'https://images.unsplash.com/photo-1541963463532-d68292c34d19';
const DEFAULT_VERSION = 'v1';

/**
 * Create test event with URL and version
 */
function createTestEvent(url, version) {
  return {
    httpMethod: 'POST',
    body: JSON.stringify({
      url: url,
      version: version,
    }),
    headers: {
      'Content-Type': 'application/json',
    },
    requestContext: {
      requestId: `test-request-${Date.now()}`,
      identity: {
        sourceIp: '127.0.0.1',
      },
    },
  };
}

/**
 * Test the Gowinston Lambda handler
 */
async function testGowinston(url, version) {
  console.log('\n' + '='.repeat(70));
  console.log('TESTING GOWINSTON LAMBDA FUNCTION');
  console.log('='.repeat(70));
  console.log('Image URL:', url);
  console.log('Version:', version);
  console.log('\nCalling handler...\n');

  try {
    const testEvent = createTestEvent(url, version);
    const result = await handler.handler(testEvent);
    const responseBody = typeof result.body === 'string' ? JSON.parse(result.body) : result.body;

    console.log('Status Code:', result.statusCode);
    console.log('\n' + '-'.repeat(70));
    console.log('RESPONSE:');
    console.log('-'.repeat(70));

    if (result.statusCode === 200) {
      console.log('✅ SUCCESS');
      console.log('\n📊 Gowinston API Response:');
      console.log(JSON.stringify(responseBody, null, 2));
    } else {
      console.log('❌ ERROR');
      console.log('Error:', responseBody.error || responseBody.message || 'Unknown error');
      if (responseBody.data) {
        console.log('\nResponse Data:');
        console.log(JSON.stringify(responseBody.data, null, 2));
      }
    }

    console.log('\n' + '-'.repeat(70));
    console.log('FULL LAMBDA RESPONSE:');
    console.log('-'.repeat(70));
    console.log(JSON.stringify(responseBody, null, 2));
    console.log('='.repeat(70) + '\n');

    return { success: result.statusCode === 200, responseBody };

  } catch (error) {
    console.error('\n❌ Error processing request:', error.message);
    if (error.stack) {
      console.error('\nStack trace:');
      console.error(error.stack);
    }
    return { success: false, error: error.message };
  }
}

/**
 * Main test function
 */
async function test() {
  console.log('Testing Gowinston Lambda function locally...\n');

  // Check environment variables
  const token = process.env.GOWINSTON_TOKEN || process.env.GOWINSTON_API_KEY;

  if (!token) {
    console.error('ERROR: Gowinston API token not found');
    console.error('Please set GOWINSTON_TOKEN in your .env file');
    process.exit(1);
  }

  console.log('Environment variables OK');
  console.log('Gowinston Token:', token.substring(0, 10) + '...' + token.substring(token.length - 4));

  // Get URL and version from command line arguments or use defaults
  const url = process.argv[2] || DEFAULT_TEST_URL;
  const version = process.argv[3] || DEFAULT_VERSION;

  const result = await testGowinston(url, version);

  if (!result.success) {
    process.exit(1);
  }
}

test();
