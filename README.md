# Image Analysis Lambda Function

This Lambda function receives images from the mobile application, stores them in an S3 bucket, and calls the Hive API to detect image manipulation.

## Features

- Receives base64-encoded images from mobile app
- Uploads images to S3 bucket
- Generates public S3 URL for the uploaded image
- Calls Hive API to analyze image for manipulation/deepfake detection
- Returns analysis results to the mobile app

## Prerequisites

1. AWS Account with appropriate permissions
2. Node.js 18.x or later
3. Serverless Framework installed globally: `npm install -g serverless`
4. AWS CLI configured with credentials
5. Hive API key

## Setup

### Option 0: Using .env File (Easiest for Local Development)

This is the simplest approach for local development - all configuration is stored in a `.env` file.

1. Copy the example environment file:
```bash
cd lambda
cp .env.example .env
```

2. Edit `.env` and fill in your configuration:
```bash
# AWS Configuration
AWS_REGION=us-east-1
AWS_PROFILE=default

# AWS Access Keys (for local development)
AWS_ACCESS_KEY_ID=your-access-key-id
AWS_SECRET_ACCESS_KEY=your-secret-access-key

# Hive API Configuration
HIVE_API_KEY=your-hive-api-key
HIVE_ENDPOINT=https://api.thehive.ai/api/v3/chat/completions

# S3 Configuration
S3_BUCKET_NAME=your-bucket-name
```

3. Install dependencies:
```bash
npm install
```

4. The `.env` file will be automatically loaded by:
   - `image-analysis-handler.js` (via dotenv)
   - `setup-secrets.sh` (reads .env before prompting)
   - `deploy.sh` (loads .env automatically)
   - `test-local.js` (loads .env automatically)

5. Test locally:
```bash
node test-local.js
```

6. Deploy:
```bash
./deploy.sh
```

**Note:** The `.env` file is already in `.gitignore` and will not be committed to version control. The `.env.example` file serves as a template for all required variables.

### Option 1: Using AWS Secrets Manager and SSM Parameter Store (Recommended for Production)

This is the most secure approach - secrets are stored in AWS services, not in environment variables.

1. Install dependencies:
```bash
cd lambda
npm install
```

2. **Optional:** Create a `.env` file (see Option 0 above) or set up AWS credentials using a profile:
```bash
# Configure AWS profile (if not already done)
aws configure --profile your-profile-name

# Or set environment variable
export AWS_PROFILE=your-profile-name
```

3. Run the setup script to store secrets in AWS:
```bash
./setup-secrets.sh
```

This script will:
- Automatically load values from `.env` file if it exists
- Store your Hive API key in AWS Secrets Manager
- Optionally store Hive endpoint in SSM Parameter Store
- Optionally store S3 bucket name in SSM Parameter Store

4. Deploy using your AWS profile:
```bash
# Using environment variable
AWS_PROFILE=your-profile-name serverless deploy

# Or using flag
serverless deploy --aws-profile your-profile-name --region us-east-1
```

### Option 2: Using Environment Variables

If you prefer to use environment variables instead of AWS services:

1. Install dependencies:
```bash
cd lambda
npm install
```

2. Set environment variables:
```bash
export HIVE_API_KEY="your-hive-api-key-here"
export S3_BUCKET_NAME="your-unique-bucket-name-here"
export HIVE_ENDPOINT="https://api.thehive.ai/api/v3/chat/completions"  # Optional
```

3. Deploy the function:
```bash
serverless deploy
```

## Configuration

The Lambda function supports multiple configuration methods with the following priority:

1. **AWS Secrets Manager** (highest priority, most secure)
2. **AWS SSM Parameter Store**
3. **Environment Variables** (fallback)
4. **Default values**

### Configuration Methods

#### AWS Secrets Manager

Store your Hive API key securely in AWS Secrets Manager:

