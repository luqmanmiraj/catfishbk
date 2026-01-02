#!/bin/bash

# Deployment script for Image Analysis Lambda Function
# This script helps set up and deploy the Lambda function

set -e

echo "🚀 Image Analysis Lambda Deployment Script"
echo "=========================================="
echo ""

# Load environment variables from .env file if it exists
if [ -f .env ]; then
    echo "📄 Loading environment variables from .env file..."
    export $(cat .env | grep -v '^#' | xargs)
    echo "✅ Environment variables loaded"
    echo ""
fi

# Check if serverless is installed (globally or locally via npx)
if ! command -v serverless &> /dev/null && ! command -v npx &> /dev/null; then
    echo "❌ Serverless Framework is not installed and npx is not available."
    echo "   Install it locally with: npm install"
    echo "   Or install globally with: npm install -g serverless"
    exit 1
fi

# Use npx if serverless is not in PATH (local installation)
if ! command -v serverless &> /dev/null; then
    SERVERLESS_CMD="npx serverless"
    echo "✅ Using locally installed Serverless Framework (via npx)"
else
    SERVERLESS_CMD="serverless"
    echo "✅ Serverless Framework found"
fi

# Check if AWS CLI is configured
if ! command -v aws &> /dev/null; then
    echo "❌ AWS CLI is not installed."
    echo "   Install it from: https://aws.amazon.com/cli/"
    exit 1
fi

echo "✅ AWS CLI found"

# Check AWS profile (from .env or default)
AWS_PROFILE=${AWS_PROFILE:-default}
echo "Using AWS Profile: $AWS_PROFILE"

# Verify profile is configured
if ! aws configure list-profiles | grep -q "^${AWS_PROFILE}$"; then
    echo "⚠️  Warning: Profile '$AWS_PROFILE' not found in AWS config"
    echo "   Available profiles:"
    aws configure list-profiles
    echo ""
    read -p "Continue anyway? (y/n) " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# Check environment variables (prompt if not in .env)
if [ -z "$HIVE_API_KEY" ]; then
    echo "⚠️  HIVE_API_KEY is not set in .env file"
    read -p "Enter your Hive API key: " HIVE_API_KEY
    export HIVE_API_KEY
fi

if [ -z "$S3_BUCKET_NAME" ]; then
    echo "⚠️  S3_BUCKET_NAME is not set in .env file"
    read -p "Enter a unique S3 bucket name (e.g., catfish-images-$(date +%s)): " S3_BUCKET_NAME
    export S3_BUCKET_NAME
fi

# Set AWS_REGION if not already set
if [ -z "$AWS_REGION" ]; then
    AWS_REGION=${AWS_REGION:-us-east-1}
    export AWS_REGION
fi

echo ""
echo "Configuration:"
echo "  HIVE_API_KEY: ${HIVE_API_KEY:0:10}..."
echo "  S3_BUCKET_NAME: $S3_BUCKET_NAME"
echo ""

read -p "Continue with deployment? (y/n) " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Deployment cancelled."
    exit 1
fi

# Install dependencies
echo ""
echo "📦 Installing dependencies..."
npm install

# Deploy
echo ""
echo "🚀 Deploying Lambda function..."
$SERVERLESS_CMD deploy

echo ""
echo "✅ Deployment complete!"
echo ""
echo "📝 Next steps:"
echo "   1. Copy the endpoint URL from above"
echo "   2. Update your mobile app with the endpoint URL"
echo "   3. See MOBILE_INTEGRATION.md for integration instructions"
echo ""

