/**
 * Test script to call the deployed Gowinston Lambda endpoint
 * 
 * Usage: 
 *   node test-gowinston-endpoint.js [endpoint-url] [image-url] [version]
 * 
 * Examples:
 *   node test-gowinston-endpoint.js
 *   node test-gowinston-endpoint.js https://xxxxx.execute-api.us-east-1.amazonaws.com/dev/gowinston/detect
 *   node test-gowinston-endpoint.js https://xxxxx.execute-api.us-east-1.amazonaws.com/dev/gowinston/detect https://example.com/image.jpg
 *   node test-gowinston-endpoint.js https://xxxxx.execute-api.us-east-1.amazonaws.com/dev/gowinston/detect https://example.com/image.jpg v1
 * 
 * You can also set GOWINSTON_ENDPOINT environment variable for the default endpoint.
 */

require('dotenv').config();
const axios = require('axios');

// Default endpoint (update this with your actual endpoint after deployment)
const DEFAULT_ENDPOINT = process.env.GOWINSTON_ENDPOINT || 'https://cw30abur3e.execute-api.us-east-1.amazonaws.com/dev/gowinston/detect';

// Default test image URL
const DEFAULT_TEST_URL = 'https://images.unsplash.com/photo-1541963463532-d68292c34d19';
const DEFAULT_VERSION = 'v1';

// Get parameters from command line arguments
const endpoint = process.argv[2] || DEFAULT_ENDPOINT;
const imageUrl = process.argv[3] || DEFAULT_TEST_URL;
const version = process.argv[4] || DEFAULT_VERSION;

/**
 * Format and display the response
 */
function displayResponse(response) {
  console.log('\n' + '='.repeat(70));
  console.log('LAMBDA RESPONSE');
  console.log('='.repeat(70));
  console.log('Status Code:', response.status);
  console.log('Status Text:', response.statusText);
  console.log('\n');

  const data = response.data;

  if (response.status === 200) {
    console.log('✅ SUCCESS');
    console.log('-'.repeat(70));
    console.log('\n📊 Gowinston API Response:');
    console.log(JSON.stringify(data, null, 2));
  } else {
    console.log('❌ ERROR');
    console.log('-'.repeat(70));
    if (data.error) {
      console.log('Error:', data.error);
    }
    if (data.message) {
      console.log('Message:', data.message);
    }
    if (data.data) {
      console.log('\nResponse Data:');
      console.log(JSON.stringify(data.data, null, 2));
    }
  }

  console.log('\n' + '='.repeat(70));
  console.log('FULL LAMBDA RESPONSE:');
  console.log('='.repeat(70));
  console.log(JSON.stringify(data, null, 2));
  console.log('='.repeat(70) + '\n');
}

/**
 * Test the deployed Gowinston endpoint
 */
async function testGowinstonEndpoint() {
  console.log('Testing Deployed Gowinston Lambda Endpoint');
  console.log('='.repeat(70));
  console.log('Endpoint:', endpoint);
  console.log('Image URL:', imageUrl);
  console.log('Version:', version);
  console.log('\nSending request to deployed Lambda...\n');

  try {
    const response = await axios.post(
      endpoint,
      {
        url: imageUrl,
        version: version,
      },
      {
        headers: {
          'Content-Type': 'application/json',
        },
        timeout: 30000, // 30 second timeout
      }
    );

    displayResponse(response);
    return { success: true, response: response.data };

  } catch (error) {
    console.error('\n❌ Request Failed');
    console.error('='.repeat(70));

    if (error.response) {
      // Server responded with error status
      console.error('Status Code:', error.response.status);
      console.error('Status Text:', error.response.statusText);
      console.error('\nResponse Data:');
      console.error(JSON.stringify(error.response.data, null, 2));
      displayResponse(error.response);
      return { success: false, error: error.response.data };
    } else if (error.request) {
      // Request was made but no response received
      console.error('No response received from server');
      console.error('Error:', error.message);
      if (error.code) {
        console.error('Error Code:', error.code);
      }
      return { success: false, error: error.message };
    } else {
      // Error setting up the request
      console.error('Error:', error.message);
      return { success: false, error: error.message };
    }
  }
}

// Run the test
testGowinstonEndpoint()
  .then((result) => {
    process.exit(result.success ? 0 : 1);
  })
  .catch((error) => {
    console.error('Unexpected error:', error);
    process.exit(1);
  });
