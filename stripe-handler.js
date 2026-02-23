require('dotenv').config();

const Stripe = require('stripe');
const { wrapHandler } = require('./middleware/errorHandler');
const { TOKEN_PACKS, addTokens, savePurchase, purchaseExistsByTransactionId } = require('./lib/tokens');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '');

const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
const WEB_APP_URL = process.env.WEB_APP_URL || 'http://localhost:3000';

const STRIPE_PRICE_MAP = {
  pack_15: process.env.STRIPE_PRICE_PACK_15 || '',
  pack_50: process.env.STRIPE_PRICE_PACK_50 || '',
  pack_100: process.env.STRIPE_PRICE_PACK_100 || '',
};

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
};

function extractUserId(event) {
  const authHeader = event.headers && (event.headers.Authorization || event.headers.authorization);
  if (!authHeader) return null;

  try {
    const token = authHeader.replace('Bearer ', '');
    const parts = token.split('.');
    if (parts.length === 3) {
      const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
      return payload.sub || payload['cognito:username'] || null;
    }
  } catch (err) {
    console.warn('Error extracting user ID from token:', err.message);
  }
  return null;
}

async function handleCreateCheckoutSession(event) {
  const userId = extractUserId(event);
  if (!userId) {
    return {
      statusCode: 401,
      headers: CORS_HEADERS,
      body: JSON.stringify({ success: false, error: 'Unauthorized' }),
    };
  }

  const body = typeof event.body === 'string' ? JSON.parse(event.body || '{}') : (event.body || {});
  const { packId } = body;

  if (!packId || !TOKEN_PACKS[packId]) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ success: false, error: 'Invalid pack ID' }),
    };
  }

  const stripePriceId = STRIPE_PRICE_MAP[packId];
  if (!stripePriceId) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ success: false, error: `No Stripe price configured for ${packId}` }),
    };
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{ price: stripePriceId, quantity: 1 }],
      success_url: `${WEB_APP_URL}/purchase/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${WEB_APP_URL}`,
      client_reference_id: userId,
      metadata: { userId, packId },
    });

    console.log(`Checkout session created: ${session.id} for user ${userId}, pack ${packId}`);

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ success: true, url: session.url }),
    };
  } catch (error) {
    console.error('Error creating checkout session:', error);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ success: false, error: error.message }),
    };
  }
}

async function handleStripeWebhook(event) {
  const sig = event.headers['Stripe-Signature'] || event.headers['stripe-signature'] || '';
  const rawBody = typeof event.body === 'string' ? event.body : JSON.stringify(event.body);

  let stripeEvent;
  try {
    stripeEvent = stripe.webhooks.constructEvent(rawBody, sig, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Invalid signature' }),
    };
  }

  console.log(`Stripe webhook received: ${stripeEvent.type}`);

  if (stripeEvent.type === 'checkout.session.completed') {
    const session = stripeEvent.data.object;
    const userId = session.metadata?.userId || session.client_reference_id;
    const packId = session.metadata?.packId;
    const transactionId = session.id;

    if (!userId || !packId) {
      console.error('Missing userId or packId in session metadata', { userId, packId });
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ received: true, warning: 'Missing metadata' }),
      };
    }

    if (!TOKEN_PACKS[packId]) {
      console.error(`Unknown packId: ${packId}`);
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ received: true, warning: 'Unknown pack' }),
      };
    }

    const alreadyFulfilled = await purchaseExistsByTransactionId(transactionId);
    if (alreadyFulfilled) {
      console.log(`Transaction ${transactionId} already fulfilled, skipping`);
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ received: true, message: 'Already fulfilled' }),
      };
    }

    const pack = TOKEN_PACKS[packId];
    const newBalance = await addTokens(userId, pack.tokens);
    await savePurchase(userId, packId, pack.tokens, pack.price, transactionId, 'web');

    console.log(`Fulfilled ${pack.tokens} tokens for user ${userId} (pack ${packId}), new balance: ${newBalance}`);
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ received: true }),
  };
}

const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS_HEADERS, body: '' };
  }

  const path = event.path || '';

  if (path.includes('/stripe/create-checkout-session')) {
    return handleCreateCheckoutSession(event);
  }

  if (path.includes('/stripe/webhook')) {
    return handleStripeWebhook(event);
  }

  return {
    statusCode: 404,
    headers: CORS_HEADERS,
    body: JSON.stringify({ success: false, error: 'Not found' }),
  };
};

exports.handler = wrapHandler(handler);
