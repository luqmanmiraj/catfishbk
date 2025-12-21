# Device Tracking and Request Analytics

This document explains what device information is available from mobile application requests and how to track API usage per device.

## Available Device Information

When a mobile app makes a request to the Lambda endpoint, the following information is automatically extracted:

### From API Gateway Event Headers

1. **Device ID** (if sent by mobile app)
   - Header: `X-Device-ID` or `Device-ID`
   - Can also be sent in request body as `deviceId`
   - **Recommended**: Mobile apps should send a unique device identifier

2. **IP Address**
   - Extracted from `X-Forwarded-For` header or API Gateway request context
   - Useful for geolocation and security

3. **User Agent**
   - Browser/app information from `User-Agent` header
   - Identifies device type, OS, and app version

4. **Request ID**
   - Unique identifier for each request from API Gateway
   - Useful for debugging and tracing

5. **API Key ID** (if using API keys)
   - From API Gateway request context
   - Useful for API key-based tracking

6. **Account ID**
   - AWS account ID from request context

### From Request Body

- `deviceId`: Device identifier (if not in headers)
- `image`: Base64-encoded image data

## How Mobile Apps Should Send Device ID

### Option 1: Send in Header (Recommended)

```javascript
// React Native / Expo example
import * as Device from 'expo-device';
import * as Application from 'expo-application';

const getDeviceId = async () => {
  // Try to get a persistent device ID
  // Option 1: Use Expo's installation ID (persists across app reinstalls)
  const installationId = await Application.getInstallationIdAsync();
  
  // Option 2: Use device UUID (changes on app reinstall)
  // const deviceId = Device.modelId || Device.osInternalBuildId;
  
  return installationId;
};

const analyzeImage = async (imageUri) => {
  const deviceId = await getDeviceId();
  
  const response = await fetch(LAMBDA_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Device-ID': deviceId, // Send device ID in header
    },
    body: JSON.stringify({
      image: imageDataUrl,
    }),
  });
};
```

### Option 2: Send in Request Body

```javascript
const response = await fetch(LAMBDA_ENDPOINT, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    image: imageDataUrl,
    deviceId: deviceId, // Send device ID in body
  }),
});
```

## Request Tracking

All requests are automatically logged to:

1. **CloudWatch Logs**: Every request is logged with device information
2. **DynamoDB**: Persistent storage for analytics and querying

### DynamoDB Table Structure

**Table Name**: `image-analysis-dev-requests`

**Schema**:
- `deviceId` (String, Partition Key): Device identifier
- `timestamp` (String, Sort Key): ISO 8601 timestamp
- `ipAddress` (String): Client IP address
- `userAgent` (String): User agent string
- `requestId` (String): API Gateway request ID
- `success` (Boolean): Whether request succeeded
- `service` (String): Service name ('image-analysis')

## Querying Request Counts

### Get All Requests for a Device

```bash
aws dynamodb query \
  --table-name image-analysis-dev-requests \
  --key-condition-expression "deviceId = :deviceId" \
  --expression-attribute-values '{":deviceId":{"S":"DEVICE_ID_HERE"}}' \
  --region us-east-1
```

### Count Requests per Device

```bash
# Using AWS CLI with jq
aws dynamodb scan \
  --table-name image-analysis-dev-requests \
  --select COUNT \
  --filter-expression "deviceId = :deviceId" \
  --expression-attribute-values '{":deviceId":{"S":"DEVICE_ID_HERE"}}' \
  --region us-east-1
```

### Get Request Statistics (Using AWS CLI)

```bash
# Count total requests
aws dynamodb scan \
  --table-name image-analysis-dev-requests \
  --select COUNT \
  --region us-east-1

# Get unique device count
aws dynamodb scan \
  --table-name image-analysis-dev-requests \
  --projection-expression "deviceId" \
  --region us-east-1 | jq '.Items | unique_by(.deviceId.S) | length'
```

## Example: Query Script

Create a file `query-requests.js`:

```javascript
const AWS = require('aws-sdk');
const dynamodb = new AWS.DynamoDB.DocumentClient({ region: 'us-east-1' });

const tableName = 'image-analysis-dev-requests';

// Get request count for a specific device
async function getDeviceRequestCount(deviceId) {
  const result = await dynamodb.query({
    TableName: tableName,
    KeyConditionExpression: 'deviceId = :deviceId',
    ExpressionAttributeValues: {
      ':deviceId': deviceId,
    },
  }).promise();
  
  return result.Items.length;
}

// Get all unique devices
async function getAllDevices() {
  const result = await dynamodb.scan({
    TableName: tableName,
    ProjectionExpression: 'deviceId',
  }).promise();
  
  const uniqueDevices = [...new Set(result.Items.map(item => item.deviceId))];
  return uniqueDevices;
}

// Get request statistics
async function getStats() {
  const devices = await getAllDevices();
  const stats = {};
  
  for (const deviceId of devices) {
    const count = await getDeviceRequestCount(deviceId);
    stats[deviceId] = count;
  }
  
  return stats;
}

// Usage
getStats().then(stats => {
  console.log('Request counts per device:');
  console.log(JSON.stringify(stats, null, 2));
});
```

## CloudWatch Metrics

You can also create CloudWatch metrics from the logs:

1. Go to CloudWatch → Logs Insights
2. Select the log group: `/aws/lambda/image-analysis-dev-analyzeImage`
3. Query example:

```
fields @timestamp, deviceId
| filter @message like /REQUEST_TRACKING/
| stats count() by deviceId
```

## Best Practices

1. **Device ID Generation**:
   - Use a persistent identifier that survives app reinstalls
   - Consider using Expo's `Application.getInstallationIdAsync()` or similar
   - Don't use device serial numbers (privacy concerns)

2. **Privacy**:
   - Device IDs should be anonymized or hashed if containing PII
   - Consider GDPR/privacy regulations when storing device data

3. **Rate Limiting**:
   - Use device ID to implement rate limiting per device
   - Track request counts and implement throttling

4. **Analytics**:
   - Use DynamoDB queries for real-time analytics
   - Consider exporting to data warehouse for historical analysis
   - Use CloudWatch Metrics for dashboards

## Example: Rate Limiting Implementation

```javascript
async function checkRateLimit(deviceId) {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  
  const result = await dynamodb.query({
    TableName: tableName,
    KeyConditionExpression: 'deviceId = :deviceId AND #ts >= :time',
    ExpressionAttributeNames: {
      '#ts': 'timestamp',
    },
    ExpressionAttributeValues: {
      ':deviceId': deviceId,
      ':time': oneHourAgo,
    },
  }).promise();
  
  const requestCount = result.Items.length;
  const maxRequestsPerHour = 100;
  
  if (requestCount >= maxRequestsPerHour) {
    throw new Error('Rate limit exceeded');
  }
  
  return true;
}
```

