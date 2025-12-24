#!/bin/bash

# Fix Serverless Framework deployment bucket permissions
# This script addresses the "explicit deny" error

set -e

AWS_PROFILE=${AWS_PROFILE:-catfish}
AWS_REGION=${AWS_REGION:-us-east-1}
SERVICE_NAME="image-analysis"
STAGE="dev"

DEPLOYMENT_BUCKET_NAME="${SERVICE_NAME}-${STAGE}-deployment-${AWS_REGION}"

echo "🔧 Fixing Serverless Framework deployment bucket permissions"
echo "============================================================"
echo ""
echo "AWS Profile: $AWS_PROFILE"
echo "Region: $AWS_REGION"
echo "Deployment Bucket: $DEPLOYMENT_BUCKET_NAME"
echo ""

# Step 1: Check if bucket exists
echo "Step 1: Checking if bucket exists..."
if aws s3api head-bucket --bucket "$DEPLOYMENT_BUCKET_NAME" --profile "$AWS_PROFILE" --region "$AWS_REGION" 2>/dev/null; then
    echo "✅ Bucket exists: $DEPLOYMENT_BUCKET_NAME"
else
    echo "📦 Bucket does not exist. Creating it..."
    
    # Try to create bucket (us-east-1 is special, doesn't need LocationConstraint)
    if [ "$AWS_REGION" = "us-east-1" ]; then
        aws s3api create-bucket \
            --bucket "$DEPLOYMENT_BUCKET_NAME" \
            --region "$AWS_REGION" \
            --profile "$AWS_PROFILE" 2>/dev/null || true
    else
        aws s3api create-bucket \
            --bucket "$DEPLOYMENT_BUCKET_NAME" \
            --region "$AWS_REGION" \
            --profile "$AWS_PROFILE" \
            --create-bucket-configuration LocationConstraint="$AWS_REGION" 2>/dev/null || true
    fi
    
    # Wait for bucket to be ready
    sleep 3
    echo "✅ Bucket created"
fi

# Step 2: Check current bucket policy
echo ""
echo "Step 2: Checking bucket policy..."
BUCKET_POLICY=$(aws s3api get-bucket-policy --bucket "$DEPLOYMENT_BUCKET_NAME" --profile "$AWS_PROFILE" 2>/dev/null || echo "{}")

# Step 3: Get current user ARN
echo ""
echo "Step 3: Getting current user ARN..."
CURRENT_USER_ARN=$(aws sts get-caller-identity --profile "$AWS_PROFILE" --query 'Arn' --output text)
echo "Current user: $CURRENT_USER_ARN"

# Step 4: Check for explicit deny policies on the user
echo ""
echo "Step 4: Checking for deny policies on user..."
USER_NAME=$(echo "$CURRENT_USER_ARN" | awk -F'/' '{print $NF}')
echo "User name: $USER_NAME"

# List all policies attached to the user
echo "Checking attached policies..."
aws iam list-attached-user-policies --user-name "$USER_NAME" --profile "$AWS_PROFILE" --output json || true
aws iam list-user-policies --user-name "$USER_NAME" --profile "$AWS_PROFILE" --output json || true

# Step 5: Try to list the bucket (this will show us the exact error)
echo ""
echo "Step 5: Testing bucket access..."
if aws s3 ls "s3://$DEPLOYMENT_BUCKET_NAME" --profile "$AWS_PROFILE" 2>&1; then
    echo "✅ Bucket access successful!"
else
    echo "❌ Bucket access failed. Error details above."
    echo ""
    echo "Possible solutions:"
    echo "1. Check if there's a Deny policy attached to your IAM user"
    echo "2. Ensure your IAM user has s3:ListBucket permission"
    echo "3. Check bucket policy for any explicit denies"
    echo ""
    echo "To check for deny policies, run:"
    echo "  aws iam list-user-policies --user-name $USER_NAME --profile $AWS_PROFILE"
    echo "  aws iam list-attached-user-policies --user-name $USER_NAME --profile $AWS_PROFILE"
fi

echo ""
echo "✅ Diagnostic complete!"
echo ""
echo "If the issue persists, you may need to:"
echo "1. Remove any Deny policies from your IAM user"
echo "2. Ensure your IAM policy includes s3:ListBucket for the deployment bucket"
echo "3. Check if there's a bucket policy blocking access"

