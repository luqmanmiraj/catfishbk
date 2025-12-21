# AWS Configuration Guide

This guide explains how to configure AWS profiles, secrets, and parameters for the Lambda function.

## AWS Profile Setup

### Creating an AWS Profile

1. **Using AWS CLI:**
```bash
aws configure --profile your-profile-name
```

You'll be prompted for:
- AWS Access Key ID
- AWS Secret Access Key  
- Default region (e.g., `us-east-1`)
- Default output format (e.g., `json`)

2. **Using credentials file directly:**
Edit `~/.aws/credentials`:
```ini
[your-profile-name]
aws_access_key_id = YOUR_ACCESS_KEY
aws_secret_access_key = YOUR_SECRET_KEY
```

Edit `~/.aws/config`:
```ini
[profile your-profile-name]
region = us-east-1
output = json
```

### Using AWS Profiles

**Option 1: Environment Variable**
```bash
export AWS_PROFILE=your-profile-name
serverless deploy
```

**Option 2: Command Flag**
```bash
serverless deploy --aws-profile your-profile-name
```

**Option 3: In serverless.yml** (not recommended for shared repos)
```yaml
provider:
  profile: your-profile-name
```

### Verifying Profile

```bash
# List all profiles
aws configure list-profiles

# Test profile credentials
aws sts get-caller-identity --profile your-profile-name

# Check current profile
aws configure list
```

## Secrets Manager Setup

### Store Hive API Key in Secrets Manager

**Using AWS CLI:**
```bash
aws secretsmanager create-secret \
  --name catfish/hive-api-key \
  --description "Hive API key for Catfish image analysis" \
  --secret-string '{"apiKey":"your-api-key-here"}' \
  --region us-east-1 \
  --profile your-profile-name
```

**Using the setup script:**
```bash
AWS_PROFILE=your-profile-name ./setup-secrets.sh
```

### Retrieve Secret

```bash
aws secretsmanager get-secret-value \
  --secret-id catfish/hive-api-key \
  --region us-east-1 \
  --profile your-profile-name
```

### Update Secret

```bash
aws secretsmanager update-secret \
  --secret-id catfish/hive-api-key \
  --secret-string '{"apiKey":"new-api-key"}' \
  --region us-east-1 \
  --profile your-profile-name
```

## SSM Parameter Store Setup

### Store Configuration Values

**Hive Endpoint:**
```bash
aws ssm put-parameter \
  --name /catfish/hive-endpoint \
  --value "https://api.thehive.ai/api/v3/chat/completions" \
  --type String \
  --description "Hive API endpoint" \
  --region us-east-1 \
  --profile your-profile-name
```

**S3 Bucket Name:**
```bash
aws ssm put-parameter \
  --name /catfish/s3-bucket-name \
  --value "your-bucket-name" \
  --type String \
  --description "S3 bucket for image storage" \
  --region us-east-1 \
  --profile your-profile-name
```

### Retrieve Parameters

```bash
# Get single parameter
aws ssm get-parameter \
  --name /catfish/s3-bucket-name \
  --region us-east-1 \
  --profile your-profile-name

# Get parameter value only
aws ssm get-parameter \
  --name /catfish/s3-bucket-name \
  --with-decryption \
  --query 'Parameter.Value' \
  --output text \
  --region us-east-1 \
  --profile your-profile-name
```

### Update Parameters

```bash
aws ssm put-parameter \
  --name /catfish/s3-bucket-name \
  --value "new-bucket-name" \
  --overwrite \
  --region us-east-1 \
  --profile your-profile-name
```

## Configuration Priority

The Lambda function uses this priority order:

1. **AWS Secrets Manager** (`catfish/hive-api-key`)
2. **AWS SSM Parameter Store** (`/catfish/hive-endpoint`, `/catfish/s3-bucket-name`)
3. **Environment Variables** (`HIVE_API_KEY`, `HIVE_ENDPOINT`, `S3_BUCKET_NAME`)
4. **Default Values** (for endpoint only)

## IAM Permissions Required

### For Deployment (Your AWS Profile)

Your AWS profile needs permissions to:
- Create/update Lambda functions
- Create/update API Gateway
- Create/update S3 buckets
- Create/update IAM roles
- Create/update CloudFormation stacks

**Minimum IAM Policy:**
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "lambda:*",
        "apigateway:*",
        "s3:*",
        "iam:*",
        "cloudformation:*",
        "logs:*"
      ],
      "Resource": "*"
    }
  ]
}
```

### For Lambda Function (Auto-configured)

The Lambda execution role automatically gets:
- `s3:PutObject` and `s3:PutObjectAcl` on S3 bucket
- `secretsmanager:GetSecretValue` on `catfish/*` secrets
- `ssm:GetParameter` on `/catfish/*` parameters

## Multi-Environment Setup

### Development Environment

```bash
# Profile: dev
export AWS_PROFILE=dev
./setup-secrets.sh  # Use dev API key
serverless deploy --stage dev
```

### Production Environment

```bash
# Profile: prod
export AWS_PROFILE=prod
./setup-secrets.sh  # Use prod API key
serverless deploy --stage prod
```

### Using Different Regions

```bash
serverless deploy --region eu-west-1 --aws-profile your-profile
```

## Troubleshooting

### Profile Not Found
```bash
# List available profiles
aws configure list-profiles

# Verify profile credentials
aws sts get-caller-identity --profile your-profile-name
```

### Access Denied Errors
- Verify your AWS profile has necessary IAM permissions
- Check that secrets/parameters exist in the correct region
- Ensure Lambda IAM role has access to secrets/parameters

### Secret Not Found
```bash
# List secrets
aws secretsmanager list-secrets --profile your-profile-name

# Describe specific secret
aws secretsmanager describe-secret \
  --secret-id catfish/hive-api-key \
  --profile your-profile-name
```

### Parameter Not Found
```bash
# List parameters
aws ssm describe-parameters \
  --filters "Key=Name,Values=/catfish/*" \
  --profile your-profile-name
```

## Best Practices

1. **Use different profiles for different environments** (dev, staging, prod)
2. **Store secrets in Secrets Manager** instead of environment variables
3. **Use least-privilege IAM policies** for both deployment and Lambda execution
4. **Enable MFA** for production AWS profiles
5. **Rotate secrets regularly** using AWS Secrets Manager rotation
6. **Use different regions** for disaster recovery
7. **Never commit AWS credentials** to version control

