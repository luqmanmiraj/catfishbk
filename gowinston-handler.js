// Load environment variables from .env file
require('dotenv').config();

const https = require('https');

/**
 * CORS headers
 */
function getCorsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
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
 * Call Gowinston API to detect AI images
 */
async function detectAIImage(url, version, token) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      url: url,
      version: version,
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

    req.write(postData);
    req.end();
  });
}

/**
 * Main Lambda handler
 */
exports.handler = async (event) => {
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

    // Get Gowinston token from environment variables
    // Check both GOWINSTON_TOKEN and GOWINSTON_API_KEY for compatibility
    const token = process.env.GOWINSTON_TOKEN || process.env.GOWINSTON_API_KEY;

    if (!token) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          success: false,
          error: 'Gowinston API token not configured. Please set GOWINSTON_TOKEN in environment variables.',
        }),
      };
    }

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

    // Validate required fields
    const { url, version } = body;

    if (!url) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          success: false,
          error: 'url is required',
        }),
      };
    }

    if (!version) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          success: false,
          error: 'version is required',
        }),
      };
    }

    // Call Gowinston API
    const result = await detectAIImage(url, version, token);

    if (result.success) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify(result.data),
      };
    } else {
      return {
        statusCode: result.statusCode || 500,
        headers,
        body: JSON.stringify({
          success: false,
          error: result.error,
          ...(result.data && { data: result.data }),
        }),
      };
    }
  } catch (error) {
    console.error('Error processing request:', error);

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
