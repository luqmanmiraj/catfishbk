// Load environment variables from .env file
require('dotenv').config();

const AWS = require('aws-sdk');
const { v4: uuidv4 } = require('uuid');

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
const dynamodbRaw = new AWS.DynamoDB();
const cognito = new AWS.CognitoIdentityServiceProvider();
const { TOKEN_PACKS } = require('./lib/tokens');

// Configuration
const USER_POOL_ID = process.env.COGNITO_USER_POOL_ID;
const ADMIN_GROUP_NAME = process.env.ADMIN_GROUP_NAME || 'admin';
const TOKENS_TABLE = process.env.TOKENS_TABLE || 'image-analysis-dev-tokens';
const PURCHASES_TABLE = process.env.PURCHASES_TABLE || 'image-analysis-dev-purchases';
const SCAN_HISTORY_TABLE = process.env.SCAN_HISTORY_TABLE || 'image-analysis-dev-scan-history';
const SCAN_COUNTS_TABLE = process.env.SCAN_COUNTS_TABLE || 'image-analysis-dev-scan-counts';
const DEVICE_SCANS_TABLE = process.env.DEVICE_SCANS_TABLE || 'image-analysis-dev-device-scans';
const SUBSCRIPTIONS_TABLE = process.env.SUBSCRIPTIONS_TABLE || 'image-analysis-dev-subscriptions';
const REQUESTS_TABLE = `${process.env.SERVICE_NAME || 'image-analysis'}-${process.env.STAGE || 'dev'}-requests`;

/**
 * CORS headers
 */
function getCorsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
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
 * Extract token from request headers
 */
function extractToken(event) {
  const requestHeaders = event.headers || {};
  const authHeader = requestHeaders.Authorization || requestHeaders.authorization;
  
  if (!authHeader) {
    return null;
  }
  
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  return token || null;
}

/**
 * Extract user ID from Cognito JWT token
 */
function getUserIdFromToken(token) {
  if (!token) {
    return null;
  }
  
  try {
    const tokenParts = token.split('.');
    if (tokenParts.length !== 3) {
      return null;
    }
    
    let payload;
    try {
      payload = JSON.parse(Buffer.from(tokenParts[1], 'base64').toString());
    } catch (e) {
      const base64Url = tokenParts[1].replace(/-/g, '+').replace(/_/g, '/');
      const base64 = base64Url + '='.repeat((4 - base64Url.length % 4) % 4);
      payload = JSON.parse(Buffer.from(base64, 'base64').toString());
    }
    
    return payload.sub || payload['cognito:username'] || payload.username;
  } catch (error) {
    console.error('Error extracting user ID from token:', error);
    return null;
  }
}

/**
 * Check if user is admin by checking Cognito groups
 */
async function isAdmin(userId) {
  if (!userId || !USER_POOL_ID) {
    return false;
  }
  
  try {
    const result = await cognito.adminListGroupsForUser({
      UserPoolId: USER_POOL_ID,
      Username: userId,
    }).promise();
    
    const groups = result.Groups || [];
    return groups.some(group => group.GroupName === ADMIN_GROUP_NAME);
  } catch (error) {
    console.error('Error checking admin status:', error);
    return false;
  }
}

/**
 * Verify admin token and get admin info
 */
async function verifyAdmin(token) {
  if (!token) {
    throw new Error('Authorization token required');
  }
  
  try {
    const userInfo = await cognito.getUser({
      AccessToken: token,
    }).promise();
    
    const userId = userInfo.Username;
    const adminStatus = await isAdmin(userId);
    
    if (!adminStatus) {
      throw new Error('User is not an admin');
    }
    
    const userAttributes = {};
    userInfo.UserAttributes.forEach(attr => {
      userAttributes[attr.Name] = attr.Value;
    });
    
    return {
      userId: userId,
      username: userInfo.Username,
      attributes: userAttributes,
      isAdmin: true,
    };
  } catch (error) {
    if (error.code === 'NotAuthorizedException') {
      throw new Error('Invalid or expired token');
    }
    throw error;
  }
}

/**
 * List all users with pagination
 */
