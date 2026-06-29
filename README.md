# Catfish Backend (catfishbk)

Serverless backend for the **Catfish** mobile app — image deepfake/manipulation detection, user auth, subscriptions, and admin APIs.

Built with **AWS Lambda**, **API Gateway**, **Cognito**, **DynamoDB**, and **S3**, deployed via the [Serverless Framework](https://www.serverless.com/).

## What it does

- **Image analysis** — Upload and analyze images for manipulation (Sightengine, Gowinston)
- **Authentication** — Sign up, sign in, guest users, password reset (AWS Cognito)
- **Subscriptions & tokens** — Scan limits, purchases, RevenueCat webhooks
- **Scan history** — Store and retrieve user scan results
- **Admin API** — User management, analytics, token controls
- **Meta CAPI** — Server-side conversion events for Meta ads
- **Health checks** — `/health` and `/health/live` endpoints

## Tech stack

- Node.js 18
- Serverless Framework (`serverless.yml`)
- AWS: Lambda, API Gateway, Cognito, DynamoDB, S3, Secrets Manager, SSM

## Prerequisites

- AWS account with appropriate IAM permissions
- AWS CLI configured (`aws configure`)
- Node.js 18+
- Serverless CLI: `npm install -g serverless`

## Setup & deploy

```bash
npm install
./setup-secrets.sh
./deploy.sh
```

Or deploy directly:

```bash
serverless deploy
```

Use an AWS profile if needed:

```bash
AWS_PROFILE=your-profile serverless deploy
```

After deployment, Serverless prints your API Gateway base URL (e.g. `https://xxxxx.execute-api.us-east-1.amazonaws.com/dev`).

## API overview

| Area         | Example paths                               |
|--------------|---------------------------------------------|
| Analyze      | `POST /analyze`                             |
| Auth         | `POST /auth/signin`, `POST /auth/signup`, … |
| Gowinston    | `POST /gowinston/detect`                    |
| Subscription | `GET /subscription/status`, …               |
| Scan history | `GET /scan-history`                         |
| Webhook      | `POST /webhook`                             |
| Admin        | `GET /admin/users`, …                       |
| Health       | `GET /health`                               |

Full route definitions are in `serverless.yml` under `functions`.

## Configuration

Secrets and config are loaded in this priority order:

1. AWS Secrets Manager
2. AWS SSM Parameter Store
3. Environment variables

For local development, copy `.env.example` to `.env` and fill in your values. The `.env` file is gitignored.

Key secrets include Sightengine/Gowinston API credentials, RevenueCat keys, and Meta access tokens. Use `./setup-secrets.sh` to store them in AWS.

## Local testing

```bash
node test-local.js
node test-gowinston-local.js
```

## Project structure

```
├── serverless.yml          # Infrastructure & API routes
├── *-handler.js            # Lambda handlers (auth, analyze, webhook, …)
├── device-scan-helpers.js  # Device scan limits
├── meta-capi-service.js    # Meta Conversions API
├── deploy.sh               # Deploy script
└── setup-secrets.sh        # Secrets Manager setup
```

## Security

- Store API keys in **AWS Secrets Manager** — never commit secrets to git
- Use IAM roles with least-privilege permissions
- Restrict CORS and S3 public access in production

## License

ISC
