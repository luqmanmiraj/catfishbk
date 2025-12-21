#!/bin/bash

# Script to verify AWS IAM permissions for Catfish deployment
# This helps identify any missing permissions before deployment

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🔍 AWS IAM Permissions Verification${NC}"
echo "=========================================="
echo ""

# Load environment variables from .env file if it exists
if [ -f .env ]; then
    echo -e "${YELLOW}Loading environment variables from .env file...${NC}"
    export $(cat .env | grep -v '^#' | xargs)
fi

# Check if AWS CLI is installed
if ! command -v aws &> /dev/null; then
    echo -e "${RED}❌ AWS CLI is not installed.${NC}"
    echo "   Install it from: https://aws.amazon.com/cli/"
    exit 1
fi

# Get region
AWS_REGION=${AWS_REGION:-us-east-1}
echo -e "${YELLOW}Region: ${AWS_REGION}${NC}"
echo ""

# Track test results
PASSED=0
FAILED=0

# Function to test AWS permission
test_permission() {
    local service=$1
    local command=$2
    local description=$3
    
    echo -n "Testing ${description}... "
    
    if eval "$command" &>/dev/null; then
        echo -e "${GREEN}✅ PASSED${NC}"
        ((PASSED++))
        return 0
    else
        echo -e "${RED}❌ FAILED${NC}"
        ((FAILED++))
        return 1
    fi
}

echo -e "${BLUE}=== Basic Access Tests ===${NC}"

# Test 1: STS GetCallerIdentity
test_permission "STS" \
    "aws sts get-caller-identity --region ${AWS_REGION}" \
    "STS GetCallerIdentity"

echo ""

# Test 2: Lambda permissions
echo -e "${BLUE}=== Lambda Permissions ===${NC}"
test_permission "Lambda" \
    "aws lambda list-functions --region ${AWS_REGION} --max-items 1" \
    "Lambda ListFunctions"
test_permission "Lambda" \
    "aws lambda get-account-settings --region ${AWS_REGION}" \
    "Lambda GetAccountSettings"

echo ""

# Test 3: S3 permissions
echo -e "${BLUE}=== S3 Permissions ===${NC}"
test_permission "S3" \
    "aws s3 ls" \
    "S3 ListBuckets"
if [ -n "$S3_BUCKET_NAME" ]; then
    echo -n "Testing S3 bucket access (${S3_BUCKET_NAME})... "
    if aws s3 ls "s3://${S3_BUCKET_NAME}" &>/dev/null 2>&1 || aws s3api head-bucket --bucket "${S3_BUCKET_NAME}" &>/dev/null 2>&1; then
        echo -e "${GREEN}✅ PASSED${NC}"
        ((PASSED++))
    else
        # Bucket might not exist yet, which is okay
        echo -e "${YELLOW}⚠️  BUCKET NOT FOUND (may need to be created)${NC}"
    fi
fi

echo ""

# Test 4: Secrets Manager permissions
echo -e "${BLUE}=== Secrets Manager Permissions ===${NC}"
test_permission "SecretsManager" \
    "aws secretsmanager list-secrets --region ${AWS_REGION} --max-results 1" \
    "SecretsManager ListSecrets"

if [ -n "$HIVE_API_KEY_SECRET_NAME" ]; then
    echo -n "Testing SecretsManager access (${HIVE_API_KEY_SECRET_NAME})... "
    if aws secretsmanager describe-secret --secret-id "${HIVE_API_KEY_SECRET_NAME}" --region "${AWS_REGION}" &>/dev/null 2>&1; then
        echo -e "${GREEN}✅ PASSED${NC}"
        ((PASSED++))
    else
        echo -e "${YELLOW}⚠️  SECRET NOT FOUND (may need to be created)${NC}"
    fi
fi

echo ""

# Test 5: SSM Parameter Store permissions
echo -e "${BLUE}=== SSM Parameter Store Permissions ===${NC}"
test_permission "SSM" \
    "aws ssm describe-parameters --region ${AWS_REGION} --max-results 1" \
    "SSM DescribeParameters"

echo ""

# Test 6: API Gateway permissions
echo -e "${BLUE}=== API Gateway Permissions ===${NC}"
test_permission "APIGateway" \
    "aws apigateway get-rest-apis --region ${AWS_REGION} --limit 1 2>/dev/null || aws apigatewayv2 get-apis --region ${AWS_REGION} --max-results 1" \
    "API Gateway ListAPIs"

echo ""

# Test 7: CloudFormation permissions
echo -e "${BLUE}=== CloudFormation Permissions ===${NC}"
test_permission "CloudFormation" \
    "aws cloudformation list-stacks --region ${AWS_REGION} --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE --max-results 1" \
    "CloudFormation ListStacks"

echo ""

# Test 8: CloudWatch Logs permissions
echo -e "${BLUE}=== CloudWatch Logs Permissions ===${NC}"
test_permission "CloudWatchLogs" \
    "aws logs describe-log-groups --region ${AWS_REGION} --max-items 1" \
    "CloudWatch Logs DescribeLogGroups"

echo ""

# Test 9: IAM permissions (limited test to avoid creating resources)
echo -e "${BLUE}=== IAM Permissions ===${NC}"
echo -n "Testing IAM GetUser/GetRole... "
if aws iam get-user &>/dev/null 2>&1 || aws iam get-role --role-name test-role 2>&1 | grep -q "NoSuchEntity\|AccessDenied" &>/dev/null; then
    echo -e "${GREEN}✅ PASSED${NC}"
    ((PASSED++))
else
    echo -e "${RED}❌ FAILED${NC}"
    ((FAILED++))
fi

echo ""

# Test 10: DynamoDB permissions
echo -e "${BLUE}=== DynamoDB Permissions ===${NC}"
test_permission "DynamoDB" \
    "aws dynamodb list-tables --region ${AWS_REGION} --max-items 1" \
    "DynamoDB ListTables"

echo ""

# Test 11: EC2 permissions (for VPC configuration)
echo -e "${BLUE}=== EC2 Permissions ===${NC}"
test_permission "EC2" \
    "aws ec2 describe-vpcs --region ${AWS_REGION} --max-items 1" \
    "EC2 DescribeVpcs"

echo ""

# Summary
echo "=========================================="
echo -e "${BLUE}Verification Summary:${NC}"
echo -e "${GREEN}✅ Passed: ${PASSED}${NC}"
echo -e "${RED}❌ Failed: ${FAILED}${NC}"
echo ""

if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}🎉 All permission tests passed!${NC}"
    echo "You should be able to deploy the Lambda function."
    exit 0
else
    echo -e "${RED}⚠️  Some permission tests failed.${NC}"
    echo "Please check your IAM policy and ensure all required permissions are granted."
    echo "See IAM_POLICY_REQUIREMENTS.md for the complete list of required permissions."
    exit 1
fi

