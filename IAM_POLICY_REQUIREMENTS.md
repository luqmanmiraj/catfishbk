# AWS IAM Policy Requirements

This document outlines the IAM policies and permissions required for deploying and managing the Catfish Lambda application.

## Overview

The IAM user needs permissions to:
- Deploy and manage Lambda functions
- Create and manage API Gateway endpoints
- Create, manage, and delete S3 buckets and objects
- Manage AWS Secrets Manager secrets
- Manage SSM Parameter Store parameters
- Create and manage IAM roles (for Lambda execution)
- Manage CloudFormation stacks (used by Serverless Framework)
- Manage CloudWatch Logs
- Access DynamoDB (if needed for future features)

## IAM Policy Document

**⚠️ IMPORTANT:** The policy files have been optimized to be under AWS's 6144 character limit (non-whitespace). 

**✅ READY-TO-USE POLICIES:**
- **`iam-policy.json`** - Optimized version (recommended, ~1162 chars, uses wildcards)
- **`iam-policy-restrictive.json`** - More restrictive version (~1400 chars, specific actions)

Both files are ready to use. Simply copy the contents of `iam-policy.json` when creating the IAM policy in AWS Console.

The detailed policy examples below are for reference only and show what permissions are included.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "LambdaManagement",
      "Effect": "Allow",
      "Action": [
        "lambda:CreateFunction",
        "lambda:UpdateFunctionCode",
        "lambda:UpdateFunctionConfiguration",
        "lambda:DeleteFunction",
        "lambda:GetFunction",
        "lambda:GetFunctionConfiguration",
        "lambda:ListFunctions",
        "lambda:InvokeFunction",
        "lambda:AddPermission",
        "lambda:RemovePermission",
        "lambda:CreateFunctionUrlConfig",
        "lambda:DeleteFunctionUrlConfig",
        "lambda:GetFunctionUrlConfig",
        "lambda:UpdateFunctionUrlConfig",
        "lambda:PutFunctionConcurrency",
        "lambda:DeleteFunctionConcurrency",
        "lambda:TagResource",
        "lambda:UntagResource",
        "lambda:ListTags",
        "lambda:PublishVersion",
        "lambda:CreateAlias",
        "lambda:UpdateAlias",
        "lambda:DeleteAlias",
        "lambda:GetAlias",
        "lambda:ListAliases"
      ],
      "Resource": [
        "arn:aws:lambda:*:*:function:image-analysis-*",
        "arn:aws:lambda:*:*:function:*-dev-analyzeImage",
        "arn:aws:lambda:*:*:function:*-prod-analyzeImage",
        "arn:aws:lambda:*:*:function:*-staging-analyzeImage"
      ]
    },
    {
      "Sid": "APIGatewayManagement",
      "Effect": "Allow",
      "Action": [
        "apigateway:POST",
        "apigateway:GET",
        "apigateway:PUT",
        "apigateway:PATCH",
        "apigateway:DELETE",
        "apigateway:HEAD",
        "apigateway:OPTIONS"
      ],
      "Resource": [
        "arn:aws:apigateway:*::/restapis",
        "arn:aws:apigateway:*::/restapis/*",
        "arn:aws:apigateway:*::/restapis/*/*",
        "arn:aws:apigateway:*::/restapis/*/resources",
        "arn:aws:apigateway:*::/restapis/*/resources/*",
        "arn:aws:apigateway:*::/restapis/*/deployments",
        "arn:aws:apigateway:*::/restapis/*/deployments/*",
        "arn:aws:apigateway:*::/restapis/*/stages",
        "arn:aws:apigateway:*::/restapis/*/stages/*"
      ]
    },
    {
      "Sid": "APIGatewayLogging",
      "Effect": "Allow",
      "Action": [
        "apigateway:PUT",
        "apigateway:GET"
      ],
      "Resource": [
        "arn:aws:logs:*:*:*"
      ]
    },
    {
      "Sid": "S3BucketManagement",
      "Effect": "Allow",
      "Action": [
        "s3:CreateBucket",
        "s3:DeleteBucket",
        "s3:ListBucket",
        "s3:GetBucketLocation",
        "s3:GetBucketVersioning",
        "s3:PutBucketVersioning",
        "s3:GetBucketPolicy",
        "s3:PutBucketPolicy",
        "s3:DeleteBucketPolicy",
        "s3:GetBucketPublicAccessBlock",
        "s3:PutBucketPublicAccessBlock",
        "s3:GetBucketCors",
        "s3:PutBucketCors",
        "s3:DeleteBucketCors",
        "s3:GetBucketTagging",
        "s3:PutBucketTagging",
        "s3:GetBucketNotification",
        "s3:PutBucketNotification"
      ],
      "Resource": [
        "arn:aws:s3:::*"
      ]
    },
    {
      "Sid": "S3ObjectManagement",
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject",
        "s3:DeleteObject",
        "s3:GetObjectVersion",
        "s3:DeleteObjectVersion",
        "s3:PutObjectAcl",
        "s3:GetObjectAcl",
        "s3:ListMultipartUploadParts",
        "s3:AbortMultipartUpload"
      ],
      "Resource": [
        "arn:aws:s3:::*/*"
      ]
    },
    {
      "Sid": "SecretsManagerManagement",
      "Effect": "Allow",
      "Action": [
        "secretsmanager:CreateSecret",
        "secretsmanager:UpdateSecret",
        "secretsmanager:DeleteSecret",
        "secretsmanager:GetSecretValue",
        "secretsmanager:DescribeSecret",
        "secretsmanager:ListSecrets",
        "secretsmanager:PutSecretValue",
        "secretsmanager:RestoreSecret",
        "secretsmanager:TagResource",
        "secretsmanager:UntagResource"
      ],
      "Resource": [
        "arn:aws:secretsmanager:*:*:secret:catfish/*"
      ]
    },
    {
      "Sid": "SSMParameterStoreManagement",
      "Effect": "Allow",
      "Action": [
        "ssm:PutParameter",
        "ssm:GetParameter",
        "ssm:GetParameters",
        "ssm:GetParametersByPath",
        "ssm:DeleteParameter",
        "ssm:DeleteParameters",
        "ssm:DescribeParameters",
        "ssm:AddTagsToResource",
        "ssm:RemoveTagsFromResource",
        "ssm:ListTagsForResource"
      ],
      "Resource": [
        "arn:aws:ssm:*:*:parameter/catfish/*"
      ]
    },
    {
      "Sid": "IAMRoleManagement",
      "Effect": "Allow",
      "Action": [
        "iam:CreateRole",
        "iam:DeleteRole",
        "iam:GetRole",
        "iam:GetRolePolicy",
        "iam:ListRolePolicies",
        "iam:ListAttachedRolePolicies",
        "iam:PutRolePolicy",
        "iam:DeleteRolePolicy",
        "iam:AttachRolePolicy",
        "iam:DetachRolePolicy",
        "iam:TagRole",
        "iam:UntagRole",
        "iam:ListRoleTags",
        "iam:PassRole"
      ],
      "Resource": [
        "arn:aws:iam::*:role/*image-analysis*",
        "arn:aws:iam::*:role/*-dev-*",
        "arn:aws:iam::*:role/*-prod-*",
        "arn:aws:iam::*:role/*-staging-*"
      ]
    },
    {
      "Sid": "CloudFormationManagement",
      "Effect": "Allow",
      "Action": [
        "cloudformation:CreateStack",
        "cloudformation:UpdateStack",
        "cloudformation:DeleteStack",
        "cloudformation:DescribeStacks",
        "cloudformation:DescribeStackEvents",
        "cloudformation:DescribeStackResources",
        "cloudformation:GetTemplate",
        "cloudformation:ValidateTemplate",
        "cloudformation:ListStackResources",
        "cloudformation:TagResource",
        "cloudformation:UntagResource",
        "cloudformation:ListTagsForResource"
      ],
      "Resource": [
        "arn:aws:cloudformation:*:*:stack/image-analysis-*",
        "arn:aws:cloudformation:*:*:stack/*-dev-*",
        "arn:aws:cloudformation:*:*:stack/*-prod-*",
        "arn:aws:cloudformation:*:*:stack/*-staging-*",
        "arn:aws:cloudformation:*:*:stackserverless*"
      ]
    },
    {
      "Sid": "CloudWatchLogsManagement",
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:DeleteLogGroup",
        "logs:DescribeLogGroups",
        "logs:PutRetentionPolicy",
        "logs:CreateLogStream",
        "logs:DescribeLogStreams",
        "logs:PutLogEvents",
        "logs:TagLogGroup",
        "logs:UntagLogGroup",
        "logs:ListTagsLogGroup"
      ],
      "Resource": [
        "arn:aws:logs:*:*:log-group:/aws/lambda/image-analysis-*",
        "arn:aws:logs:*:*:log-group:/aws/lambda/*-dev-*",
        "arn:aws:logs:*:*:log-group:/aws/lambda/*-prod-*",
        "arn:aws:logs:*:*:log-group:/aws/lambda/*-staging-*",
        "arn:aws:logs:*:*:log-group:/aws/apigateway/*"
      ]
    },
    {
      "Sid": "DynamoDBManagement",
      "Effect": "Allow",
      "Action": [
        "dynamodb:CreateTable",
        "dynamodb:DeleteTable",
        "dynamodb:DescribeTable",
        "dynamodb:ListTables",
        "dynamodb:PutItem",
        "dynamodb:GetItem",
        "dynamodb:UpdateItem",
        "dynamodb:DeleteItem",
        "dynamodb:Query",
        "dynamodb:Scan",
        "dynamodb:BatchGetItem",
        "dynamodb:BatchWriteItem",
        "dynamodb:DescribeTimeToLive",
        "dynamodb:UpdateTimeToLive",
        "dynamodb:TagResource",
        "dynamodb:UntagResource",
        "dynamodb:ListTagsOfResource",
        "dynamodb:UpdateTable",
        "dynamodb:DescribeContinuousBackups",
        "dynamodb:CreateBackup",
        "dynamodb:DeleteBackup",
        "dynamodb:DescribeBackup",
        "dynamodb:ListBackups"
      ],
      "Resource": [
        "arn:aws:dynamodb:*:*:table/catfish-*",
        "arn:aws:dynamodb:*:*:table/image-analysis-*"
      ]
    },
    {
      "Sid": "DynamoDBStreamManagement",
      "Effect": "Allow",
      "Action": [
        "dynamodb:DescribeStream",
        "dynamodb:GetRecords",
        "dynamodb:GetShardIterator",
        "dynamodb:ListStreams"
      ],
      "Resource": [
        "arn:aws:dynamodb:*:*:table/catfish-*/stream/*",
        "arn:aws:dynamodb:*:*:table/image-analysis-*/stream/*"
      ]
    },
    {
      "Sid": "EC2NetworkManagement",
      "Effect": "Allow",
      "Action": [
        "ec2:DescribeVpcs",
        "ec2:DescribeSubnets",
        "ec2:DescribeSecurityGroups",
        "ec2:DescribeNetworkInterfaces"
      ],
      "Resource": "*"
    },
    {
      "Sid": "STSAssumeRole",
      "Effect": "Allow",
      "Action": [
        "sts:GetCallerIdentity",
        "sts:AssumeRole"
      ],
      "Resource": "*"
    }
  ]
}
```

## Minimal Policy (More Restrictive)

If you want a more restrictive policy with only necessary permissions:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "LambdaManagement",
      "Effect": "Allow",
      "Action": [
        "lambda:*"
      ],
      "Resource": [
        "arn:aws:lambda:*:*:function:image-analysis-*"
      ]
    },
    {
      "Sid": "APIGatewayManagement",
      "Effect": "Allow",
      "Action": [
        "apigateway:*"
      ],
      "Resource": "*"
    },
    {
      "Sid": "S3FullAccess",
      "Effect": "Allow",
      "Action": [
        "s3:*"
      ],
      "Resource": "*"
    },
    {
      "Sid": "SecretsManagerManagement",
      "Effect": "Allow",
      "Action": [
        "secretsmanager:*"
      ],
      "Resource": [
        "arn:aws:secretsmanager:*:*:secret:catfish/*"
      ]
    },
    {
      "Sid": "SSMParameterStoreManagement",
      "Effect": "Allow",
      "Action": [
        "ssm:*"
      ],
      "Resource": [
        "arn:aws:ssm:*:*:parameter/catfish/*"
      ]
    },
    {
      "Sid": "IAMRoleManagement",
      "Effect": "Allow",
      "Action": [
        "iam:CreateRole",
        "iam:DeleteRole",
        "iam:GetRole",
        "iam:PutRolePolicy",
        "iam:DeleteRolePolicy",
        "iam:AttachRolePolicy",
        "iam:DetachRolePolicy",
        "iam:PassRole",
        "iam:TagRole",
        "iam:ListRoleTags"
      ],
      "Resource": [
        "arn:aws:iam::*:role/*image-analysis*"
      ]
    },
    {
      "Sid": "CloudFormationManagement",
      "Effect": "Allow",
      "Action": [
        "cloudformation:*"
      ],
      "Resource": "*"
    },
    {
      "Sid": "CloudWatchLogsManagement",
      "Effect": "Allow",
      "Action": [
        "logs:*"
      ],
      "Resource": "*"
    },
    {
      "Sid": "DynamoDBFullAccess",
      "Effect": "Allow",
      "Action": [
        "dynamodb:*"
      ],
      "Resource": "*"
    },
    {
      "Sid": "EC2Describe",
      "Effect": "Allow",
      "Action": [
        "ec2:Describe*"
      ],
      "Resource": "*"
    },
    {
      "Sid": "STSAssumeRole",
      "Effect": "Allow",
      "Action": [
        "sts:GetCallerIdentity"
      ],
      "Resource": "*"
    }
  ]
}
```