async function listUsers(limit = 50, paginationToken = null, filter = null) {
  const params = {
    UserPoolId: USER_POOL_ID,
    Limit: Math.min(limit, 60), // Cognito max is 60
  };
  
  if (paginationToken) {
    params.PaginationToken = paginationToken;
  }
  
  if (filter) {
    params.Filter = filter;
  }
  
  try {
    const result = await cognito.listUsers(params).promise();
    
    const users = (result.Users || []).map(user => {
      const attributes = {};
      user.Attributes.forEach(attr => {
        attributes[attr.Name] = attr.Value;
      });
      
      return {
        userId: user.Username,
        username: user.Username,
        status: user.UserStatus,
        enabled: user.Enabled,
        createdAt: user.UserCreateDate,
        lastModified: user.UserLastModifiedDate,
        attributes: attributes,
      };
    });
    
    return {
      users: users,
      paginationToken: result.PaginationToken || null,
      count: users.length,
    };
  } catch (error) {
    console.error('Error listing users:', error);
    throw error;
  }
}

/**
 * Get detailed user info
 */
async function getUserDetails(userId) {
  try {
    // Get Cognito user info
    const cognitoUser = await cognito.adminGetUser({
      UserPoolId: USER_POOL_ID,
      Username: userId,
    }).promise();
    
    const attributes = {};
    cognitoUser.UserAttributes.forEach(attr => {
      attributes[attr.Name] = attr.Value;
    });
    
    // Get token balance
    let tokenBalance = 0;
    try {
      const tokenResult = await dynamodb.get({
        TableName: TOKENS_TABLE,
        Key: { userId: userId },
      }).promise();
      tokenBalance = tokenResult.Item?.balance || 0;
    } catch (error) {
      console.error('Error getting token balance:', error);
    }
    
    // Get scan count (from scan history)
    let scanCount = 0;
    try {
      const scanResult = await dynamodb.query({
        TableName: SCAN_HISTORY_TABLE,
        KeyConditionExpression: 'userId = :userId',
        ExpressionAttributeValues: {
          ':userId': userId,
        },
        Select: 'COUNT',
      }).promise();
      scanCount = scanResult.Count || 0;
    } catch (error) {
      console.error('Error getting scan count:', error);
    }
    
    // Get purchase count
    let purchaseCount = 0;
    let totalSpent = 0;
    try {
      const purchaseResult = await dynamodb.query({
        TableName: PURCHASES_TABLE,
        IndexName: 'userId-purchaseDate-index',
        KeyConditionExpression: 'userId = :userId',
        ExpressionAttributeValues: {
          ':userId': userId,
        },
      }).promise();
      purchaseCount = purchaseResult.Items?.length || 0;
      totalSpent = purchaseResult.Items?.reduce((sum, item) => sum + (item.price || 0), 0) || 0;
    } catch (error) {
      console.error('Error getting purchase count:', error);
    }
    
    return {
      userId: cognitoUser.Username,
      username: cognitoUser.Username,
      status: cognitoUser.UserStatus,
      enabled: cognitoUser.Enabled,
      createdAt: cognitoUser.UserCreateDate,
      lastModified: cognitoUser.UserLastModifiedDate,
      attributes: attributes,
      tokenBalance: tokenBalance,
      scanCount: scanCount,
      purchaseCount: purchaseCount,
      totalSpent: totalSpent,
    };
  } catch (error) {
    if (error.code === 'UserNotFoundException') {
      throw new Error('User not found');
    }
    throw error;
  }
}

/**
 * Update user attributes
 */
async function updateUser(userId, updates) {
  const userAttributes = [];
  
  if (updates.email) {
    userAttributes.push({ Name: 'email', Value: updates.email });
  }
  if (updates.name) {
    userAttributes.push({ Name: 'name', Value: updates.name });
  }
  
  const params = {
    UserPoolId: USER_POOL_ID,
    Username: userId,
  };
  
  if (userAttributes.length > 0) {
    params.UserAttributes = userAttributes;
  }
  
  if (updates.enabled !== undefined) {
    if (updates.enabled) {
      await cognito.adminEnableUser({
        UserPoolId: USER_POOL_ID,
        Username: userId,
      }).promise();
    } else {
      await cognito.adminDisableUser({
        UserPoolId: USER_POOL_ID,
        Username: userId,
      }).promise();
    }
  }
  
  if (userAttributes.length > 0) {
    await cognito.adminUpdateUserAttributes(params).promise();
  }
  
  return await getUserDetails(userId);
}

/**
 * Delete user
 */
