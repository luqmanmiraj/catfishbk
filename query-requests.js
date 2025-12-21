#!/usr/bin/env node

/**
 * Query script to get request statistics from DynamoDB
 * 
 * Usage:
 *   node query-requests.js [deviceId]
 *   node query-requests.js --stats
 *   node query-requests.js --devices
 */

require('dotenv').config();
const AWS = require('aws-sdk');

// Configure AWS
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
const tableName = `${process.env.SERVICE_NAME || 'image-analysis'}-${process.env.STAGE || 'dev'}-requests`;

/**
 * Get request count for a specific device
 */
async function getDeviceRequestCount(deviceId) {
  try {
    const result = await dynamodb.query({
      TableName: tableName,
      KeyConditionExpression: 'deviceId = :deviceId',
      ExpressionAttributeValues: {
        ':deviceId': deviceId,
      },
    }).promise();
    
    return {
      deviceId,
      totalRequests: result.Items.length,
      successfulRequests: result.Items.filter(item => item.success).length,
      failedRequests: result.Items.filter(item => !item.success).length,
      lastRequest: result.Items.length > 0 
        ? result.Items.sort((a, b) => b.timestamp.localeCompare(a.timestamp))[0]
        : null,
    };
  } catch (error) {
    console.error(`Error querying device ${deviceId}:`, error.message);
    return null;
  }
}

/**
 * Get all unique devices
 */
async function getAllDevices() {
  try {
    const devices = new Set();
    let lastEvaluatedKey = null;
    
    do {
      const params = {
        TableName: tableName,
        ProjectionExpression: 'deviceId',
      };
      
      if (lastEvaluatedKey) {
        params.ExclusiveStartKey = lastEvaluatedKey;
      }
      
      const result = await dynamodb.scan(params).promise();
      
      result.Items.forEach(item => {
        if (item.deviceId && item.deviceId !== 'unknown') {
          devices.add(item.deviceId);
        }
      });
      
      lastEvaluatedKey = result.LastEvaluatedKey;
    } while (lastEvaluatedKey);
    
    return Array.from(devices);
  } catch (error) {
    console.error('Error getting devices:', error.message);
    return [];
  }
}

/**
 * Get overall statistics
 */
async function getStats() {
  try {
    const devices = await getAllDevices();
    const stats = {
      totalDevices: devices.length,
      deviceStats: {},
      overallTotal: 0,
      overallSuccessful: 0,
      overallFailed: 0,
    };
    
    for (const deviceId of devices) {
      const deviceStats = await getDeviceRequestCount(deviceId);
      if (deviceStats) {
        stats.deviceStats[deviceId] = deviceStats;
        stats.overallTotal += deviceStats.totalRequests;
        stats.overallSuccessful += deviceStats.successfulRequests;
        stats.overallFailed += deviceStats.failedRequests;
      }
    }
    
    return stats;
  } catch (error) {
    console.error('Error getting stats:', error.message);
    return null;
  }
}

/**
 * Main function
 */
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0 || args[0] === '--stats') {
    console.log('Fetching overall statistics...\n');
    const stats = await getStats();
    
    if (stats) {
      console.log('=== Overall Statistics ===');
      console.log(`Total Devices: ${stats.totalDevices}`);
      console.log(`Total Requests: ${stats.overallTotal}`);
      console.log(`Successful: ${stats.overallSuccessful}`);
      console.log(`Failed: ${stats.overallFailed}`);
      console.log(`Success Rate: ${stats.overallTotal > 0 ? ((stats.overallSuccessful / stats.overallTotal) * 100).toFixed(2) : 0}%`);
      console.log('\n=== Per Device Statistics ===');
      
      // Sort by request count
      const sortedDevices = Object.entries(stats.deviceStats)
        .sort((a, b) => b[1].totalRequests - a[1].totalRequests);
      
      sortedDevices.forEach(([deviceId, deviceStats]) => {
        console.log(`\nDevice: ${deviceId}`);
        console.log(`  Total Requests: ${deviceStats.totalRequests}`);
        console.log(`  Successful: ${deviceStats.successfulRequests}`);
        console.log(`  Failed: ${deviceStats.failedRequests}`);
        if (deviceStats.lastRequest) {
          console.log(`  Last Request: ${deviceStats.lastRequest.timestamp}`);
        }
      });
    }
  } else if (args[0] === '--devices') {
    console.log('Fetching all devices...\n');
    const devices = await getAllDevices();
    console.log(`Total unique devices: ${devices.length}`);
    devices.forEach(deviceId => console.log(`  - ${deviceId}`));
  } else {
    const deviceId = args[0];
    console.log(`Fetching statistics for device: ${deviceId}\n`);
    const stats = await getDeviceRequestCount(deviceId);
    
    if (stats) {
      console.log('=== Device Statistics ===');
      console.log(`Device ID: ${stats.deviceId}`);
      console.log(`Total Requests: ${stats.totalRequests}`);
      console.log(`Successful: ${stats.successfulRequests}`);
      console.log(`Failed: ${stats.failedRequests}`);
      if (stats.lastRequest) {
        console.log(`\nLast Request:`);
        console.log(`  Timestamp: ${stats.lastRequest.timestamp}`);
        console.log(`  IP Address: ${stats.lastRequest.ipAddress}`);
        console.log(`  Success: ${stats.lastRequest.success}`);
      }
    } else {
      console.log('Device not found or error occurred.');
    }
  }
}

// Run if called directly
if (require.main === module) {
  main().catch(error => {
    console.error('Error:', error);
    process.exit(1);
  });
}

module.exports = { getDeviceRequestCount, getAllDevices, getStats };

