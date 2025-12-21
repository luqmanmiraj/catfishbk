# Mobile App Authentication Integration Guide

This guide explains how to integrate the sign-in and sign-up API with your Expo React Native mobile application.

## Overview

The authentication system includes:
- **Sign Up** - Create new user accounts
- **Email Verification** - Verify email addresses with 6-digit codes
- **Sign In** - Authenticate existing users
- **Token Management** - Automatic token storage and refresh
- **User Profile** - Access user information

## Prerequisites

1. Deploy the Lambda functions (see main README.md)
2. Get your API Gateway endpoint URL
3. Install required dependencies

## Step 1: Install Dependencies

Navigate to your mobile app directory and install AsyncStorage:

```bash
cd catfish
npm install @react-native-async-storage/async-storage
```

For Expo projects, you may need to run:

```bash
npx expo install @react-native-async-storage/async-storage
```

## Step 2: Configure API Endpoint

Update the API base URL in `catfish/services/authApi.js`:

```javascript
// Replace with your actual Lambda API Gateway endpoint
const API_BASE_URL = __DEV__
  ? 'https://YOUR_API_ID.execute-api.us-east-1.amazonaws.com/dev'
  : 'https://YOUR_API_ID.execute-api.us-east-1.amazonaws.com/prod';
```

To get your API endpoint URL:

1. After deploying, run:
   ```bash
   cd lambda
   serverless info --verbose
   ```

2. Look for the API Gateway endpoints in the output
3. Copy the base URL (without the `/auth/` path)

## Step 3: Project Structure

The authentication system has been integrated with the following structure:

```
catfish/
├── context/
│   └── AuthContext.js          # Authentication context provider
├── services/
│   ├── authApi.js              # API service for auth endpoints
│   └── authStorage.js          # Secure token storage
├── screens/
│   ├── SignInScreen.js         # Sign in screen
│   ├── SignUpScreen.js         # Sign up screen
│   └── VerificationScreen.js   # Email verification screen
└── App.js                      # Updated with AuthProvider
```

## Step 4: Using Authentication in Your App

### Accessing Authentication State

Use the `useAuth` hook in any component:

```javascript
import { useAuth } from '../context/AuthContext';

function MyComponent() {
  const { user, isAuthenticated, signIn, signOut } = useAuth();
  
  if (isAuthenticated) {
    return <Text>Welcome, {user?.email}!</Text>;
  }
  
  return <Text>Please sign in</Text>;
}
```

### Available Auth Methods

The `useAuth` hook provides:

- `user` - Current user object with attributes (email, name, etc.)
- `isAuthenticated` - Boolean indicating if user is signed in
- `isLoading` - Boolean indicating if auth status is being checked
- `accessToken` - Current access token (for API calls)
- `signUp(email, password, name?)` - Sign up a new user
- `confirmSignUp(email, code)` - Verify email with code
- `resendConfirmationCode(email)` - Resend verification code
- `signIn(email, password)` - Sign in user
- `signOut()` - Sign out current user
- `forgotPassword(email)` - Request password reset
- `confirmForgotPassword(email, code, newPassword)` - Reset password
- `refreshAccessToken()` - Manually refresh access token

## Step 5: Authentication Flow

### Sign Up Flow

1. User taps "Sign Up" on PermissionsScreen
2. SignUpScreen appears
3. User enters email, password, and optional name
4. On success, VerificationScreen appears
5. User enters 6-digit code from email
6. On verification, user is redirected to SignInScreen
7. User can now sign in

### Sign In Flow

1. User taps "Sign In" on PermissionsScreen
2. SignInScreen appears
3. User enters email and password
4. On success, tokens are stored and user is authenticated
5. App navigates to main content (ScanScreen)

### Token Management

Tokens are automatically:
- Stored securely when user signs in
- Refreshed when they expire
- Cleared when user signs out
- Validated on app startup

## Step 6: Making Authenticated API Calls

When making API calls that require authentication, include the access token:

```javascript
import { useAuth } from '../context/AuthContext';
import * as authStorage from '../services/authStorage';

async function makeAuthenticatedRequest() {
  const token = await authStorage.getAccessToken();
  
  const response = await fetch('YOUR_API_ENDPOINT', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ /* your data */ }),
  });
  
  return response.json();
}
```