async function deleteUser(userId) {
  try {
    // Delete from Cognito
    await cognito.adminDeleteUser({
      UserPoolId: USER_POOL_ID,
      Username: userId,
    }).promise();
    
    // Optionally clean up DynamoDB records
    // Note: We might want to keep historical data, so this is optional
    // await dynamodb.delete({ TableName: TOKENS_TABLE, Key: { userId } }).promise();
    
    return { success: true, message: 'User deleted successfully' };
  } catch (error) {
    if (error.code === 'UserNotFoundException') {
      throw new Error('User not found');
    }
    throw error;
  }
}

/**
 * Add tokens to user
 */
async function addTokensToUser(userId, amount) {
  try {
    const result = await dynamodb.update({
      TableName: TOKENS_TABLE,
      Key: { userId: userId },
      UpdateExpression: 'SET #balance = if_not_exists(#balance, :zero) + :amount, #updatedAt = :now',
      ExpressionAttributeNames: {
        '#balance': 'balance',
        '#updatedAt': 'updatedAt',
      },
      ExpressionAttributeValues: {
        ':zero': 0,
        ':amount': amount,
        ':now': new Date().toISOString(),
      },
      ReturnValues: 'ALL_NEW',
    }).promise();
    
    return {
      success: true,
      tokenBalance: result.Attributes.balance,
      tokensAdded: amount,
    };
  } catch (error) {
    console.error('Error adding tokens:', error);
    throw error;
  }
}

/**
 * Set token balance (override)
 */
async function setTokenBalance(userId, balance) {
  try {
    const result = await dynamodb.update({
      TableName: TOKENS_TABLE,
      Key: { userId: userId },
      UpdateExpression: 'SET #balance = :balance, #updatedAt = :now',
      ExpressionAttributeNames: {
        '#balance': 'balance',
        '#updatedAt': 'updatedAt',
      },
      ExpressionAttributeValues: {
        ':balance': balance,
        ':now': new Date().toISOString(),
      },
      ReturnValues: 'ALL_NEW',
    }).promise();
    
    return {
      success: true,
      tokenBalance: result.Attributes.balance,
    };
  } catch (error) {
    console.error('Error setting token balance:', error);
    throw error;
  }
}

/**
 * Get dashboard analytics
 */
async function getDashboardAnalytics() {
  try {
    // Get total users count by paginating through all users
    let totalUsers = 0;
    try {
      let paginationToken = null;
      do {
        const params = {
          UserPoolId: USER_POOL_ID,
          Limit: 60, // Max limit for Cognito
        };
        if (paginationToken) {
          params.PaginationToken = paginationToken;
        }
        
        const userResult = await cognito.listUsers(params).promise();
        totalUsers += (userResult.Users || []).length;
        paginationToken = userResult.PaginationToken || null;
      } while (paginationToken);
      
      console.log(`Total users counted: ${totalUsers}`);
    } catch (error) {
      console.error('Error getting user count:', error);
    }
    
    // Get total scans count
    let totalScans = 0;
    try {
      const scanResult = await dynamodb.scan({
        TableName: SCAN_HISTORY_TABLE,
        Select: 'COUNT',
      }).promise();
      totalScans = scanResult.Count || 0;
    } catch (error) {
      console.error('Error getting scan count:', error);
    }
    
    // Get total purchases and revenue
    let totalPurchases = 0;
    let totalRevenue = 0;
    try {
      const purchaseResult = await dynamodb.scan({
        TableName: PURCHASES_TABLE,
      }).promise();
      totalPurchases = purchaseResult.Items?.length || 0;
      totalRevenue = purchaseResult.Items?.reduce((sum, item) => sum + (item.price || 0), 0) || 0;
    } catch (error) {
      console.error('Error getting purchase stats:', error);
    }
    
    // Get total token balance across all users
    let totalTokens = 0;
    try {
      const tokenResult = await dynamodb.scan({
        TableName: TOKENS_TABLE,
      }).promise();
      totalTokens = tokenResult.Items?.reduce((sum, item) => sum + (item.balance || 0), 0) || 0;
    } catch (error) {
      console.error('Error getting total tokens:', error);
    }
    
    return {
      totalUsers: totalUsers, // Will need pagination to get accurate count
      totalScans: totalScans,
      totalPurchases: totalPurchases,
      totalRevenue: totalRevenue,
      totalTokens: totalTokens,
    };
  } catch (error) {
    console.error('Error getting dashboard analytics:', error);
    throw error;
  }
}

/**
 * Get user's scan history
 */