## AWS CLI Setup Instructions for Client

Send these instructions to your client:

### 1. Create IAM User

1. Go to AWS IAM Console → Users → Add users
2. Username: `catfish-deployment-user` (or any name)
3. Access type: **Programmatic access** (for AWS CLI/API)
4. Attach the IAM policy from above (copy the full policy JSON)

### 2. Create Access Keys

1. After user creation, go to **Security credentials** tab
2. Click **Create access key**
3. Choose **CLI, SDK, & API access**
4. Download or copy:
   - **Access Key ID**
   - **Secret Access Key**

### 3. Provide Credentials

Share these with the deployment team:
- **Access Key ID**: `AKIA...`
- **Secret Access Key**: `xxxx...`
- **Region**: `us-east-1` (or preferred region)
- **Account ID**: (optional, can be retrieved with `aws sts get-caller-identity`)

### 4. Optional: Create AWS Profile

The client can also create a named profile:

```bash
aws configure --profile catfish
# Enter Access Key ID
# Enter Secret Access Key
# Enter region (e.g., us-east-1)
# Enter output format (json)
```

Then set in `.env`:
```
AWS_PROFILE=catfish
```

## Verification Steps

After receiving credentials, verify permissions:

```bash
# Test AWS CLI access
aws sts get-caller-identity

# Test Lambda permissions
aws lambda list-functions --region us-east-1

# Test S3 permissions
aws s3 ls

# Test Secrets Manager permissions
aws secretsmanager list-secrets --region us-east-1

# Test SSM permissions
aws ssm describe-parameters --region us-east-1

# Test DynamoDB permissions
aws dynamodb list-tables --region us-east-1

# Test CloudFormation permissions
aws cloudformation list-stacks --region us-east-1
```