Or use the token from the auth context:

```javascript
const { accessToken } = useAuth();

const response = await fetch('YOUR_API_ENDPOINT', {
  headers: {
    'Authorization': `Bearer ${accessToken}`,
  },
});
```

## Step 7: Protected Routes

You can protect routes by checking authentication status:

```javascript
function ProtectedScreen() {
  const { isAuthenticated, isLoading } = useAuth();
  
  if (isLoading) {
    return <ActivityIndicator />;
  }
  
  if (!isAuthenticated) {
    // Redirect to sign in
    return <SignInScreen />;
  }
  
  return <YourProtectedContent />;
}
```

## Step 8: User Profile

The ProfileScreen automatically displays user information:

- Shows user's name or email
- Displays account type
- Shows authentication status

The user information is available via:

```javascript
const { user } = useAuth();
// user.email
// user.name
// etc.
```

## API Endpoints Reference

All endpoints are prefixed with `/auth/`:

- `POST /auth/signup` - Register new user
- `POST /auth/confirm-signup` - Verify email
- `POST /auth/resend-confirmation` - Resend verification code
- `POST /auth/signin` - Sign in user
- `POST /auth/refresh-token` - Refresh access token
- `POST /auth/forgot-password` - Request password reset
- `POST /auth/confirm-forgot-password` - Reset password
- `GET /auth/user` - Get user info (requires Bearer token)

## Error Handling

All authentication methods return a result object:

```javascript
const result = await signIn(email, password);

if (result.success) {
  // Success - user is now authenticated
  console.log('Signed in successfully');
} else {
  // Error occurred
  Alert.alert('Error', result.error);
}
```

Common error messages:
- "Email and password are required"
- "Incorrect email or password"
- "Please verify your email address before signing in"
- "Invalid verification code"
- "Password does not meet requirements"

## Password Requirements

Passwords must meet these requirements:
- At least 8 characters long
- Contains at least one uppercase letter
- Contains at least one lowercase letter
- Contains at least one number

## Testing

1. **Test Sign Up:**
   - Enter a valid email
   - Create a password meeting requirements
   - Check email for verification code
   - Enter code to verify

2. **Test Sign In:**
   - Use the email and password from sign up
   - Should successfully authenticate

3. **Test Token Refresh:**
   - Sign in
   - Wait for token to expire (or manually trigger refresh)
   - Token should automatically refresh

4. **Test Sign Out:**
   - Sign in
   - Go to Profile screen
   - Tap "Log Out"
   - Should return to permissions screen

## Troubleshooting

### "Cognito configuration missing" Error

- Check that `COGNITO_USER_POOL_ID` and `COGNITO_USER_POOL_CLIENT_ID` are set in Lambda environment variables
- Verify the serverless.yml deployment was successful

### "Network request failed" Error

- Check that API_BASE_URL is correctly set in `authApi.js`
- Verify the API Gateway endpoint is accessible
- Check CORS configuration in serverless.yml

### Tokens Not Persisting

- Ensure AsyncStorage is properly installed
- Check that the app has storage permissions
- Verify tokens are being stored (check AsyncStorage keys)

### Verification Code Not Received

- Check spam folder
- Verify email address is correct
- Use "Resend Code" button
- Check Cognito email configuration

## Security Considerations

1. **Token Storage:** Tokens are stored in AsyncStorage. For production, consider using Expo SecureStore for additional security.

2. **API Keys:** Never commit API keys or tokens to version control.

3. **HTTPS:** Always use HTTPS endpoints in production.

4. **Token Expiration:** Tokens automatically refresh, but implement proper error handling for refresh failures.

## Next Steps

1. Customize the UI to match your app's design
2. Add password strength indicator
3. Implement "Remember Me" functionality
4. Add biometric authentication (Face ID / Touch ID)
5. Implement social login (Google, Apple, etc.)

## Support

For issues or questions:
1. Check the Lambda logs in CloudWatch
2. Verify API Gateway configuration
3. Test endpoints using curl or Postman
4. Review Cognito User Pool settings in AWS Console

