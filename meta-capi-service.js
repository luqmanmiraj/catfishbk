/**
 * Meta Conversions API (CAPI) Service
 * Sends events to Meta's Conversions API for server-side tracking
 */

const https = require('https');

/**
 * Send event to Meta Conversions API
 * @param {Object} eventData - Event data to send
 * @param {string} pixelId - Meta Pixel ID
 * @param {string} accessToken - Meta Access Token
 * @returns {Promise<Object>} Response from Meta API
 */
async function sendEventToCAPI(eventData, pixelId, accessToken) {
  return new Promise((resolve, reject) => {
    if (!pixelId || !accessToken) {
      reject(new Error('Meta Pixel ID and Access Token are required'));
      return;
    }

    const url = `https://graph.facebook.com/v18.0/${pixelId}/events`;
    
    const postData = JSON.stringify({
      data: [eventData],
      access_token: accessToken,
    });

    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
      },
    };

    const req = https.request(url, options, (res) => {
      let responseData = '';

      res.on('data', (chunk) => {
        responseData += chunk;
      });

      res.on('end', () => {
        try {
          const parsed = JSON.parse(responseData);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(parsed);
          } else {
            reject(new Error(`Meta CAPI error: ${parsed.error?.message || responseData}`));
          }
        } catch (error) {
          reject(new Error(`Failed to parse Meta CAPI response: ${error.message}`));
        }
      });
    });

    req.on('error', (error) => {
      reject(new Error(`Meta CAPI request failed: ${error.message}`));
    });

    req.write(postData);
    req.end();
  });
}

/**
 * Format event for Meta CAPI
 * @param {string} eventName - Name of the event
 * @param {Object} params - Event parameters
 * @param {string} eventId - Event ID for deduplication
 * @returns {Object} Formatted event data
 */
function formatEventForCAPI(eventName, params = {}, eventId = null) {
  const {
    user_id,
    email,
    phone,
    client_ip_address,
    client_user_agent,
    fbc, // Facebook Click ID
    fbp, // Facebook Browser ID
    ...customData
  } = params;

  const eventData = {
    event_name: eventName,
    event_time: Math.floor(Date.now() / 1000),
    event_id: eventId || `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`,
    event_source_url: customData.source_url || null,
    action_source: 'app', // 'app' for mobile app events
    user_data: {},
    custom_data: {},
  };

  // Add user data if available
  if (user_id) {
    eventData.user_data.external_id = user_id;
  }
  if (email) {
    eventData.user_data.em = email; // Email (hashed)
  }
  if (phone) {
    eventData.user_data.ph = phone; // Phone (hashed)
  }

  // Add browser/client identifiers
  if (client_ip_address) {
    eventData.user_data.client_ip_address = client_ip_address;
  }
  if (client_user_agent) {
    eventData.user_data.client_user_agent = client_user_agent;
  }
  if (fbc) {
    eventData.user_data.fbc = fbc;
  }
  if (fbp) {
    eventData.user_data.fbp = fbp;
  }

  // Add custom data
  Object.keys(customData).forEach((key) => {
    if (key !== 'source_url') {
      eventData.custom_data[key] = customData[key];
    }
  });

  return eventData;
}

/**
 * Hash email/phone for privacy (SHA-256)
 * @param {string} value - Value to hash
 * @returns {string} Hashed value
 */
function hashValue(value) {
  const crypto = require('crypto');
  return crypto.createHash('sha256').update(value.toLowerCase().trim()).digest('hex');
}

module.exports = {
  sendEventToCAPI,
  formatEventForCAPI,
  hashValue,
};
