const AWS = require('aws-sdk');
const { v4: uuidv4 } = require('uuid');

const dynamodb = new AWS.DynamoDB.DocumentClient();

const TOKENS_TABLE = process.env.TOKENS_TABLE || 'image-analysis-dev-tokens';
const PURCHASES_TABLE = process.env.PURCHASES_TABLE || 'image-analysis-dev-purchases';

const TOKEN_PACKS = {
  'pack_5': { tokens: 5, price: 4.99 },
  'pack_15': { tokens: 15, price: 4.99 },
  'pack_20': { tokens: 20, price: 14.99 },
  'pack_50': { tokens: 50, price: 8.49 },
  'pack_100': { tokens: 100, price: 14.44 },
};

/**
 * Map a RevenueCat product identifier to a TOKEN_PACKS key.
 * Product IDs may contain the pack key (e.g. "catfish_pack_50").
 */
function mapProductToPackId(productId) {
  if (!productId) return null;
  const lower = productId.toLowerCase();
  for (const key of Object.keys(TOKEN_PACKS)) {
    if (lower.includes(key)) return key;
  }
  return null;
}

async function addTokens(userId, amount) {
  const result = await dynamodb.update({
    TableName: TOKENS_TABLE,
    Key: { userId },
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

  return result.Attributes.balance;
}

async function savePurchase(userId, packId, tokens, price, transactionId, source) {
  const purchaseId = `purchase-${Date.now()}-${uuidv4()}`;
  const purchaseDate = new Date().toISOString();

  const purchaseItem = {
    purchaseId,
    userId,
    packId,
    tokens,
    price,
    transactionId: transactionId || null,
    source: source || 'unknown',
    purchaseDate,
    status: 'completed',
    createdAt: purchaseDate,
  };

  try {
    await dynamodb.put({
      TableName: PURCHASES_TABLE,
      Item: purchaseItem,
    }).promise();

    console.log(`Purchase saved: ${purchaseId} for user ${userId}`);
    return purchaseItem;
  } catch (error) {
    console.error('Error saving purchase:', error);
    return null;
  }
}

/**
 * Check if a purchase with the given transactionId already exists.
 * Used for idempotency to prevent double-crediting.
 */
async function purchaseExistsByTransactionId(transactionId) {
  if (!transactionId) return false;

  try {
    const result = await dynamodb.scan({
      TableName: PURCHASES_TABLE,
      FilterExpression: '#tid = :tid',
      ExpressionAttributeNames: { '#tid': 'transactionId' },
      ExpressionAttributeValues: { ':tid': transactionId },
      Limit: 1,
    }).promise();

    return result.Items && result.Items.length > 0;
  } catch (error) {
    console.error('Error checking existing purchase:', error);
    return false;
  }
}

async function getTokenBalance(userId) {
  try {
    const result = await dynamodb.get({
      TableName: TOKENS_TABLE,
      Key: { userId },
    }).promise();

    return result.Item ? (result.Item.balance || 0) : 0;
  } catch (error) {
    console.error('Error getting token balance:', error);
    return 0;
  }
}

module.exports = {
  TOKEN_PACKS,
  mapProductToPackId,
  addTokens,
  savePurchase,
  purchaseExistsByTransactionId,
  getTokenBalance,
  TOKENS_TABLE,
  PURCHASES_TABLE,
};
