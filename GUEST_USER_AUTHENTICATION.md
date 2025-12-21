# Guest User Authentication Guide

This document explains how guest user signup and sign-in works in the Catfish application. Guest users can access the app without providing email or password, using only their device ID.

## Table of Contents

- [Overview](#overview)
- [Quick Start](#quick-start)
- [How It Works](#how-it-works)
- [Guest Signup Flow](#guest-signup-flow)
- [Guest Sign-In Flow](#guest-sign-in-flow)
- [API Endpoints](#api-endpoints)
- [Mobile App Integration](#mobile-app-integration)
- [Technical Details](#technical-details)
- [Limitations and Considerations](#limitations-and-considerations)
- [Testing](#testing)

## Overview

Guest authentication allows users to quickly start using the app without creating a full account. The system:

- Creates a temporary Cognito user account automatically
- Uses device ID as the unique identifier
- Provides full authentication tokens (access token, ID token, refresh token)
- Works seamlessly with existing authentication infrastructure
- Allows conversion to full account later (if needed)

### Key Features

- **No Email Required**: Guest users don't need to provide an email address
- **No Verification**: Email verification is bypassed for guest accounts
- **Device-Based**: Each device gets its own unique guest account
- **Persistent**: Guest accounts persist across app sessions
- **Full Access**: Guest users have the same API access as regular users

## Quick Start

### For Mobile App Developers

**Simplest Implementation:**
```javascript
import { useAuth } from '../context/AuthContext';

function MyComponent() {
  const { guestSignUp, isAuthenticated } = useAuth();

  const handleContinueAsGuest = async () => {
    const result = await guestSignUp();
    if (result.success) {
      // User is now authenticated!
    }
  };

  return (
    <Button onPress={handleContinueAsGuest} title="Continue as Guest" />
  );
}
```

**That's it!** The `guestSignUp()` function:
- ✅ Automatically gets device ID
- ✅ Creates account if new, signs in if existing
- ✅ Stores tokens automatically
- ✅ Sets user as authenticated

### Key Points

- **One Function for Everything**: `guestSignUp()` handles both signup and sign-in
- **No Parameters Needed**: Device ID is automatically retrieved
- **Automatic Token Management**: Tokens are stored and refreshed automatically
- **Works Offline**: Uses cached device ID if available

## How It Works

### Architecture

```
Mobile App (Device ID)
    ↓
POST /auth/guest-signup { deviceId: "..." }
    ↓
Lambda Handler (auth-handler.js)
    ↓
Cognito AdminCreateUser
    ↓
Auto-verify email & set attributes
    ↓
Auto-sign-in with generated password
    ↓
Return tokens to mobile app
```

### Guest User Identification

Guest users are identified by:
- **Email Pattern**: `guest-{deviceId}@temp.catfish.app`
- **Custom Attributes**: 
  - `custom:device_id`: The device identifier
  - `custom:is_guest`: Set to `"true"` for guest accounts

## Guest Signup Flow

### Step 1: Device ID Retrieval

The mobile app retrieves the device ID using Expo's device identification:

```javascript
import { getDeviceId } from '../utils/deviceLogger';

const deviceId = await getDeviceId();
// Returns: Android ID (Android) or Installation ID (iOS)
```

### Step 2: Guest Signup Request

The app sends a POST request to `/auth/guest-signup`:

```javascript
POST /auth/guest-signup
Content-Type: application/json

{
  "deviceId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
}
```

### Step 3: Backend Processing

1. **Check Existing User**: The backend checks if a guest user already exists for this device ID
2. **Create User (if new)**:
   - Generate email: `guest-{sanitized-deviceId}@temp.catfish.app`
   - Generate secure random password (16 characters)
   - Create Cognito user with:
     - Email auto-verified
     - Custom attributes set (device_id, is_guest)
     - Temporary password set
3. **Sign In**: Automatically sign in the guest user
4. **Return Tokens**: Provide access token, ID token, and refresh token

### Step 4: Response

```json
{
  "success": true,
  "userSub": "uuid-here",
  "accessToken": "eyJraWQiOi...",
  "idToken": "eyJraWQiOi...",
  "refreshToken": "eyJjdHkiOi...",
  "expiresIn": 3600,
  "tokenType": "Bearer",
  "isGuest": true,
  "deviceId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "message": "Guest account created successfully."
}
```

## Guest Sign-In Flow

### Automatic Sign-In on Reuse

**Important**: There is no separate sign-in function for guests. The `guestSignUp()` function automatically handles both scenarios:

#### Scenario 1: New Guest User (First Time)
1. Device ID provided
2. No existing user found
3. Creates new guest account
4. Auto-signs in
5. Returns tokens

#### Scenario 2: Existing Guest User (Returning)
1. Device ID provided
2. Existing user found (by email pattern)
3. Resets password if needed
4. Auto-signs in
5. Returns tokens

### Flow Diagram

```
┌─────────────────────┐
│  guestSignUp()      │
│  (deviceId)         │
└──────────┬──────────┘
           │
           ▼
    ┌──────────────┐
    │ Get Device ID│ (if not provided)
    └──────┬───────┘
           │
           ▼
    ┌─────────────────────┐
    │ Check if user       │
    │ exists for device   │
    └──────┬──────────────┘
           │
      ┌────┴────┐
      │         │
    YES        NO
      │         │
      ▼         ▼
  ┌────────┐  ┌──────────────┐
  │Sign In │  │ Create User  │
  │        │  │              │
  └───┬────┘  └──────┬───────┘
      │              │
      └──────┬───────┘
             │
             ▼
      ┌──────────────┐
      │ Return Tokens│
      └──────────────┘
```

### When to Call guestSignUp()

Call `guestSignUp()` in these scenarios:

1. **First Time User**: User taps "Continue as Guest" → Creates new account
2. **Returning Guest**: User opens app again → Automatically signs in existing account
3. **After Sign Out**: User signs out but wants to continue as guest → Re-authenticates
4. **Token Expired**: Refresh token expired → Call `guestSignUp()` to get new tokens

**You never need to check if user exists first** - `guestSignUp()` handles everything automatically!

## API Endpoints

### POST /auth/guest-signup

Creates or retrieves a guest user account.

**Request Body:**
```json
{
  "deviceId": "string (required)"
}
```

**Response (Success - 200):**
```json
{
  "success": true,
  "userSub": "string",
  "accessToken": "string",
  "idToken": "string",
  "refreshToken": "string",
  "expiresIn": 3600,
  "tokenType": "Bearer",
  "isGuest": true,
  "deviceId": "string",
  "message": "Guest account created successfully."
}
```

**Response (Error - 400):**
```json
{
  "success": false,
  "error": "Device ID is required for guest signup"
}
```

**Response (Error - 500):**
```json
{
  "success": false,
  "error": "Error message here"
}
```

## Mobile App Integration

### Using AuthContext

The easiest way to use guest signup is through the `AuthContext`:

```javascript
import React from 'react';
import { View, Button, Text } from 'react-native';
import { useAuth } from '../context/AuthContext';

function GuestSignupScreen() {
  const { guestSignUp, isAuthenticated, user, isLoading } = useAuth();

  const handleGuestSignup = async () => {
    try {
      // Device ID is automatically retrieved
      const result = await guestSignUp();
      
      if (result.success) {
        console.log('Guest signup successful!');
        console.log('Is Guest:', result.isGuest);
        // User is now authenticated
      } else {
        console.error('Guest signup failed:', result.error);
      }
    } catch (error) {
      console.error('Error:', error);
    }
  };

  if (isLoading) {
    return <Text>Loading...</Text>;
  }

  return (
    <View>
      {!isAuthenticated ? (
        <Button 
          title="Continue as Guest" 
          onPress={handleGuestSignup} 
        />
      ) : (
        <Text>Welcome! {user?.email || 'Guest User'}</Text>
      )}
    </View>
  );
}
```

### Using API Directly

If you need more control, use the API directly:

```javascript
import { guestSignUp } from '../services/authApi';
import { getDeviceId } from '../utils/deviceLogger';
import * as authStorage from '../services/authStorage';

async function signUpAsGuest() {
  try {
    // Get device ID
    const deviceId = await getDeviceId();
    
    // Call guest signup API
    const result = await guestSignUp(deviceId);
    
    if (result.success) {
      // Store tokens
      await authStorage.storeAuthData({
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        idToken: result.idToken,
      });
      
      console.log('Guest authenticated!');
      return result;
    }
  } catch (error) {
    console.error('Guest signup error:', error);
    throw error;
  }
}
```

### Checking if User is Guest

After authentication, check if the user is a guest:

```javascript
import { useAuth } from '../context/AuthContext';

function ProfileScreen() {
  const { user } = useAuth();
  
  const isGuest = user?.email?.includes('@temp.catfish.app') || 
                  user?.['custom:is_guest'] === 'true';
  
  return (
    <View>
      {isGuest ? (
        <Text>Guest Account</Text>
      ) : (
        <Text>Registered Account</Text>
      )}
    </View>
  );
}
```

## Technical Details

### Device ID Sources

The app tries multiple methods to get a device ID (in order of preference):

1. **Android**: `Application.getAndroidId()` - Persistent across app reinstalls
2. **All Platforms**: `Application.getInstallationIdAsync()` - Persists across app updates
3. **Fallback**: Generated ID based on platform and timestamp

### Guest Email Format

```
guest-{sanitized-deviceId}@temp.catfish.app
```

- Device ID is sanitized (non-alphanumeric characters replaced with hyphens)
- Domain is `temp.catfish.app` (prevents conflicts with real emails)
- Example: `guest-a1b2c3d4-e5f6-7890-abcd-ef1234567890@temp.catfish.app`

### Password Generation

Guest passwords are automatically generated:
- Length: 16 characters
- Contains: uppercase, lowercase, numbers, and special characters
- Complies with Cognito password requirements
- User never needs to know or enter this password

### Custom Attributes

Two custom attributes are set (if available in User Pool schema):

- `custom:device_id`: Stores the original device ID
- `custom:is_guest`: Set to `"true"` for identification

**Note**: Custom attributes must be defined in the Cognito User Pool schema. If they're not available, the guest signup will still work, but these attributes won't be set.

### Token Management

Guest users receive the same tokens as regular users:
- **Access Token**: Used for API authentication (1 hour validity)
- **ID Token**: Contains user identity information (1 hour validity)
- **Refresh Token**: Used to refresh expired tokens (30 days validity)

Tokens are automatically stored in AsyncStorage and refreshed when needed.

### Error Handling

The system handles various error scenarios:

1. **Missing Custom Attributes**: Falls back to creating user without custom attributes
2. **Existing User**: Automatically signs in instead of creating duplicate
3. **Password Reset**: Handles NEW_PASSWORD_REQUIRED challenges automatically
4. **Network Errors**: Proper error messages returned to client

## Limitations and Considerations

### Limitations

1. **One Guest Account Per Device**: Each device can only have one guest account
2. **No Email Access**: Guest users cannot receive emails (using temp domain)
3. **Account Recovery**: Guest accounts cannot be recovered if device is lost
4. **Custom Attributes**: May not be available in existing User Pools (requires manual addition)

### Best Practices

1. **Offer Upgrade Path**: Consider allowing guests to convert to full accounts
2. **Data Persistence**: Guest data persists, but tied to device
3. **Session Management**: Use refresh tokens to maintain sessions
4. **Privacy**: Guest users are still trackable via device ID

### Converting Guest to Full Account

To convert a guest account to a regular account:

1. User provides email and password
2. Use Cognito `adminUpdateUserAttributes` to update email
3. User verifies new email
4. Remove guest attributes
5. User can now use email/password sign-in

(Implementation of this feature is optional and not included by default)

## Testing

### Test Guest Signup

```bash
# Using curl
curl -X POST https://YOUR_API.execute-api.us-east-1.amazonaws.com/dev/auth/guest-signup \
  -H "Content-Type: application/json" \
  -d '{
    "deviceId": "test-device-12345"
  }'
```

### Expected Response

```json
{
  "success": true,
  "userSub": "abc123...",
  "accessToken": "eyJraWQiOi...",
  "idToken": "eyJraWQiOi...",
  "refreshToken": "eyJjdHkiOi...",
  "expiresIn": 3600,
  "tokenType": "Bearer",
  "isGuest": true,
  "deviceId": "test-device-12345",
  "message": "Guest account created successfully."
}
```

### Test Subsequent Signup (Same Device)

Call the same endpoint again with the same device ID:

```bash
curl -X POST https://YOUR_API.execute-api.us-east-1.amazonaws.com/dev/auth/guest-signup \
  -H "Content-Type: application/json" \
  -d '{
    "deviceId": "test-device-12345"
  }'
```

Should return tokens for the existing user (not create a duplicate).

### Test Token Usage

Use the returned access token to make authenticated requests:

```bash
curl -X GET https://YOUR_API.execute-api.us-east-1.amazonaws.com/dev/auth/user \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

### Test in Mobile App

```javascript
import { useAuth } from '../context/AuthContext';

// In your component
const { guestSignUp } = useAuth();

// Test guest signup
const testGuestSignup = async () => {
  const result = await guestSignUp();
  console.log('Result:', result);
};
```

## Troubleshooting

### Issue: "Custom attributes not available"

**Solution**: Custom attributes need to be added to the Cognito User Pool schema. The guest signup will still work without them, but guest identification won't use custom attributes.

To add custom attributes:
1. Go to AWS Console > Cognito > User Pools
2. Select your User Pool
3. Go to "Sign-up experience" > "Attributes"
4. Add custom attributes: `device_id` and `is_guest`

### Issue: "UsernameExistsException"

**Solution**: This is handled automatically - the system will sign in the existing guest user instead of creating a duplicate.

### Issue: Token Expiration

**Solution**: Use the refresh token to get new tokens. The `AuthContext` handles this automatically.

```javascript
const { refreshAccessToken } = useAuth();
await refreshAccessToken();
```

### Issue: Device ID Changes

**Solution**: Device ID should be persistent. If it changes, the user will get a new guest account. Consider storing device ID in AsyncStorage as backup.

## Related Documentation

- [AUTH_MOBILE_INTEGRATION.md](./AUTH_MOBILE_INTEGRATION.md) - Regular authentication guide
- [DEVICE_TRACKING.md](./DEVICE_TRACKING.md) - Device ID tracking details
- [MOBILE_DEVICE_ID_EXAMPLE.md](./MOBILE_DEVICE_ID_EXAMPLE.md) - Device ID examples
- [COGNITO_SETUP.md](./COGNITO_SETUP.md) - Cognito User Pool setup

## Summary

Guest authentication provides a seamless way for users to start using the app immediately:

1. ✅ No email or password required
2. ✅ Automatic account creation
3. ✅ Full API access
4. ✅ Persistent across sessions
5. ✅ Same token-based authentication as regular users

Use `guestSignUp()` from `AuthContext` to implement guest authentication in your app.
