# Admin Dashboard Setup Guide

This guide explains how to set up the admin dashboard and create admin users.

## Prerequisites

- AWS CLI configured with appropriate permissions
- Access to AWS Cognito User Pool
- Admin Lambda function deployed

## Step 1: Create Admin User Group in Cognito

1. Go to AWS Console > Cognito > User Pools
2. Select your User Pool (e.g., `image-analysis-dev-user-pool`)
3. Navigate to **Groups** in the left sidebar
4. Click **Create group**
5. Enter:
   - **Group name**: `admin` (or match `ADMIN_GROUP_NAME` environment variable)
   - **Description**: Admin users for dashboard access
   - **Precedence**: `1` (lower number = higher priority)
6. Click **Create group**

## Step 2: Create Admin User

### Option A: Using AWS Console

1. In Cognito User Pool, go to **Users**
2. Click **Create user**
3. Enter:
   - **Email**: admin@yourdomain.com
   - **Temporary password**: (generate secure password)
   - **Mark email as verified**: Yes
4. Click **Create user**
5. After user is created, click on the user
6. Click **Add to group**
7. Select `admin` group
8. Click **Add to group**

### Option B: Using AWS CLI

```bash
# Create user
aws cognito-idp admin-create-user \
  --user-pool-id YOUR_USER_POOL_ID \
  --username admin@yourdomain.com \
  --user-attributes Name=email,Value=admin@yourdomain.com Name=email_verified,Value=true \
  --temporary-password "TempPassword123!" \
  --message-action SUPPRESS

# Add user to admin group
aws cognito-idp admin-add-user-to-group \
  --user-pool-id YOUR_USER_POOL_ID \
  --username admin@yourdomain.com \
  --group-name admin

# Set permanent password (user will need to change on first login)
aws cognito-idp admin-set-user-password \
  --user-pool-id YOUR_USER_POOL_ID \
  --username admin@yourdomain.com \
  --password "YourSecurePassword123!" \
  --permanent
```

## Step 3: Configure Environment Variables

Ensure the following environment variables are set in your Lambda function:

- `ADMIN_GROUP_NAME`: Name of the admin group (default: `admin`)
- `COGNITO_USER_POOL_ID`: Your Cognito User Pool ID
- `TOKENS_TABLE`: DynamoDB table for tokens
- `PURCHASES_TABLE`: DynamoDB table for purchases
- `SCAN_HISTORY_TABLE`: DynamoDB table for scan history

These should be automatically set via `serverless.yml` environment variables.

## Step 4: Test Admin Access

1. Sign in to the admin dashboard with your admin credentials
2. The dashboard should authenticate and verify admin status
3. You should have access to all admin endpoints

## Admin Endpoints

All admin endpoints require:
- Valid Cognito access token in `Authorization: Bearer <token>` header
- User must be in the admin group

### Available Endpoints:

- `POST /admin/auth/verify` - Verify admin token
- `GET /admin/users` - List all users
- `GET /admin/users/{userId}` - Get user details
- `PUT /admin/users/{userId}` - Update user
- `DELETE /admin/users/{userId}` - Delete user
- `GET /admin/users/{userId}/tokens` - Get user token balance
- `POST /admin/users/{userId}/tokens/add` - Add tokens to user
- `POST /admin/users/{userId}/tokens/set` - Set token balance
- `GET /admin/users/{userId}/scans` - Get user's scan history
- `GET /admin/users/{userId}/purchases` - Get user's purchases
- `GET /admin/analytics/dashboard` - Get dashboard statistics
- `GET /admin/scans` - List all scans
- `GET /admin/purchases` - List all purchases

## Security Notes

1. **Admin Group**: Only users in the admin group can access admin endpoints
2. **Token Validation**: All requests validate the Cognito token
3. **CORS**: Configured to allow requests from your Vercel domain
4. **Rate Limiting**: Consider adding rate limiting for production
5. **Audit Logging**: All admin actions are logged to CloudWatch

## Troubleshooting

### "User is not an admin" error
- Verify user is in the admin group
- Check `ADMIN_GROUP_NAME` environment variable matches group name
- Ensure Cognito IAM permissions allow `AdminListGroupsForUser`

### "Invalid or expired token" error
- Token may have expired (default: 1 hour)
- Refresh the token using Cognito refresh token flow
- Re-authenticate if refresh token is expired

### Cannot list users
- Check IAM permissions for `cognito-idp:AdminListUsers`
- Verify `COGNITO_USER_POOL_ID` is correct

## Multiple Admin Users

To add more admin users:

1. Create user in Cognito (follow Step 2)
2. Add user to `admin` group
3. User can now access admin dashboard

## Customer Support Access

Since customer support has the same access as admin, they should also be added to the `admin` group. Alternatively, you can:

1. Create a separate `support` group
2. Update `admin-handler.js` to check for both `admin` and `support` groups
3. Optionally restrict certain operations for support users

