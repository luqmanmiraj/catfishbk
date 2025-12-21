#!/bin/bash

# Setup script for Serverless Framework deployment bucket and SSM parameter
# This resolves the SSM parameter permission issue for Serverless Framework v4

set -e

AWS_PROFILE=${AWS_PROFILE:-catfish}
AWS_REGION=${AWS_REGION:-us-east-1}
SERVICE_NAME="image-analysis"
STAGE="dev"

DEPLOYMENT_BUCKET_NAME="${SERVICE_NAME}-${STAGE}-deployment-${AWS_REGION}"
SSM_PARAMETER_NAME="/serverless-framework/deployment/s3-bucket"

echo "🔧 Setting up Serverless Framework deployment bucket"
echo "===================================================="
echo ""
echo "AWS Profile: $AWS_PROFILE"
echo "Region: $AWS_REGION"
echo "Deployment Bucket: $DEPLOYMENT_BUCKET_NAME"
echo "SSM Parameter: $SSM_PARAMETER_NAME"
echo ""

# Check if bucket already exists
if aws s3api head-bucket --bucket "$DEPLOYMENT_BUCKET_NAME" --profile "$AWS_PROFILE" --region "$AWS_REGION" 2>/dev/null; then
    echo "✅ Deployment bucket already exists: $DEPLOYMENT_BUCKET_NAME"
else
    echo "📦 Creating deployment bucket: $DEPLOYMENT_BUCKET_NAME"
    aws s3api create-bucket \
        --bucket "$DEPLOYMENT_BUCKET_NAME" \
        --region "$AWS_REGION" \
        --profile "$AWS_PROFILE" \
        --create-bucket-configuration LocationConstraint="$AWS_REGION" 2>/dev/null || \
    aws s3api create-bucket \
        --bucket "$DEPLOYMENT_BUCKET_NAME" \
        --region "$AWS_REGION" \
        --profile "$AWS_PROFILE" 2>/dev/null || true
    
    # Wait a moment for bucket to be fully created
    sleep 2
    echo "✅ Deployment bucket created"
fi

# Create or update SSM parameter
echo ""
echo "📝 Creating/updating SSM parameter..."
if aws ssm get-parameter --name "$SSM_PARAMETER_NAME" --profile "$AWS_PROFILE" --region "$AWS_REGION" &>/dev/null 2>&1; then
    echo "Parameter already exists. Updating..."
    aws ssm put-parameter \
        --name "$SSM_PARAMETER_NAME" \
        --value "$DEPLOYMENT_BUCKET_NAME" \
        --type "String" \
        --overwrite \
        --profile "$AWS_PROFILE" \
        --region "$AWS_REGION"
    echo "✅ SSM parameter updated"
else
    echo "Creating new SSM parameter..."
    aws ssm put-parameter \
        --name "$SSM_PARAMETER_NAME" \
        --value "$DEPLOYMENT_BUCKET_NAME" \
        --type "String" \
        --description "Serverless Framework deployment bucket" \
        --profile "$AWS_PROFILE" \
        --region "$AWS_REGION"
    echo "✅ SSM parameter created"
fi

echo ""
echo "✅ Setup complete!"
echo ""
echo "You can now deploy with:"
echo "  AWS_PROFILE=$AWS_PROFILE serverless deploy --region $AWS_REGION"
echo ""

