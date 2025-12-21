# AWS Cognito User Pool Setup Guide

This guide explains the AWS Cognito User Pool configuration with Passkeys (WebAuthn) as the preferred sign-in method and email as a fallback.

## Overview

The Cognito User Pool is configured via CloudFormation in `serverless.yml` with the following features:

- **Primary Authentication**: Passkeys (WebAuthn) - passwordless, secure authentication
- **Fallback Authentication**: Email OTP (One-Time Password)
- **User Attributes**: Email (required), Name (optional)
- **MFA Configuration**: Optional (required for passwordless authentication)
- **Email Verification**: Required for email attribute

## Resources Created

After deployment, the following resources are created:

1. **CognitoUserPool**: The main user pool with email-based authentication
2. **CognitoUserPoolClient**: Application client for authentication
3. **CognitoUserPoolDomain**: Domain for hosted UI and WebAuthn Relying Party

## Outputs

After deployment, the following values are available:

- `CognitoUserPoolId`: User Pool ID (e.g., `us-east-1_XXXXXXXXX`)
- `CognitoUserPoolArn`: Full ARN of the User Pool
- `CognitoUserPoolClientId`: Client ID for your application
- `CognitoUserPoolDomain`: Domain name (e.g., `image-analysis-dev`)
- `CognitoAuthUrl`: Full authentication URL

To retrieve these values after deployment:

```bash
# Get all stack outputs
serverless info --verbose

# Or using AWS CLI
aws cloudformation describe-stacks \
  --stack-name image-analysis-dev \
  --query 'Stacks[0].Outputs' \
  --output table
```

## Enabling Passkeys (WebAuthn)

**Important**: Passkeys/WebAuthn must be enabled via the AWS Console after deployment, as CloudFormation doesn't yet support direct configuration of Passkeys.

### Step 1: Access the User Pool

