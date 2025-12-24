# Fix Serverless Framework Deployment Bucket Permission Error

## Error Message
```
User: arn:aws:iam::299589794931:user/catfish is not authorized to perform: s3:ListBucket 
on resource: "arn:aws:s3:::image-analysis-dev-deployment-us-east-1" 
with an explicit deny in an identity-based policy
```

## Quick Fix Steps

### Option 1: Run the Diagnostic Script
```bash
cd lambda
./fix-deployment-bucket-permissions.sh
```

This will:
- Check if the bucket exists and create it if needed
- Diagnose permission issues
- Show you what policies are attached to your user

### Option 2: Manual Fix

#### Step 1: Create the Deployment Bucket
```bash
aws s3api create-bucket \
  --bucket image-analysis-dev-deployment-us-east-1 \
  --region us-east-1 \
  --profile catfish
```

#### Step 2: Check for Deny Policies
Check if there are any Deny policies attached to your IAM user:
```bash
# List inline policies
aws iam list-user-policies --user-name catfish --profile catfish

# List attached policies
aws iam list-attached-user-policies --user-name catfish --profile catfish

# Get policy details (replace POLICY_NAME with actual policy name)
aws iam get-user-policy --user-name catfish --policy-name POLICY_NAME --profile catfish
```

If you find a Deny policy, you need to either:
- Remove it (if you have permission)
- Ask your AWS administrator to remove it
- Modify it to exclude the deployment bucket

#### Step 3: Ensure Allow Policy is Applied
Make sure your IAM user has the `iam-policy.json` or `iam-policy-restrictive.json` attached, which includes:
```json
{
  "Sid": "S3",
  "Effect": "Allow",
  "Action": [
    "s3:ListBucket",
    "s3:CreateBucket",
    "s3:PutObject",
    "s3:GetObject",
    "s3:DeleteObject"
  ],
  "Resource": "*"
}
```

#### Step 4: Attach Additional Policy (if needed)
If the generic S3 policy doesn't work due to explicit denies, attach the specific deployment bucket policy:
```bash
aws iam put-user-policy \
  --user-name catfish \
  --policy-name ServerlessFrameworkDeploymentBucket \
  --policy-document file://iam-policy-serverless-deployment.json \
  --profile catfish
```

### Option 3: Use a Different Deployment Bucket Name
If you can't fix the permissions, you can specify a different bucket name in `serverless.yml`:

```yaml
provider:
  deploymentBucket:
    name: my-custom-deployment-bucket-name
    serverSideEncryption: AES256
```

Then create that bucket manually:
```bash
aws s3api create-bucket \
  --bucket my-custom-deployment-bucket-name \
  --region us-east-1 \
  --profile catfish
```

### Option 4: Disable Deployment Bucket (Not Recommended)
You can disable the deployment bucket in `serverless.yml`, but this is not recommended for production:
```yaml
provider:
  deploymentBucket: false
```

## Common Causes

1. **Explicit Deny Policy**: An IAM policy with `Effect: Deny` is blocking access
2. **Bucket Policy**: The bucket has a policy that denies your user
3. **Missing Permissions**: Your IAM user doesn't have `s3:ListBucket` permission
4. **Bucket Doesn't Exist**: The bucket needs to be created first

## Verification

After applying fixes, verify access:
```bash
# Test bucket access
aws s3 ls s3://image-analysis-dev-deployment-us-east-1 --profile catfish

# Test deployment
cd lambda
serverless deploy --profile catfish
```

## Need Help?

If the issue persists:
1. Check CloudTrail logs for detailed error messages
2. Review IAM policy evaluation logic in AWS Console
3. Contact your AWS administrator to review account-level policies