async function getUserScans(userId, limit = 50, lastEvaluatedKey = null) {
  const params = {
    TableName: SCAN_HISTORY_TABLE,
    KeyConditionExpression: 'userId = :userId',
    ExpressionAttributeValues: {
      ':userId': userId,
    },
    ScanIndexForward: false,
    Limit: limit,
  };
  
  if (lastEvaluatedKey) {
    params.ExclusiveStartKey = lastEvaluatedKey;
  }
  
  try {
    const result = await dynamodb.query(params).promise();
    return {
      scans: result.Items || [],
      lastEvaluatedKey: result.LastEvaluatedKey || null,
      count: result.Count || 0,
    };
  } catch (error) {
    console.error('Error getting user scans:', error);
    throw error;
  }
}

/**
 * Get all scans with pagination
 */
async function getAllScans(limit = 50, lastEvaluatedKey = null) {
  const params = {
    TableName: SCAN_HISTORY_TABLE,
    Limit: limit,
  };
  
  if (lastEvaluatedKey) {
    params.ExclusiveStartKey = lastEvaluatedKey;
  }
  
  try {
    const result = await dynamodb.scan(params).promise();
    return {
      scans: result.Items || [],
      lastEvaluatedKey: result.LastEvaluatedKey || null,
      count: result.Count || 0,
    };
  } catch (error) {
    console.error('Error getting all scans:', error);
    throw error;
  }
}

/**
 * Get user's purchases
 */
async function getUserPurchases(userId, limit = 50, lastEvaluatedKey = null) {
  const params = {
    TableName: PURCHASES_TABLE,
    IndexName: 'userId-purchaseDate-index',
    KeyConditionExpression: 'userId = :userId',
    ExpressionAttributeValues: {
      ':userId': userId,
    },
    ScanIndexForward: false,
    Limit: limit,
  };
  
  if (lastEvaluatedKey) {
    params.ExclusiveStartKey = lastEvaluatedKey;
  }
  
  try {
    const result = await dynamodb.query(params).promise();
    return {
      purchases: result.Items || [],
      lastEvaluatedKey: result.LastEvaluatedKey || null,
      count: result.Count || 0,
    };
  } catch (error) {
    console.error('Error getting user purchases:', error);
    throw error;
  }
}

/**
 * Get all purchases with pagination
 */
async function getAllPurchases(limit = 50, lastEvaluatedKey = null) {
  const params = {
    TableName: PURCHASES_TABLE,
    Limit: limit,
  };
  
  if (lastEvaluatedKey) {
    params.ExclusiveStartKey = lastEvaluatedKey;
  }
  
  try {
    const result = await dynamodb.scan(params).promise();
    // Sort by purchaseDate descending
    const sortedItems = (result.Items || []).sort((a, b) => {
      return new Date(b.purchaseDate || b.createdAt) - new Date(a.purchaseDate || a.createdAt);
    });
    
    return {
      purchases: sortedItems,
      lastEvaluatedKey: result.LastEvaluatedKey || null,
      count: result.Count || 0,
    };
  } catch (error) {
    console.error('Error getting all purchases:', error);
    throw error;
  }
}

/**
 * Get recent activity: signups, purchases, scans
 */
async function getRecentActivity() {
  const [recentSignups, recentPurchases, recentScans] = await Promise.all([
    (async () => {
      try {
        const result = await cognito.listUsers({
          UserPoolId: USER_POOL_ID,
          Limit: 10,
        }).promise();
        return (result.Users || []).map(user => {
          const attrs = {};
          user.Attributes.forEach(a => { attrs[a.Name] = a.Value; });
          return {
            userId: user.Username,
            username: user.Username,
            email: attrs.email || '',
            createdAt: user.UserCreateDate,
          };
        }).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      } catch (err) {
        console.error('Error fetching recent signups:', err);
        return [];
      }
    })(),
    (async () => {
      try {
        const result = await dynamodb.scan({
          TableName: PURCHASES_TABLE,
          Limit: 50,
        }).promise();
        return (result.Items || [])
          .sort((a, b) => new Date(b.purchaseDate || b.createdAt) - new Date(a.purchaseDate || a.createdAt))
          .slice(0, 10)
          .map(p => ({
            purchaseId: p.purchaseId,
            userId: p.userId,
            packId: p.packId,
            tokens: p.tokens,
            price: p.price,
            source: p.source || 'unknown',
            purchaseDate: p.purchaseDate,
          }));
      } catch (err) {
        console.error('Error fetching recent purchases:', err);
        return [];
      }
    })(),
    (async () => {
      try {
        const result = await dynamodb.scan({
          TableName: SCAN_HISTORY_TABLE,
          Limit: 50,
        }).promise();
        return (result.Items || [])
          .sort((a, b) => new Date(b.timestamp || b.createdAt) - new Date(a.timestamp || a.createdAt))
          .slice(0, 10)
          .map(s => ({
            scanId: s.scanId,
            userId: s.userId,
            timestamp: s.timestamp,
            status: s.status,
            label: s.label || null,
          }));
      } catch (err) {
        console.error('Error fetching recent scans:', err);
        return [];
      }
    })(),
  ]);

  return { recentSignups, recentPurchases, recentScans };
}