1. Go to the [AWS Cognito Console](https://console.aws.amazon.com/cognito/)
2. Select your User Pool: `image-analysis-{stage}-user-pool`
3. Navigate to **Sign-in experience** in the left sidebar

### Step 2: Enable Choice-Based Sign-In

1. Under **Sign-in experience**, click **Edit**
2. Under **Options for choice-based sign-in**, enable:
   - ✅ **Passkey** (set as preferred)
   - ✅ **Email OTP**
3. Click **Save changes**

### Step 3: Configure Passkey Settings

1. Click **Edit** next to **Passkey**
2. Configure the following:

   **User verification mode**:
   - **PREFERRED** (recommended): Allows both verified and unverified passkeys
   - **REQUIRED**: Only verified passkeys allowed (higher security)

   **Relying Party ID**:
   - Default: `{domain}.auth.{region}.amazoncognito.com`
   - Example: `image-analysis-dev.auth.us-east-1.amazoncognito.com`
   - For custom domains, use your custom domain

3. Click **Save changes**

### Step 4: Configure App Client

1. Navigate to **App integration** → **App clients**
2. Select your app client: `image-analysis-{stage}-client`
3. Scroll to **Sign-in experience**
4. Ensure **Choice-based sign-in** is set to `ALLOW_USER_AUTH`
5. Under **Allowed first authentication factors**, ensure:
   - ✅ Passkey
   - ✅ Email OTP
6. Click **Save changes**

### Step 5: Verify Configuration

1. Go to **Sign-in experience** in the User Pool
2. Verify that:
   - Passkey is listed as an option
   - Email OTP is listed as an option
   - Passkey is marked as preferred

## Configuration Details

### User Pool Configuration

- **Username**: Email-based (email is both username and alias)
- **Case Sensitivity**: Disabled (email addresses are case-insensitive)
- **Email Verification**: Required
- **MFA**: Optional (required for passwordless authentication)
- **Password Policy**: Configured but not required for passwordless flows

### User Pool Client Configuration

- **Authentication Flows**:
  - `ALLOW_USER_SRP_AUTH`: Secure Remote Password protocol
  - `ALLOW_USER_PASSWORD_AUTH`: Direct username/password
  - `ALLOW_REFRESH_TOKEN_AUTH`: Token refresh
- **Token Validity**:
  - Access Token: 1 hour
  - ID Token: 1 hour
  - Refresh Token: 30 days
- **Token Revocation**: Enabled

### Security Considerations

1. **MFA Configuration**: Must be set to `OPTIONAL` or `OFF` for passwordless authentication (passkeys and email OTP)

2. **User Verification**: 
   - `PREFERRED`: More flexible, allows both verified and unverified passkeys
   - `REQUIRED`: More secure, only biometric/verified passkeys allowed

3. **Relying Party ID**: 
   - Must match your domain
   - For production, consider using a custom domain

4. **Email Configuration**:
   - Currently using Cognito's default email service
   - For production, configure Amazon SES for better deliverability

## Using Cognito in Your Application

### Environment Variables

The following environment variables are automatically set in your Lambda functions:

```bash
COGNITO_USER_POOL_ID=us-east-1_XXXXXXXXX
COGNITO_USER_POOL_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxx
COGNITO_USER_POOL_DOMAIN=image-analysis-dev
```

### Mobile App Integration

For React Native/Expo apps, use AWS Amplify:

```bash
npm install aws-amplify @aws-amplify/react-native
```

```javascript
import { Amplify } from 'aws-amplify';
import {
  CognitoUserPool,
  CognitoUserAttribute,
} from 'amazon-cognito-identity-js';

Amplify.configure({
  Auth: {
    Cognito: {
      userPoolId: 'YOUR_USER_POOL_ID',
      userPoolClientId: 'YOUR_CLIENT_ID',
      loginWith: {
        oauth: {
          domain: 'YOUR_USER_POOL_DOMAIN.auth.us-east-1.amazoncognito.com',
          scopes: ['email', 'openid', 'profile'],
          redirectSignIn: ['myapp://'],
          redirectSignOut: ['myapp://'],
          responseType: 'code',
        },
        username: 'email',
        email: true,
      },
    },
  },
});
```

### Authentication Flows

#### 1. Sign Up with Passkey

```javascript
import { signUp, confirmSignUp } from 'aws-amplify/auth';

// User signs up with email
const { userId } = await signUp({
  username: 'user@example.com',
  password: 'temporary-password', // Will be replaced by passkey
  options: {
    userAttributes: {
      email: 'user@example.com',
    },
  },
});

// After email verification, user can register a passkey
// This is typically done via AWS Amplify's built-in WebAuthn support
```

#### 2. Sign In with Passkey

```javascript
import { signIn } from 'aws-amplify/auth';

// User signs in with passkey (automatic if available)
await signIn({ username: 'user@example.com' });
```

#### 3. Sign In with Email OTP (Fallback)

```javascript
import { signIn, confirmSignIn } from 'aws-amplify/auth';

// Initiate email OTP flow
const { nextStep } = await signIn({
  username: 'user@example.com',
});

// User enters OTP code received via email
await confirmSignIn({
  challengeResponse: '123456', // OTP code
});
```

## Testing the Configuration

### Test User Registration

1. Go to **Users** in the Cognito Console
2. Click **Create user**
3. Enter email address
4. Choose "Send an email invitation" or "Send email with link"
5. User receives verification email

### Test Passkey Registration

After a user is created and verified:

1. User logs in with email/OTP
2. User is prompted to register a passkey
3. User completes WebAuthn challenge
4. Passkey is registered and becomes the preferred sign-in method

### Test Email OTP (Fallback)

1. User attempts to sign in
2. If no passkey is registered or passkey fails, user can choose "Sign in with email"
3. User receives OTP via email
4. User enters OTP to complete sign-in

## Troubleshooting

### Passkeys Not Appearing

1. **Check MFA Settings**: MFA must be `OPTIONAL` or `OFF`
   - Go to **Sign-in experience** → **Multi-factor authentication**
   - Verify it's set to Optional

2. **Check Choice-Based Sign-In**: 
   - Ensure Passkey is enabled in **Sign-in experience**
   - Ensure app client allows choice-based sign-in

3. **Check User Pool Domain**:
   - Domain must be created and active
   - Verify domain is accessible

### Email OTP Not Working

1. **Check Email Configuration**:
   - Verify email is a verified attribute
   - Check Cognito email limits (50 emails/day on default config)

2. **Check SES Configuration** (if using custom SES):
   - Verify SES is in production mode
   - Check email sending limits

### WebAuthn Errors

1. **Invalid Relying Party ID**:
   - Ensure Relying Party ID matches your domain
   - For custom domains, configure appropriately

2. **Browser Compatibility**:
   - Ensure browser supports WebAuthn
   - Use HTTPS (required for WebAuthn)

## Production Recommendations

1. **Custom Domain**: Set up a custom domain for the User Pool
   - Better user experience
   - Brand consistency
   - Required for some WebAuthn configurations

2. **Amazon SES**: Configure SES for email sending
   - Higher email limits
   - Better deliverability
   - Custom email templates

3. **Advanced Security Mode**: Consider enabling for production
   - Adaptive authentication
   - Risk-based authentication

4. **Rate Limiting**: Configure rate limiting for sign-in attempts
   - Prevent brute force attacks
   - Protect against abuse

5. **Monitoring**: Set up CloudWatch alarms
   - Monitor authentication failures
   - Track passkey registration rates

## Additional Resources

- [AWS Cognito Passkeys Documentation](https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-settings-passwordless.html)
- [WebAuthn Specification](https://www.w3.org/TR/webauthn-2/)
- [AWS Amplify Auth Documentation](https://docs.amplify.aws/react-native/build-a-backend/auth/)
- [Cognito User Pool CloudFormation Reference](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/AWS_Cognito_UserPool.html)

## Support

For issues or questions:
1. Check the troubleshooting section above
2. Review AWS Cognito CloudWatch logs
3. Consult AWS Cognito documentation
4. Check Serverless Framework deployment logs

