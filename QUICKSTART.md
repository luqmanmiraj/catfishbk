# Quick Start Guide

Get your Lambda function up and running in 5 minutes!

## Prerequisites

- AWS Account
- AWS CLI installed and configured
- Node.js 18.x+
- Serverless Framework: `npm install -g serverless`

## Step 1: Configure AWS Profile

```bash
aws configure --profile catfish
# Enter your AWS Access Key ID
# Enter your AWS Secret Access Key
# Enter default region (e.g., us-east-1)
# Enter default output format (json)
```

## Step 2: Set Up Secrets (Recommended)

```bash
cd lambda
AWS_PROFILE=catfish ./setup-secrets.sh
```

This will:
- Store your Hive API key in AWS Secrets Manager
- Optionally store configuration in SSM Parameter Store

## Step 3: Install Dependencies

```bash
npm install
```

## Step 4: Deploy

```bash
AWS_PROFILE=catfish serverless deploy
```

Or use the deploy script:

```bash
AWS_PROFILE=catfish ./deploy.sh
```

## Step 5: Get Your Endpoint

After deployment, you'll see output like:

```
endpoints:
  POST - https://xxxxx.execute-api.us-east-1.amazonaws.com/dev/analyze
```

Copy this URL and update your mobile app!

## Alternative: Using Environment Variables

If you prefer not to use AWS Secrets Manager:

```bash
export HIVE_API_KEY="your-api-key"
export S3_BUCKET_NAME="your-bucket-name"
AWS_PROFILE=catfish serverless deploy
```

## Next Steps

- See `README.md` for detailed documentation
- See `AWS_CONFIGURATION.md` for advanced AWS configuration
- See `MOBILE_INTEGRATION.md` for mobile app integration

## Troubleshooting

**Profile not found?**
```bash
aws configure list-profiles
```

**Access denied?**
- Check your AWS profile has necessary permissions
- Verify secrets/parameters exist in the correct region

**Need help?**
- Check `README.md` troubleshooting section
- Review `AWS_CONFIGURATION.md` for configuration details

