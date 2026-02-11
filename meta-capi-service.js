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

    const apiVersion = process.env.META_GRAPH_API_VERSION || 'v22.0';
    const url = `https://graph.facebook.com/${apiVersion}/${pixelId}/events`;
    
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
    advertiser_tracking_enabled, // ATT consent: 1 = granted, 0 = denied
    app_platform, // 'ios' or 'android'
    app_version, // e.g. '1.0.1'
    os_version, // e.g. '17.0'
    device_model, // e.g. 'iPhone15,2'
    device_locale, // e.g. 'en_US'
    device_timezone, // e.g. 'America/New_York'
    ...customData
  } = params;

  // Determine extinfo version prefix based on platform
  const extinfoVersion = app_platform === 'android' ? 'a2' : 'i2';
  const bundleId = app_platform === 'android' ? 'com.anonymous.catfish' : 'com.anonymous.catfish';

  const eventData = {
    event_name: eventName,
    event_time: Math.floor(Date.now() / 1000),
    event_id: eventId || `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`,
    action_source: 'app', // 'app' for mobile app events
    // app_data is required for action_source 'app'
    // Must include: advertiser_tracking_enabled, application_tracking_enabled, and extinfo
    app_data: {
      advertiser_tracking_enabled: advertiser_tracking_enabled !== undefined ? advertiser_tracking_enabled : 0,
      application_tracking_enabled: advertiser_tracking_enabled !== undefined ? advertiser_tracking_enabled : 0,
      // extinfo: 16-element array with device info (required for app events)
      // See: https://developers.facebook.com/docs/marketing-api/conversions-api/parameters/app-data/
      extinfo: [
        extinfoVersion,             // 0: version ('i2' iOS, 'a2' Android)
        bundleId,                   // 1: app package name
        app_version || '1.0.1',     // 2: short version
        app_version || '1.0.1',     // 3: long version
        os_version || '17.0',       // 4: OS version
        device_model || '',         // 5: device model
        device_locale || 'en_US',   // 6: locale
        '',                         // 7: timezone abbreviation
        '',                         // 8: carrier
        '',                         // 9: screen width
        '',                         // 10: screen height
        '',                         // 11: screen density
        '',                         // 12: CPU cores
        '',                         // 13: external storage size
        '',                         // 14: free external storage
        device_timezone || '',      // 15: device timezone
      ],
    },
  };

  // Only include event_source_url if it has a real value — Meta rejects null
  if (customData.source_url) {
    eventData.event_source_url = customData.source_url;
  }

  // Build user_data object
  const userData = {};
  if (user_id) {
    userData.external_id = hashValue(String(user_id));
  }
  if (email) {
    userData.em = hashValue(email); // Email must be hashed with SHA-256
  }
  if (phone) {
    userData.ph = hashValue(phone); // Phone must be hashed with SHA-256
  }
  if (client_ip_address) {
    userData.client_ip_address = client_ip_address;
  }
  if (client_user_agent) {
    userData.client_user_agent = client_user_agent;
  }
  if (fbc) {
    userData.fbc = fbc;
  }
  if (fbp) {
    userData.fbp = fbp;
  }

  // Only include user_data if it has at least one field
  if (Object.keys(userData).length > 0) {
    eventData.user_data = userData;
  }

  // Build custom_data object
  const customDataClean = {};
  Object.keys(customData).forEach((key) => {
    if (key !== 'source_url') {
      customDataClean[key] = customData[key];
    }
  });

  // Only include custom_data if it has at least one field
  if (Object.keys(customDataClean).length > 0) {
    eventData.custom_data = customDataClean;
  }

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
