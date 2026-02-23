# RevenueCat Web Billing Setup Guide

This document explains how to set up RevenueCat Web Billing for the Catfish Crasher web app. It covers what the client needs to provide (Stripe), what we configure (RevenueCat + code), and the full step-by-step process.

---

## What We Need From the Client

The client (Stripe account owner) needs to provide **one thing**:

### Stripe Account Authorization

RevenueCat Web Billing uses Stripe as the payment gateway. The client must authorize their Stripe account to connect with RevenueCat. There are two ways to do this:

**Option A: Client connects Stripe themselves (preferred)**

If the client has access to the RevenueCat Dashboard:

1. Log into RevenueCat Dashboard at https://app.revenuecat.com
2. Go to the Catfish project
3. Navigate to **Project Settings** (gear icon) > **Billing**
4. Click **Connect Stripe Account**
5. Authorize the Stripe account through the OAuth flow
6. Done -- no credentials need to be shared

**Option B: Client provides Stripe API keys (fallback)**

If the client cannot access RevenueCat directly, ask them for:

| Credential | Where to Find It | What It Looks Like |
|---|---|---|
| **Stripe Publishable Key** | Stripe Dashboard > Developers > API Keys | `pk_live_...` or `pk_test_...` |
| **Stripe Secret Key** | Stripe Dashboard > Developers > API Keys | `sk_live_...` or `sk_test_...` |
| **Stripe Restricted Key** (optional, more secure) | Stripe Dashboard > Developers > API Keys > Create restricted key | `rk_live_...` |

> **Important**: Ask for both **test mode** and **live mode** keys if available. Test keys let us verify the integration before going live.

---

## What We Configure (RevenueCat Dashboard)

We have RevenueCat team access and handle all of the following.

### Step 1: Connect Stripe in RevenueCat

1. Go to **RevenueCat Dashboard** > Catfish project
2. Navigate to **Project Settings** > **Billing**
3. Click **Connect Stripe Account**
4. Complete the Stripe OAuth flow (or enter the API keys the client provided)
5. Verify connection shows as **Connected**

### Step 2: Create a Web Billing App

1. Go to **Apps & providers** in the left sidebar
2. Click **+ New** to add a new app
3. Select **Web Billing** as the platform
4. Configure the following:

| Field | Value |
|---|---|
| App Name | `Catfish Crasher Web` |
| Support Email | (your support email) |
| Default Currency | `USD` |
| Stripe Account | (the one connected in Step 1) |

5. Click **Save**

After saving, two API keys are generated:

| Key | Purpose | Starts With |
|---|---|---|
| **Sandbox API Key** | Testing with Stripe test cards | `rcb_...` |
| **Public API Key** | Production use in the web app | `rcb_...` |

**Copy both keys** -- you'll need them for the environment configuration.

### Step 3: Create Web Products

For each token pack, create a product in RevenueCat:

1. Go to **Products** in the left sidebar
2. Click **+ New Product** for each pack:

| Product Identifier | Display Name | Type | Price (USD) |
|---|---|---|---|
| `pack_15` | 15 Scans | Non-renewing / One-time | $4.99 |
| `pack_50` | 50 Scans | Non-renewing / One-time | $8.49 |
| `pack_100` | 100 Scans | Non-renewing / One-time | $14.44 |

> **Critical**: The product identifier must contain `pack_15`, `pack_50`, or `pack_100`. The backend code maps purchases to token packs using substring matching.

3. For each product, under **Store configuration**, add the **Web Billing** store with the correct price

### Step 4: Attach Products to Offerings

1. Go to **Offerings** in the left sidebar
2. Open the **Default** offering (this is the same one the mobile app uses)
3. For each package, attach the new **Web Billing product** alongside the existing iOS/Android products
4. If packages for these token packs don't exist yet, create them and add the products

### Step 5: Verify Webhook

1. Go to **Project Settings** > **Integrations** > **Webhooks**
2. Confirm the webhook URL is set to the Lambda endpoint:
   ```
   https://3oaimkf4g6.execute-api.us-east-1.amazonaws.com/dev/webhook
   ```
3. The same webhook handles both mobile and web purchase events automatically
4. Make sure **NON_RENEWING_PURCHASE** event type is enabled (it should be by default)

---

## Code Configuration

### Environment Variable

Create or edit `web/.env.local`:

```bash
# For testing (use Sandbox key):
NEXT_PUBLIC_REVENUECAT_WEB_API_KEY=rcb_sandbox_xxxxxxxxxxxx

# For production (use Public key):
NEXT_PUBLIC_REVENUECAT_WEB_API_KEY=rcb_xxxxxxxxxxxx
```

This key is safe to include in client-side code -- it's a public key, not a secret.

### Deploy Backend Changes

The webhook handler and subscription handler have been updated to support web purchases. Deploy them:

```bash
cd lambda
serverless deploy
```

This deploys:
- **webhook-handler**: Now fulfills token pack purchases from `NON_RENEWING_PURCHASE` events
- **subscription-handler**: Now includes idempotency checks to prevent double-crediting

---

## Testing

### Prerequisites
- Sandbox API key set in `web/.env.local`
- Products and offerings configured in RevenueCat
- Lambda backend deployed

### Test Flow

1. Start the web app locally:
   ```bash
   cd web
   npm run dev
   ```

2. Sign in to the web app

3. Click **Buy Scans** (navbar or profile page)

4. The RevenueCat paywall should render with your token packs

5. Use Stripe's test card to complete a purchase:
   - Card number: `4242 4242 4242 4242`
   - Expiry: any future date (e.g. `12/34`)
   - CVC: any 3 digits (e.g. `123`)

6. After purchase, verify:
   - Scan count updates in the navbar
   - Token balance updates on the profile page
   - Purchase appears in the RevenueCat Dashboard under the customer
   - Purchase record exists in DynamoDB `purchases` table

### Common Test Cards

| Card Number | Scenario |
|---|---|
| `4242 4242 4242 4242` | Successful payment |
| `4000 0000 0000 0002` | Card declined |
| `4000 0000 0000 9995` | Insufficient funds |
| `4000 0025 0000 3155` | Requires 3D Secure authentication |

---

## Going Live Checklist

- [ ] Stripe account connected in RevenueCat (live mode)
- [ ] Web products created with correct prices
- [ ] Products attached to the Default offering
- [ ] Webhook URL verified and receiving events
- [ ] `NEXT_PUBLIC_REVENUECAT_WEB_API_KEY` set to the **Public** (not Sandbox) key
- [ ] Lambda deployed with latest handler changes
- [ ] Test purchase completed successfully with a real card (small amount refundable)

---

## Architecture Reference

```
User clicks "Buy Scans"
    |
    v
PaywallModal opens
    |
    v
RevenueCat SDK renders paywall (presentPaywall)
    |
    v
User selects pack & completes Stripe checkout
    |
    v
RevenueCat confirms purchase
    |
    +---> Web app calls POST /subscription/purchase (packId, transactionId)
    |         |
    |         v
    |     Backend adds tokens (with idempotency check)
    |
    +---> RevenueCat sends webhook (NON_RENEWING_PURCHASE)
              |
              v
          Webhook handler adds tokens (with idempotency check)
              |
              v
          Double-credit prevented by transactionId lookup
```

Both paths (client API call + webhook) are idempotent -- tokens are only added once per unique transaction.
