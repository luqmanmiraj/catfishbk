/**
 * Device Scan Helpers
 * Shared utility functions for device-level free scan tracking.
 * Tracks how many free scans have been used per physical device to prevent
 * abuse via account switching, guest re-creation, or app reinstallation.
 */

require('dotenv').config();

const AWS = require('aws-sdk');

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

const DEVICE_SCANS_TABLE = process.env.DEVICE_SCANS_TABLE || 'image-analysis-dev-device-scans';
const PURCHASES_TABLE = process.env.PURCHASES_TABLE || 'image-analysis-dev-purchases';
const DEVICE_FREE_SCAN_LIMIT = parseInt(process.env.DEVICE_FREE_SCAN_LIMIT || '5', 10);

/**
 * Get the number of free scans used by a device
 * @param {string} deviceId - The device identifier
 * @returns {Promise<number>} Number of free scans used
 */
async function getDeviceScanCount(deviceId) {
  if (!deviceId || deviceId === 'unknown') {
    return 0;
  }

  try {
    const result = await dynamodb.get({
      TableName: DEVICE_SCANS_TABLE,
      Key: { deviceId },
    }).promise();

    return (result.Item && result.Item.freeScansUsed) || 0;
  } catch (error) {
    console.error('Error getting device scan count:', error);
    return 0;
  }
}

/**
 * Increment the device scan counter atomically and record the user association
 * @param {string} deviceId - The device identifier
 * @param {string} userId - The user who performed the scan
 * @returns {Promise<number>} New scan count after increment
 */
async function incrementDeviceScanCount(deviceId, userId) {
  if (!deviceId || deviceId === 'unknown') {
    console.warn('Cannot increment device scan count: invalid deviceId');
    return 0;
  }

  try {
    const now = new Date().toISOString();
    const updateExpression = userId
      ? 'SET freeScansUsed = if_not_exists(freeScansUsed, :zero) + :one, updatedAt = :now, createdAt = if_not_exists(createdAt, :now) ADD linkedUserIds :userIdSet'
      : 'SET freeScansUsed = if_not_exists(freeScansUsed, :zero) + :one, updatedAt = :now, createdAt = if_not_exists(createdAt, :now)';

    const expressionValues = {
      ':one': 1,
      ':zero': 0,
      ':now': now,
    };

    if (userId) {
      expressionValues[':userIdSet'] = dynamodb.createSet([userId]);
    }

    const result = await dynamodb.update({
      TableName: DEVICE_SCANS_TABLE,
      Key: { deviceId },
      UpdateExpression: updateExpression,
      ExpressionAttributeValues: expressionValues,
      ReturnValues: 'ALL_NEW',
    }).promise();

    const newCount = result.Attributes.freeScansUsed;
    console.log(`Device ${deviceId} free scan count incremented to ${newCount}`);
    return newCount;
  } catch (error) {
    console.error('Error incrementing device scan count:', error);
    throw error;
  }
}

/**
 * Check if a device has exhausted its free scan allotment
 * @param {string} deviceId - The device identifier
 * @returns {Promise<boolean>} True if device has used all free scans
 */
async function isDeviceExhausted(deviceId) {
  if (!deviceId || deviceId === 'unknown') {
    return false; // Can't enforce without a device ID
  }

  const count = await getDeviceScanCount(deviceId);
  return count >= DEVICE_FREE_SCAN_LIMIT;
}

/**
 * Check if a user has ever purchased tokens (i.e., is a paid user)
 * @param {string} userId - The Cognito user ID (sub)
 * @returns {Promise<boolean>} True if user has purchase records
 */
async function hasUserPurchased(userId) {
  if (!userId) {
    return false;
  }

  try {
    const result = await dynamodb.query({
      TableName: PURCHASES_TABLE,
      IndexName: 'userId-purchaseDate-index',
      KeyConditionExpression: 'userId = :uid',
      ExpressionAttributeValues: {
        ':uid': userId,
      },
      Limit: 1, // We only need to know if at least one purchase exists
      Select: 'COUNT',
    }).promise();

    return result.Count > 0;
  } catch (error) {
    console.error('Error checking user purchases:', error);
    return false; // Fail open — don't block paid users due to DB errors
  }
}

/**
 * Get the device free scan limit
 * @returns {number} The configured free scan limit per device
 */
function getDeviceFreeScanLimit() {
  return DEVICE_FREE_SCAN_LIMIT;
}

module.exports = {
  getDeviceScanCount,
  incrementDeviceScanCount,
  isDeviceExhausted,
  hasUserPurchased,
  getDeviceFreeScanLimit,
  DEVICE_FREE_SCAN_LIMIT,
};