/**
 * Get user breakdown / segmentation stats
 */
async function getUserBreakdown() {
  const [totalRegistered, guestDevices, usersWithPurchases, usersWithBalance, activeUsersLast30Days] = await Promise.all([
    (async () => {
      try {
        const poolInfo = await cognito.describeUserPool({ UserPoolId: USER_POOL_ID }).promise();
        return poolInfo.UserPool?.EstimatedNumberOfUsers || 0;
      } catch (err) {
        console.error('Error getting user pool stats:', err);
        return 0;
      }
    })(),
    (async () => {
      try {
        const result = await dynamodb.scan({
          TableName: DEVICE_SCANS_TABLE,
          Select: 'COUNT',
        }).promise();
        return result.Count || 0;
      } catch (err) {
        console.error('Error getting device count:', err);
        return 0;
      }
    })(),
    (async () => {
      try {
        const result = await dynamodb.scan({
          TableName: PURCHASES_TABLE,
          ProjectionExpression: 'userId',
        }).promise();
        const uniqueUsers = new Set((result.Items || []).map(i => i.userId));
        return uniqueUsers.size;
      } catch (err) {
        console.error('Error getting purchase users:', err);
        return 0;
      }
    })(),
    (async () => {
      try {
        const result = await dynamodb.scan({
          TableName: TOKENS_TABLE,
          FilterExpression: '#bal > :zero',
          ExpressionAttributeNames: { '#bal': 'balance' },
          ExpressionAttributeValues: { ':zero': 0 },
          Select: 'COUNT',
        }).promise();
        return result.Count || 0;
      } catch (err) {
        console.error('Error getting balance count:', err);
        return 0;
      }
    })(),
    (async () => {
      try {
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        const result = await dynamodb.scan({
          TableName: SCAN_HISTORY_TABLE,
          FilterExpression: '#ts > :since',
          ExpressionAttributeNames: { '#ts': 'timestamp' },
          ExpressionAttributeValues: { ':since': thirtyDaysAgo },
          ProjectionExpression: 'userId',
        }).promise();
        const uniqueUsers = new Set((result.Items || []).map(i => i.userId));
        return uniqueUsers.size;
      } catch (err) {
        console.error('Error getting active users:', err);
        return 0;
      }
    })(),
  ]);

  return { totalRegistered, guestDevices, usersWithPurchases, usersWithBalance, activeUsersLast30Days };
}

/**
 * Get sanitized system configuration (no secrets)
 */
function getSystemConfig() {
  const stripeKey = process.env.STRIPE_SECRET_KEY || '';
  const stripeMode = stripeKey.startsWith('sk_live_') ? 'live' : 'test';

  const pricesConfigured = [];
  if (process.env.STRIPE_PRICE_PACK_15) pricesConfigured.push('pack_15');
  if (process.env.STRIPE_PRICE_PACK_50) pricesConfigured.push('pack_50');
  if (process.env.STRIPE_PRICE_PACK_100) pricesConfigured.push('pack_100');

  const poolId = process.env.COGNITO_USER_POOL_ID || '';
  const underscoreIdx = poolId.indexOf('_');
  const maskedPoolId = poolId.length > 8
    ? poolId.substring(0, underscoreIdx + 1) + '***' + poolId.slice(-4)
    : poolId;

  return {
    stage: process.env.STAGE || 'dev',
    region: process.env.AWS_REGION || 'us-east-1',
    serviceName: process.env.SERVICE_NAME || 'image-analysis',
    thresholds: {
      deepfakeAuthentic: parseFloat(process.env.DEEPFAKE_THRESHOLD_AUTHENTIC) || null,
      deepfakeDeepfake: parseFloat(process.env.DEEPFAKE_THRESHOLD_DEEPFAKE) || null,
      gowinstonAuthentic: parseFloat(process.env.GOWINSTON_THRESHOLD_AUTHENTIC) || null,
      gowinstonDeepfake: parseFloat(process.env.GOWINSTON_THRESHOLD_DEEPFAKE) || null,
    },
    deviceFreeScanLimit: parseInt(process.env.DEVICE_FREE_SCAN_LIMIT || '5', 10),
    scanPacks: TOKEN_PACKS,
    s3BucketName: process.env.S3_BUCKET_NAME || '',
    cognitoUserPoolId: maskedPoolId,
    integrations: {
      sentryConfigured: !!process.env.SENTRY_DSN,
      metaPixelConfigured: !!process.env.META_PIXEL_ID,
      revenueCatConfigured: !!process.env.REVENUECAT_SECRET_KEY,
    },
    stripe: {
      mode: stripeMode,
      pricesConfigured,
      webhookConfigured: !!process.env.STRIPE_WEBHOOK_SECRET,
      webAppUrl: process.env.WEB_APP_URL || 'http://localhost:3000',
    },
  };
}

