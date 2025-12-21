# Client AWS Credentials Setup Guide

This document provides step-by-step instructions for setting up AWS credentials for the Catfish Lambda deployment.

## What We Need From You

To deploy and manage the Catfish application, we need an AWS IAM user with specific permissions. Please follow these steps:

## Step 1: Create IAM User

1. Log into your AWS Console
2. Navigate to **IAM** → **Users** → **Add users**
3. Enter a username (e.g., `catfish-deployment-user`)
4. Select **Access type**: ✅ **Programmatic access** (required for AWS CLI)
5. Click **Next: Permissions**

## Step 2: Attach IAM Policy

1. Click **Attach policies directly**
2. Click **Create policy**
3. Click the **JSON** tab
4. Copy and paste the entire contents of **`iam-policy.json`** file (provided separately)
   - **Note:** This is an optimized policy that fits within AWS's 6144 character limit
   - For a more restrictive version, use `iam-policy-restrictive.json` instead
5. Click **Next**
6. Give the policy a name: `CatfishDeploymentPolicy`
7. (Optional) Add description: "Policy for Catfish Lambda deployment and management"
8. Click **Create policy**
9. Go back to the user creation page
10. Search for and select `CatfishDeploymentPolicy`
11. Click **Next: Tags** (optional)
12. Click **Next: Review**
13. Click **Create user**

## Step 3: Save Access Keys

⚠️ **IMPORTANT: Save these credentials immediately!**

After creating the user, you'll see:

1. **Access Key ID**: `AKIA...` (starts with AKIA)
2. **Secret Access Key**: `xxxx...` (shown only once!)

**Please save both values securely and share them with us.**

## Step 4: Optional - Create Named Profile

If you want to create a named AWS profile for this project:

```bash
aws configure --profile catfish
```

Enter:
- **AWS Access Key ID**: [the key from Step 3]
- **AWS Secret Access Key**: [the secret from Step 3]
- **Default region**: `us-east-1` (or your preferred region)
- **Default output format**: `json`

Then share the profile name with us: `catfish`

## What Permissions Are Included?

The IAM policy grants permissions for:

✅ **Lambda Functions**
- Create, update, delete Lambda functions
- Invoke functions
- Manage function configurations

✅ **S3 Buckets**
- Create and delete S3 buckets
- Upload, download, delete objects
- Manage bucket policies and CORS settings

✅ **API Gateway**
- Create and manage REST APIs
- Configure endpoints and deployments

✅ **AWS Secrets Manager**
- Store and retrieve API keys securely

✅ **SSM Parameter Store**
- Store configuration parameters

✅ **DynamoDB**
- Create and manage tables
- Read and write data

✅ **CloudFormation**
- Deploy infrastructure (used by Serverless Framework)

✅ **CloudWatch Logs**
- View and manage application logs

✅ **IAM Roles**
- Create execution roles for Lambda functions

## Verification

After creating the user, you can verify the setup:

```bash
# Test basic access
aws sts get-caller-identity

# Test Lambda permissions
aws lambda list-functions --region us-east-1

# Test S3 permissions
aws s3 ls
```

## Security Best Practices

1. ✅ **Least Privilege**: The policy only grants necessary permissions
2. ✅ **Resource-Scoped**: Most permissions are limited to specific resource patterns
3. ⚠️ **Key Rotation**: Plan to rotate access keys every 90 days
4. ⚠️ **MFA**: Consider enabling MFA for additional security
5. ⚠️ **Monitor Usage**: Check CloudTrail logs regularly for unauthorized access

## Information to Provide

Please share the following information:

1. ✅ **Access Key ID**
2. ✅ **Secret Access Key**
3. ✅ **AWS Region** (e.g., `us-east-1`)
4. ✅ **AWS Account ID** (optional - can retrieve with `aws sts get-caller-identity`)

## Support

If you encounter any issues:

1. Check that all required permissions are attached
2. Verify the IAM policy JSON is valid
3. Ensure the user has programmatic access enabled
4. Contact the deployment team for assistance

## Next Steps

Once we receive the credentials:

1. We'll configure them in our `.env` file
2. Run verification script to confirm all permissions
3. Deploy the Lambda function
4. Set up secrets in AWS Secrets Manager
5. Test the deployment

Thank you for your cooperation!