```bash
# Create secret
aws secretsmanager create-secret \
  --name catfish/hive-api-key \
  --secret-string '{"apiKey":"your-api-key-here"}' \
  --region us-east-1

# Or use the setup script
./setup-secrets.sh
```

The Lambda function will automatically retrieve the secret at runtime.

#### AWS SSM Parameter Store

Store configuration values in SSM Parameter Store:

```bash
# Store Hive endpoint
aws ssm put-parameter \
  --name /catfish/hive-endpoint \
  --value "https://api.thehive.ai/api/v3/chat/completions" \
  --type String \
  --region us-east-1

# Store S3 bucket name
aws ssm put-parameter \
  --name /catfish/s3-bucket-name \
  --value "your-bucket-name" \
  --type String \
  --region us-east-1
```

#### Environment Variables (Fallback)

If AWS services are not used, the function falls back to environment variables:

- `HIVE_API_KEY`: Your Hive API key (required if not in Secrets Manager)
- `S3_BUCKET_NAME`: Name for the S3 bucket to store images (required if not in SSM)
- `HIVE_ENDPOINT`: Hive API endpoint (optional, defaults to chat completions endpoint)

#### Custom Secret/Parameter Names

You can customize the secret and parameter names using environment variables:

- `HIVE_API_KEY_SECRET_NAME`: Defaults to `catfish/hive-api-key`
- `HIVE_ENDPOINT_PARAM_NAME`: Defaults to `/catfish/hive-endpoint`
- `S3_BUCKET_PARAM_NAME`: Defaults to `/catfish/s3-bucket-name`

### AWS Profile Configuration

The Serverless Framework supports AWS profiles for credential management:

```bash
# Set profile via environment variable
export AWS_PROFILE=my-profile
serverless deploy

# Or use the --aws-profile flag
serverless deploy --aws-profile my-profile

# Or specify in serverless.yml (not recommended for shared repos)
```

Configure profiles using:
```bash
aws configure --profile my-profile
```

This will prompt for:
- AWS Access Key ID
- AWS Secret Access Key
- Default region
- Default output format

### IAM Permissions

The Lambda function needs the following permissions (automatically configured in `serverless.yml`):

**S3 Permissions:**
- `s3:PutObject` on the S3 bucket
- `s3:PutObjectAcl` on the S3 bucket

**Secrets Manager Permissions:**
- `secretsmanager:GetSecretValue` on secrets matching `catfish/*`
- `secretsmanager:DescribeSecret` on secrets matching `catfish/*`

**SSM Parameter Store Permissions:**
- `ssm:GetParameter` on parameters matching `/catfish/*`
- `ssm:GetParameters` on parameters matching `/catfish/*`

All permissions are automatically configured in the `serverless.yml` file.

## API Usage

### Endpoint

After deployment, you'll get an endpoint URL like:
```
https://xxxxx.execute-api.us-east-1.amazonaws.com/dev/analyze
```

### Request Format

**POST** `/analyze`

Request body:
```json
{
  "image": "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQ..."
}
```

The image can be:
- Base64 encoded with data URL prefix: `data:image/jpeg;base64,<base64-data>`
- Base64 encoded without prefix (assumed to be JPEG)

### Response Format

**Success (200):**
```json
{
  "success": true,
  "s3Url": "https://bucket-name.s3.amazonaws.com/images/uuid.jpg",
  "analysis": {
    "id": "...",
    "object": "chat.completion",
    "choices": [...]
  }
}
```

**Error (500):**
```json
{
  "success": false,
  "error": "Error message here"
}
```

## Mobile App Integration

Update your mobile app to call this Lambda endpoint instead of calling Hive API directly:

```javascript
const analyzeImage = async (imageUri) => {
  // Convert image to base64
  const base64Image = await FileSystem.readAsStringAsync(imageUri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  
  const imageFormat = imageUri.toLowerCase().includes('.png') ? 'png' : 'jpeg';
  const imageDataUrl = `data:image/${imageFormat};base64,${base64Image}`;
  
  // Call Lambda function
  const response = await fetch('YOUR_LAMBDA_ENDPOINT/analyze', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      image: imageDataUrl,
    }),
  });
  
  const result = await response.json();
  return result;
};
```

