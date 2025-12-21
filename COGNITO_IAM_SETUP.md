# Adding Cognito Permissions to IAM User

The IAM user needs additional permissions to create and manage Cognito User Pools. Follow these steps to add the required permissions.

## Option 1: Add Cognito Permissions to Existing Policy (Recommended)

If you have access to modify the IAM policy attached to your user:

1. Go to [AWS IAM Console](https://console.aws.amazon.com/iam/)
2. Navigate to **Users** → Select your user (`catfish`)
3. Click on the policy name under **Permissions**
4. Click **Edit policy** → **JSON** tab
5. Add the following statement to the `Statement` array:

```json
{
  "Sid": "Cognito",
  "Effect": "Allow",
  "Action": [
    "cognito-idp:*"
  ],
  "Resource": "*"
}
```

6. Click **Review policy** → **Save changes**

## Option 2: Create and Attach a New Cognito Policy

If you prefer to create a separate policy:

1. Go to [AWS IAM Console](https://console.aws.amazon.com/iam/)
2. Navigate to **Policies** → **Create policy**
3. Click **JSON** tab
4. Paste the following:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "CognitoFullAccess",
      "Effect": "Allow",
      "Action": [
        "cognito-idp:*"
      ],
      "Resource": "*"
    }
  ]
}
```

5. Click **Next**
6. Name the policy: `CatfishCognitoAccess`
7. Click **Create policy**
8. Go to **Users** → Select your user (`catfish`)
9. Click **Add permissions** → **Attach policies directly**
10. Search for and select `CatfishCognitoAccess`
11. Click **Next** → **Add permissions**

## Option 3: Use AWS CLI

If you have admin access or can use AWS CLI with a user that has permission to modify IAM:

```bash
# Create a policy document
cat > cognito-policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "CognitoFullAccess",
      "Effect": "Allow",
      "Action": [
        "cognito-idp:*"
      ],
      "Resource": "*"
    }
  ]
}
EOF

# Create the policy
aws iam create-policy \
  --policy-name CatfishCognitoAccess \
  --policy-document file://cognito-policy.json

# Note the Policy ARN from the output, then attach it to your user
aws iam attach-user-policy \
  --user-name catfish \
  --policy-arn arn:aws:iam::YOUR_ACCOUNT_ID:policy/CatfishCognitoAccess
```

Replace `YOUR_ACCOUNT_ID` with your AWS account ID (you can find it with `aws sts get-caller-identity`).

## Verify Permissions

After adding the permissions, verify they're working:

```bash
# Test Cognito permissions
aws cognito-idp list-user-pools --max-results 1

# If this command works without errors, permissions are configured correctly
```

## Required Cognito Permissions

The following Cognito permissions are needed for deployment:

- `cognito-idp:CreateUserPool` - Create User Pool
- `cognito-idp:UpdateUserPool` - Update User Pool
- `cognito-idp:DeleteUserPool` - Delete User Pool
- `cognito-idp:DescribeUserPool` - Describe User Pool
- `cognito-idp:CreateUserPoolClient` - Create User Pool Client
- `cognito-idp:UpdateUserPoolClient` - Update User Pool Client
- `cognito-idp:DeleteUserPoolClient` - Delete User Pool Client
- `cognito-idp:DescribeUserPoolClient` - Describe User Pool Client
- `cognito-idp:CreateUserPoolDomain` - Create User Pool Domain
- `cognito-idp:DeleteUserPoolDomain` - Delete User Pool Domain
- `cognito-idp:DescribeUserPoolDomain` - Describe User Pool Domain
- `cognito-idp:ListUserPools` - List User Pools

Using `cognito-idp:*` covers all these and more, which is the simplest approach.

## After Adding Permissions

Once permissions are added:

1. Wait a few seconds for the permissions to propagate
2. Try deploying again:
   ```bash
   cd lambda
   serverless deploy
   ```

## Troubleshooting

### Still Getting Permission Errors

1. **Wait for propagation**: IAM changes can take a few seconds to propagate. Wait 10-30 seconds and try again.

2. **Check policy attachment**: Verify the policy is actually attached to your user:
   ```bash
   aws iam list-attached-user-policies --user-name catfish
   aws iam list-user-policies --user-name catfish
   ```

3. **Check effective permissions**: Use the IAM Policy Simulator:
   - Go to [IAM Policy Simulator](https://console.aws.amazon.com/iam/home#/policies/simulator)
   - Select your user
   - Test action: `cognito-idp:CreateUserPool`
   - Check if it's allowed

4. **Verify account limits**: Check if you've hit any Cognito service limits:
   ```bash
   aws cognito-idp list-user-pools --max-results 60
   ```

### Alternative: Use IAM Role Instead

If you continue having issues with IAM user permissions, consider using an IAM role instead:

1. Create an IAM role with the necessary permissions
2. Use AWS STS to assume the role
3. Use the assumed role credentials for deployment

For more information, see [AWS IAM Roles Documentation](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles.html).

