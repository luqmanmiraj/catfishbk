#!/bin/bash

# Script to set up AWS Secrets Manager and SSM Parameter Store for the Lambda function
# This allows you to store sensitive data securely in AWS instead of environment variables

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}🔐 AWS Secrets and Configuration Setup${NC}"
echo "=========================================="
echo ""

# Load environment variables from .env file if it exists
if [ -f .env ]; then
    echo -e "${YELLOW}Loading environment variables from .env file...${NC}"
    export $(cat .env | grep -v '^#' | xargs)
    echo -e "${GREEN}✅ Environment variables loaded${NC}"
    echo ""
fi

# Check if AWS CLI is configured
if ! command -v aws &> /dev/null; then
    echo -e "${RED}❌ AWS CLI is not installed.${NC}"
    echo "   Install it from: https://aws.amazon.com/cli/"
    exit 1
fi

# Get AWS profile from .env or use default
AWS_PROFILE=${AWS_PROFILE:-default}
echo -e "${YELLOW}Using AWS Profile: ${AWS_PROFILE}${NC}"
echo ""

# Get region from .env or prompt
if [ -z "$AWS_REGION" ]; then
    read -p "Enter AWS region (default: us-east-1): " AWS_REGION
    AWS_REGION=${AWS_REGION:-us-east-1}
fi
export AWS_REGION

# Set AWS profile for commands
export AWS_PROFILE

echo ""
echo "This script will set up:"
echo "  1. AWS Secrets Manager secret for Hive API key"
echo "  2. SSM Parameter Store for Hive endpoint (optional)"
echo "  3. SSM Parameter Store for S3 bucket name (optional)"
echo ""

# 1. Set up Hive API Key in Secrets Manager
echo -e "${GREEN}Step 1: Setting up Hive API Key in Secrets Manager${NC}"
if [ -z "$HIVE_API_KEY" ]; then
    read -p "Enter your Hive API key: " -s HIVE_API_KEY
    echo ""
    
    if [ -z "$HIVE_API_KEY" ]; then
        echo -e "${RED}❌ Hive API key cannot be empty${NC}"
        exit 1
    fi
else
    echo -e "${GREEN}Using HIVE_API_KEY from .env file${NC}"
fi

SECRET_NAME="catfish/hive-api-key"
echo "Creating secret: $SECRET_NAME"

# Check if secret already exists
if aws secretsmanager describe-secret --secret-id "$SECRET_NAME" --region "$AWS_REGION" &>/dev/null; then
    echo "Secret already exists. Updating..."
    aws secretsmanager update-secret \
        --secret-id "$SECRET_NAME" \
        --secret-string "{\"apiKey\":\"$HIVE_API_KEY\"}" \
        --region "$AWS_REGION"
    echo -e "${GREEN}✅ Secret updated${NC}"
else
    aws secretsmanager create-secret \
        --name "$SECRET_NAME" \
        --description "Hive API key for Catfish image analysis" \
        --secret-string "{\"apiKey\":\"$HIVE_API_KEY\"}" \
        --region "$AWS_REGION"
    echo -e "${GREEN}✅ Secret created${NC}"
fi

# 2. Set up Hive Endpoint in SSM (optional)
echo ""
echo -e "${GREEN}Step 2: Setting up Hive Endpoint in SSM Parameter Store (optional)${NC}"
if [ -z "$HIVE_ENDPOINT" ]; then
    read -p "Enter Hive API endpoint (press Enter to skip, default: https://api.thehive.ai/api/v3/chat/completions): " HIVE_ENDPOINT
else
    echo -e "${GREEN}Using HIVE_ENDPOINT from .env file: ${HIVE_ENDPOINT}${NC}"
fi

if [ -n "$HIVE_ENDPOINT" ]; then
    PARAM_NAME="/catfish/hive-endpoint"
    echo "Creating parameter: $PARAM_NAME"
    
    if aws ssm get-parameter --name "$PARAM_NAME" --region "$AWS_REGION" &>/dev/null 2>&1; then
        echo "Parameter already exists. Updating..."
        aws ssm put-parameter \
            --name "$PARAM_NAME" \
            --value "$HIVE_ENDPOINT" \
            --type "String" \
            --overwrite \
            --region "$AWS_REGION"
        echo -e "${GREEN}✅ Parameter updated${NC}"
    else
        aws ssm put-parameter \
            --name "$PARAM_NAME" \
            --value "$HIVE_ENDPOINT" \
            --type "String" \
            --description "Hive API endpoint for Catfish" \
            --region "$AWS_REGION"
        echo -e "${GREEN}✅ Parameter created${NC}"
    fi
else
    echo "Skipping Hive endpoint setup (will use default)"
fi

# 3. Set up S3 Bucket Name in SSM (optional)
echo ""
echo -e "${GREEN}Step 3: Setting up S3 Bucket Name in SSM Parameter Store (optional)${NC}"
if [ -z "$S3_BUCKET_NAME" ]; then
    read -p "Enter S3 bucket name (press Enter to skip): " S3_BUCKET_NAME
else
    echo -e "${GREEN}Using S3_BUCKET_NAME from .env file: ${S3_BUCKET_NAME}${NC}"
fi

if [ -n "$S3_BUCKET_NAME" ]; then
    PARAM_NAME="/catfish/s3-bucket-name"
    echo "Creating parameter: $PARAM_NAME"
    
    if aws ssm get-parameter --name "$PARAM_NAME" --region "$AWS_REGION" &>/dev/null 2>&1; then
        echo "Parameter already exists. Updating..."
        aws ssm put-parameter \
            --name "$PARAM_NAME" \
            --value "$S3_BUCKET_NAME" \
            --type "String" \
            --overwrite \
            --region "$AWS_REGION"
        echo -e "${GREEN}✅ Parameter updated${NC}"
    else
        aws ssm put-parameter \
            --name "$PARAM_NAME" \
            --value "$S3_BUCKET_NAME" \
            --type "String" \
            --description "S3 bucket name for Catfish image storage" \
            --region "$AWS_REGION"
        echo -e "${GREEN}✅ Parameter created${NC}"
    fi
else
    echo "Skipping S3 bucket name setup (will use environment variable)"
fi

echo ""
echo -e "${GREEN}✅ Setup complete!${NC}"
echo ""
echo "Next steps:"
echo "  1. Deploy the Lambda function:"
echo "     AWS_PROFILE=$AWS_PROFILE serverless deploy --region $AWS_REGION"
echo ""
echo "  2. Or use the deploy script:"
echo "     AWS_PROFILE=$AWS_PROFILE ./deploy.sh"
echo ""