/**
 * Get DynamoDB table statistics via DescribeTable
 */
async function getTableStats() {
  const tables = [
    { name: 'requests', fullName: REQUESTS_TABLE },
    { name: 'subscriptions', fullName: SUBSCRIPTIONS_TABLE },
    { name: 'scan-counts', fullName: SCAN_COUNTS_TABLE },
    { name: 'scan-history', fullName: SCAN_HISTORY_TABLE },
    { name: 'tokens', fullName: TOKENS_TABLE },
    { name: 'purchases', fullName: PURCHASES_TABLE },
    { name: 'device-scans', fullName: DEVICE_SCANS_TABLE },
  ];

  return Promise.all(
    tables.map(async (table) => {
      try {
        const desc = await dynamodbRaw.describeTable({ TableName: table.fullName }).promise();
        return {
          name: table.name,
          fullName: table.fullName,
          itemCount: desc.Table?.ItemCount || 0,
          sizeBytes: desc.Table?.TableSizeBytes || 0,
        };
      } catch (err) {
        console.error(`Error describing table ${table.fullName}:`, err);
        return {
          name: table.name,
          fullName: table.fullName,
          itemCount: -1,
          sizeBytes: -1,
          error: err.message,
        };
      }
    })
  );
}

/**
 * Get unified activity timeline for a specific user
 */
async function getUserActivity(userId, limit = 50, offset = 0) {
  const [scans, purchases, signupDate] = await Promise.all([
    (async () => {
      try {
        const result = await dynamodb.query({
          TableName: SCAN_HISTORY_TABLE,
          KeyConditionExpression: 'userId = :userId',
          ExpressionAttributeValues: { ':userId': userId },
        }).promise();
        return (result.Items || []).map(s => ({
          type: 'scan',
          timestamp: s.timestamp || s.createdAt,
          scanId: s.scanId,
          status: s.status,
          label: s.label || null,
          deepfakeScore: s.deepfakeScore ?? null,
          s3Url: s.s3Url || null,
        }));
      } catch (err) {
        console.error('Error fetching user scans for activity:', err);
        return [];
      }
    })(),
    (async () => {
      try {
        const result = await dynamodb.query({
          TableName: PURCHASES_TABLE,
          IndexName: 'userId-purchaseDate-index',
          KeyConditionExpression: 'userId = :userId',
          ExpressionAttributeValues: { ':userId': userId },
        }).promise();
        return (result.Items || []).map(p => ({
          type: 'purchase',
          timestamp: p.purchaseDate || p.createdAt,
          purchaseId: p.purchaseId,
          packId: p.packId,
          tokens: p.tokens,
          price: p.price,
          source: p.source || 'unknown',
        }));
      } catch (err) {
        console.error('Error fetching user purchases for activity:', err);
        return [];
      }
    })(),
    (async () => {
      try {
        const user = await cognito.adminGetUser({
          UserPoolId: USER_POOL_ID,
          Username: userId,
        }).promise();
        return user.UserCreateDate;
      } catch (err) {
        console.error('Error fetching user signup date:', err);
        return null;
      }
    })(),
  ]);

  const events = [...scans, ...purchases];
  if (signupDate) {
    events.push({ type: 'signup', timestamp: new Date(signupDate).toISOString() });
  }

  events.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  const total = events.length;
  const paginated = events.slice(offset, offset + limit);

  return { events: paginated, total, count: paginated.length, hasMore: offset + limit < total };
}