## Important Notes

1. **Security Best Practices**:
   - Use IAM roles instead of users when possible (for EC2/ECS)
   - Enable MFA for production accounts
   - Rotate access keys regularly (every 90 days recommended)
   - Use least-privilege principle - only grant necessary permissions

2. **Resource Naming**:
   - The policies use wildcards for resource names like `image-analysis-*`
   - Adjust resource ARNs if using different naming conventions
   - Update DynamoDB table names if different from `catfish-*` or `image-analysis-*`

3. **Region-Specific**:
   - Replace `*` in resource ARNs with specific regions if needed
   - Most resources are region-specific except IAM

4. **Serverless Framework Requirements**:
   - Serverless Framework uses CloudFormation under the hood
   - It requires permissions to create/manage IAM roles for Lambda execution
   - Some permissions may be needed for API Gateway v1 and v2

5. **Cost Considerations**:
   - S3 buckets incur storage costs
   - Lambda invocations have free tier limits
   - API Gateway charges per request
   - DynamoDB has read/write capacity unit costs

## Troubleshooting

If deployment fails with permission errors:

1. **Check IAM Policy**: Verify all required actions are included
2. **Check Resource ARNs**: Ensure resource patterns match actual resource names
3. **Check Region**: Ensure permissions are granted in the correct region
4. **Check Credentials**: Verify access keys are active and correct
5. **Check Service Limits**: Some services have default limits (e.g., Lambda concurrent executions)

## Additional Resources

- [AWS IAM Best Practices](https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html)
- [Serverless Framework AWS Setup](https://www.serverless.com/framework/docs/providers/aws/guide/credentials)
- [AWS Security Best Practices](https://aws.amazon.com/architecture/security-identity-compliance/)

