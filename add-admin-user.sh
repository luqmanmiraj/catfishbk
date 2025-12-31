#!/bin/bash

# Script to add a user to the admin group in Cognito
# Usage: ./add-admin-user.sh <email> [user-pool-id]

EMAIL="${1:-luqmanmiraj42@gmail.com}"
USER_POOL_ID="${2}"

if [ -z "$USER_POOL_ID" ]; then
  echo "Getting User Pool ID from serverless..."
  USER_POOL_ID=$(cd "$(dirname "$0")" && serverless info --verbose 2>/dev/null | grep -A 1 "CognitoUserPoolId" | tail -1 | awk '{print $2}' | tr -d '\n')
  
  if [ -z "$USER_POOL_ID" ]; then
    echo "❌ Could not find User Pool ID automatically."
    echo ""
    echo "Please provide it manually:"
    echo "  ./add-admin-user.sh $EMAIL <your-user-pool-id>"
    echo ""
    echo "Or find it in AWS Console:"
    echo "  AWS Console > Cognito > User Pools > Select your pool > Copy Pool ID"
    exit 1
  fi
fi

echo "Adding $EMAIL to admin group..."
echo "User Pool ID: $USER_POOL_ID"
echo ""

# Check if user exists
echo "Checking if user exists..."
USER_EXISTS=$(aws cognito-idp admin-get-user \
  --user-pool-id "$USER_POOL_ID" \
  --username "$EMAIL" 2>&1)

if [ $? -ne 0 ]; then
  echo "❌ User $EMAIL does not exist in the User Pool."
  echo ""
  echo "Please create the user first:"
  echo "  1. Go to AWS Console > Cognito > User Pools"
  echo "  2. Select your User Pool"
  echo "  3. Go to Users > Create user"
  echo "  4. Enter email: $EMAIL"
  echo "  5. Set a temporary password"
  echo "  6. Mark email as verified"
  echo ""
  echo "Or create user via CLI:"
  echo "  aws cognito-idp admin-create-user \\"
  echo "    --user-pool-id $USER_POOL_ID \\"
  echo "    --username $EMAIL \\"
  echo "    --user-attributes Name=email,Value=$EMAIL Name=email_verified,Value=true \\"
  echo "    --temporary-password 'TempPassword123!' \\"
  echo "    --message-action SUPPRESS"
  exit 1
fi

# Check if admin group exists
echo "Checking if admin group exists..."
GROUP_EXISTS=$(aws cognito-idp get-group \
  --user-pool-id "$USER_POOL_ID" \
  --group-name "admin" 2>&1)

if [ $? -ne 0 ]; then
  echo "❌ Admin group does not exist. Creating it..."
  aws cognito-idp create-group \
    --user-pool-id "$USER_POOL_ID" \
    --group-name "admin" \
    --description "Admin users for dashboard access" \
    --precedence 1
  
  if [ $? -eq 0 ]; then
    echo "✅ Admin group created successfully"
  else
    echo "❌ Failed to create admin group"
    exit 1
  fi
else
  echo "✅ Admin group exists"
fi

# Add user to admin group
echo ""
echo "Adding $EMAIL to admin group..."
aws cognito-idp admin-add-user-to-group \
  --user-pool-id "$USER_POOL_ID" \
  --username "$EMAIL" \
  --group-name "admin"

if [ $? -eq 0 ]; then
  echo ""
  echo "✅ Success! $EMAIL has been added to the admin group."
  echo ""
  echo "You can now:"
  echo "  1. Sign in to the admin dashboard at http://localhost:3000"
  echo "  2. Use email: $EMAIL"
  echo "  3. Use your Cognito password"
else
  echo ""
  echo "❌ Failed to add user to admin group"
  exit 1
fi