## Local Testing

You can test the Lambda function locally using the Serverless Framework:

```bash
serverless invoke local -f analyzeImage --data '{"body": "{\"image\": \"data:image/jpeg;base64,...\"}"}'
```

Or use the included test script (automatically loads `.env` file):
```bash
node test-local.js
```

**Note:** Make sure you have a `.env` file with all required variables (see Option 0 above), or set environment variables manually before running tests.

## Cleanup

To remove all resources:
```bash
serverless remove
```

## Security Notes

1. **API Key Security**: 
   - ✅ **Recommended**: Store the Hive API key in AWS Secrets Manager (use `setup-secrets.sh`)
   - ⚠️ **Not Recommended**: Storing API keys in environment variables or code
   - The Lambda function automatically retrieves secrets at runtime

2. **AWS Profile Security**: 
   - Use AWS IAM profiles with least-privilege permissions
   - Never commit AWS credentials to version control
   - Use AWS profiles for different environments (dev, staging, prod)

3. **CORS**: Currently configured to allow all origins (`*`). Restrict this in production:
   ```yaml
   cors:
     origin: 'https://yourdomain.com'
     headers: 'Content-Type,Authorization'
   ```

4. **S3 Bucket**: Images are stored with public-read ACL. Consider implementing signed URLs for better security in production.

5. **Rate Limiting**: Consider adding API Gateway throttling for production use.

6. **Secrets Rotation**: Set up automatic rotation for secrets in AWS Secrets Manager for enhanced security.

## Troubleshooting

### Common Issues

1. **"Hive API key not found"**
   - **If using Secrets Manager**: Verify the secret exists:
     ```bash
     aws secretsmanager describe-secret --secret-id catfish/hive-api-key
     ```
   - **If using environment variables**: Make sure `HIVE_API_KEY` is exported
   - Check IAM permissions for Secrets Manager access
   - Verify the secret name matches `HIVE_API_KEY_SECRET_NAME` environment variable

2. **"S3 bucket name not found"**
   - **If using SSM**: Verify the parameter exists:
     ```bash
     aws ssm get-parameter --name /catfish/s3-bucket-name
     ```
   - **If using environment variables**: Set `S3_BUCKET_NAME` before deployment
   - Ensure the bucket name is globally unique

3. **AWS Profile Issues**
   - Verify profile exists: `aws configure list-profiles`
   - Check credentials: `aws sts get-caller-identity --profile your-profile`
   - Ensure profile has necessary permissions for Lambda, S3, Secrets Manager, and SSM

4. **Secrets Manager Access Denied**
   - Verify Lambda IAM role has `secretsmanager:GetSecretValue` permission
   - Check that the secret name matches the IAM policy resource ARN
   - Ensure you're using the correct AWS region

5. **SSM Parameter Access Denied**
   - Verify Lambda IAM role has `ssm:GetParameter` permission
   - Check that the parameter name matches the IAM policy resource ARN
   - Ensure parameters are in the same region as the Lambda function

6. **CORS errors**
   - Verify CORS is enabled on the API Gateway endpoint
   - Check that your mobile app is sending the correct headers
   - Review API Gateway CORS configuration in AWS Console

7. **S3 upload failures**
   - Verify IAM role has `s3:PutObject` and `s3:PutObjectAcl` permissions
   - Check bucket policy allows public access if needed
   - Verify bucket exists and is in the same region as Lambda

8. **Deployment fails with profile**
   - Ensure AWS profile is configured: `aws configure --profile your-profile`
   - Use `--aws-profile` flag or `AWS_PROFILE` environment variable
   - Check Serverless Framework has access to your AWS credentials

