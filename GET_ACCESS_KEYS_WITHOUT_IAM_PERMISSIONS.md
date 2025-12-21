# Getting Access Keys Without IAM User Permissions

This guide explains how to obtain AWS access keys when you have console access but don't have permissions to view or manage IAM users.

## Scenario

You are logged into the AWS Console but:
- ❌ Cannot see IAM users (no `iam:ListUsers` permission)
- ❌ Cannot manage other users
- ✅ Can access the console
- ✅ Need access keys for AWS CLI/API usage

## Solution Options

### Option 1: Create Access Keys for Yourself (Recommended)

If you have permission to create access keys for your own user account:

1. **Log into AWS Console**
2. **Click on your username** (top right corner)
3. **Click "Security credentials"** from the dropdown menu
4. **Scroll down to "Access keys"** section
5. **Click "Create access key"**
6. **Choose use case**: Select "CLI, SDK, & API access" or "Application running outside AWS"
7. **Download or copy**:
   - **Access Key ID** (starts with `AKIA...`)
   - **Secret Access Key** (shown only once - save it immediately!)

**Note**: You need the `iam:CreateAccessKey` permission for your own user ARN. If you get an error, see Option 2 or 3 below.

### Option 2: Use Console Session Credentials (Temporary)

If you can't create permanent access keys, you can use temporary credentials from your console session:

#### Using AWS CLI with Console Session

1. **Install AWS CLI** (if not already installed):
   ```bash
   # macOS
   brew install awscli
   
   # Linux
   pip install awscli
   ```

2. **Use browser-based credentials**:
   ```bash
   # This will open your browser to authenticate
   aws configure sso
   ```
   
   Or use the AWS Console's "Command line or programmatic access" feature:
   - Click your username (top right)
   - Click "Command line or programmatic access"
   - Copy the temporary credentials shown
   - These are valid for 1 hour

3. **Set temporary credentials**:
   ```bash
   export AWS_ACCESS_KEY_ID=ASIA...
   export AWS_SECRET_ACCESS_KEY=...
   export AWS_SESSION_TOKEN=...
   ```

**Limitation**: These credentials expire after 1 hour. You'll need to refresh them.

### Option 3: Request Permission from Admin

If you cannot create access keys yourself, ask an AWS administrator to:

#### A. Add Permission to Create Your Own Access Keys

The admin needs to add this policy statement to your user or a group you belong to:

**Option 1: Use the provided policy file** (recommended):
- Use the policy from `iam-policy-self-access-key.json` in this directory
- This uses `${aws:username}` variable which automatically applies to the current user

**Option 2: Manual policy**:
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "iam:CreateAccessKey",
        "iam:DeleteAccessKey",
        "iam:ListAccessKeys",
        "iam:UpdateAccessKey"
      ],
      "Resource": "arn:aws:iam::ACCOUNT_ID:user/YOUR_USERNAME"
    }
  ]
}
```

Replace:
- `ACCOUNT_ID` with your AWS account ID
- `YOUR_USERNAME` with your IAM username

**Note**: The policy file uses `${aws:username}` which automatically resolves to the current user, making it reusable for any user.

#### B. Have Admin Create Access Keys for You

Ask the admin to:

1. Go to IAM → Users → [Your Username]
2. Click "Security credentials" tab
3. Click "Create access key"
4. Share the credentials with you securely

### Option 4: Use AWS SSO (Single Sign-On)

If your organization uses AWS SSO:

1. **Access AWS SSO portal** (usually provided by your organization)
2. **Log in with your SSO credentials**
3. **Select the AWS account and role**
4. **Click "Command line or programmatic access"**
5. **Copy the temporary credentials**

These credentials are typically valid for 1-12 hours depending on your organization's settings.

## Finding Your Username

If you don't know your IAM username:

1. **In AWS Console**: Click your username (top right) - it shows your username
2. **Using AWS CLI** (if you have temporary credentials):
   ```bash
   aws sts get-caller-identity
   ```
   This shows your user ARN, which includes your username

## Verifying Your Access Keys

After obtaining access keys, verify they work:

```bash
# Set credentials
export AWS_ACCESS_KEY_ID=AKIA...
export AWS_SECRET_ACCESS_KEY=...

# Or use AWS profile
aws configure --profile myprofile

# Test access
aws sts get-caller-identity

# Test with profile
aws sts get-caller-identity --profile myprofile
```

## Setting Up AWS Profile

Once you have access keys, create a named profile:

```bash
aws configure --profile catfish
```

Enter:
- **AWS Access Key ID**: Your access key
- **AWS Secret Access Key**: Your secret key
- **Default region**: `us-east-1` (or your preferred region)
- **Default output format**: `json`

Then use it:
```bash
export AWS_PROFILE=catfish
# or
aws --profile catfish <command>
```

## Security Best Practices

1. **Never share your access keys** - treat them like passwords
2. **Rotate keys regularly** - every 90 days recommended
3. **Use least privilege** - only request permissions you actually need
4. **Enable MFA** - if available for your account
5. **Delete unused keys** - remove old access keys you no longer use
6. **Use IAM roles** - when possible instead of access keys (for EC2, Lambda, etc.)

## Troubleshooting

### Error: "User is not authorized to perform: iam:CreateAccessKey"

**Solution**: You need permission. Ask an admin to add the policy from Option 3A, or have them create the keys for you (Option 3B).

### Error: "Access Denied" when using credentials

**Possible causes**:
- Credentials are incorrect
- Credentials have expired (if temporary)
- Your user doesn't have necessary permissions for the action
- Wrong region specified

**Check**:
```bash
aws sts get-caller-identity
```

### Can't find "Security credentials" option

**Possible reasons**:
- You're using a federated/SSO account (use SSO portal instead)
- Your account type doesn't support access keys
- You need to use a different authentication method

## Alternative: Using AWS CloudShell

If you have console access, you can use AWS CloudShell:

1. **Open AWS CloudShell** (icon in top navigation bar)
2. **CloudShell automatically uses your console credentials**
3. **Run AWS CLI commands directly** without needing access keys

This is useful for quick tasks but has limitations (session timeout, limited resources).

## Summary

**Quick Answer**: 
1. Try clicking your username → "Security credentials" → "Create access key"
2. If that fails, use temporary credentials from "Command line or programmatic access"
3. If neither works, request an admin to add `iam:CreateAccessKey` permission for your user or create keys for you