/**
 * Lambda handler
 */
exports.handler = async (event) => {
  console.log('Admin handler event:', JSON.stringify(event, null, 2));
  
  const headers = getCorsHeaders();
  
  // Handle preflight OPTIONS request
  if (event.httpMethod === 'OPTIONS') {
    return handleOptions();
  }
  
  // Extract token and verify admin
  const token = extractToken(event);
  if (!token) {
    return {
      statusCode: 401,
      headers,
      body: JSON.stringify({
        success: false,
        error: 'Authorization token required',
      }),
    };
  }
  
  // Verify admin status
  let adminInfo;
  try {
    adminInfo = await verifyAdmin(token);
  } catch (error) {
    return {
      statusCode: 403,
      headers,
      body: JSON.stringify({
        success: false,
        error: error.message || 'Unauthorized: Admin access required',
      }),
    };
  }
  
  // Parse request
  const path = event.path || event.requestContext?.path || event.rawPath || '';
  const method = event.httpMethod || event.requestContext?.httpMethod || '';
  
  let body;
  try {
    body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body || {};
  } catch (error) {
    body = {};
  }
  
  const queryParams = event.queryStringParameters || {};
  
  try {
    // Authentication endpoints
    if (path.includes('/admin/auth/verify') && method === 'POST') {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          admin: adminInfo,
        }),
      };
    }
    
    // User activity timeline endpoint (must be checked before generic /admin/users GET)
    if (path.includes('/admin/users') && path.includes('/activity') && method === 'GET') {
      const userIdMatch = path.match(/\/admin\/users\/([^\/]+)\/activity/);
      if (!userIdMatch) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ success: false, error: 'User ID required' }),
        };
      }
      const userId = userIdMatch[1];
      const limit = parseInt(queryParams.limit || '50', 10);
      const offset = parseInt(queryParams.offset || '0', 10);
      const result = await getUserActivity(userId, limit, offset);
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, ...result }),
      };
    }

    // User management endpoints
    if (path.includes('/admin/users') && method === 'GET') {
      // Check if it's a specific user
      const userIdMatch = path.match(/\/admin\/users\/([^\/]+)$/);
      if (userIdMatch) {
        const userId = userIdMatch[1];
        const userDetails = await getUserDetails(userId);
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            success: true,
            user: userDetails,
          }),
        };
      }
      
      // List users
      const limit = parseInt(queryParams.limit || '50', 10);
      const paginationToken = queryParams.paginationToken || null;
      const filter = queryParams.filter || null;
      
      const result = await listUsers(limit, paginationToken, filter);
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          ...result,
        }),
      };
    }
    
    if (path.includes('/admin/users') && method === 'PUT') {
      const userIdMatch = path.match(/\/admin\/users\/([^\/]+)$/);
      if (!userIdMatch) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({
            success: false,
            error: 'User ID required',
          }),
        };
      }
      
      const userId = userIdMatch[1];
      const updatedUser = await updateUser(userId, body);
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          user: updatedUser,
        }),
      };
    }
    
    if (path.includes('/admin/users') && method === 'DELETE') {
      const userIdMatch = path.match(/\/admin\/users\/([^\/]+)$/);
      if (!userIdMatch) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({
            success: false,
            error: 'User ID required',
          }),
        };
      }
      
      const userId = userIdMatch[1];
      const result = await deleteUser(userId);
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify(result),
      };
    }
    
    // Token management endpoints
    if (path.includes('/admin/users') && path.includes('/tokens') && method === 'GET') {
      const userIdMatch = path.match(/\/admin\/users\/([^\/]+)\/tokens/);
      if (!userIdMatch) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({
            success: false,
            error: 'User ID required',
          }),
        };
      }
      
      const userId = userIdMatch[1];
      const userDetails = await getUserDetails(userId);
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          tokenBalance: userDetails.tokenBalance,
          userId: userId,
        }),
      };
    }
    
    if (path.includes('/admin/users') && path.includes('/tokens/add') && method === 'POST') {
      const userIdMatch = path.match(/\/admin\/users\/([^\/]+)\/tokens\/add/);
      if (!userIdMatch) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({
            success: false,
            error: 'User ID required',
          }),
        };
      }
      
      const userId = userIdMatch[1];
      const amount = parseInt(body.amount || body.tokens || '0', 10);
      
      if (!amount || amount <= 0) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({
            success: false,
            error: 'Valid token amount required',
          }),
        };
      }
      
      const result = await addTokensToUser(userId, amount);
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          ...result,
        }),
      };
    }
    
    if (path.includes('/admin/users') && path.includes('/tokens/set') && method === 'POST') {
      const userIdMatch = path.match(/\/admin\/users\/([^\/]+)\/tokens\/set/);
      if (!userIdMatch) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({
            success: false,
            error: 'User ID required',
          }),
        };
      }
      
      const userId = userIdMatch[1];
      const balance = parseInt(body.balance || body.tokens || '0', 10);
      
      if (balance < 0) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({
            success: false,
            error: 'Token balance cannot be negative',
          }),
        };
      }
      
      const result = await setTokenBalance(userId, balance);
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          ...result,
        }),
      };
    }
    
    // Analytics endpoints
    if (path.includes('/admin/analytics/dashboard') && method === 'GET') {
      const analytics = await getDashboardAnalytics();
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          analytics: analytics,
        }),
      };
    }
    
    // Scan management endpoints
    if (path.includes('/admin/users') && path.includes('/scans') && method === 'GET') {
      const userIdMatch = path.match(/\/admin\/users\/([^\/]+)\/scans/);
      if (!userIdMatch) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({
            success: false,
            error: 'User ID required',
          }),
        };
      }
      
      const userId = userIdMatch[1];
      const limit = parseInt(queryParams.limit || '50', 10);
      const lastEvaluatedKey = queryParams.lastEvaluatedKey 
        ? JSON.parse(decodeURIComponent(queryParams.lastEvaluatedKey))
        : null;
      
      const result = await getUserScans(userId, limit, lastEvaluatedKey);
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          ...result,
        }),
      };
    }
    
    if (path.includes('/admin/scans') && method === 'GET' && !path.includes('/users/')) {
      const limit = parseInt(queryParams.limit || '50', 10);
      const lastEvaluatedKey = queryParams.lastEvaluatedKey 
        ? JSON.parse(decodeURIComponent(queryParams.lastEvaluatedKey))
        : null;
      
      const result = await getAllScans(limit, lastEvaluatedKey);
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          ...result,
        }),
      };
    }
    
    // Purchase management endpoints
    if (path.includes('/admin/users') && path.includes('/purchases') && method === 'GET') {
      const userIdMatch = path.match(/\/admin\/users\/([^\/]+)\/purchases/);
      if (!userIdMatch) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({
            success: false,
            error: 'User ID required',
          }),
        };
      }
      
      const userId = userIdMatch[1];
      const limit = parseInt(queryParams.limit || '50', 10);
      const lastEvaluatedKey = queryParams.lastEvaluatedKey 
        ? JSON.parse(decodeURIComponent(queryParams.lastEvaluatedKey))
        : null;
      
      const result = await getUserPurchases(userId, limit, lastEvaluatedKey);
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          ...result,
        }),
      };
    }
    
    if (path.includes('/admin/purchases') && method === 'GET' && !path.includes('/users/')) {
      const limit = parseInt(queryParams.limit || '50', 10);
      const lastEvaluatedKey = queryParams.lastEvaluatedKey 
        ? JSON.parse(decodeURIComponent(queryParams.lastEvaluatedKey))
        : null;
      
      const result = await getAllPurchases(limit, lastEvaluatedKey);
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          ...result,
        }),
      };
    }
    
    // Activity feed endpoint
    if (path.includes('/admin/analytics/activity') && method === 'GET') {
      const activity = await getRecentActivity();
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, activity }),
      };
    }

    // User breakdown endpoint
    if (path.includes('/admin/analytics/breakdown') && method === 'GET') {
      const breakdown = await getUserBreakdown();
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, breakdown }),
      };
    }

    // System config endpoint
    if (path.includes('/admin/system/config') && method === 'GET') {
      const config = getSystemConfig();
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, config }),
      };
    }

    // Table stats endpoint
    if (path.includes('/admin/system/table-stats') && method === 'GET') {
      const tables = await getTableStats();
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, tables }),
      };
    }

    // Unknown endpoint
    return {
      statusCode: 404,
      headers,
      body: JSON.stringify({
        success: false,
        error: 'Endpoint not found',
      }),
    };
  } catch (error) {
    console.error('Error processing admin request:', error);
    
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

