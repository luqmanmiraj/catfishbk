# Quick Fix: Add Cognito Permissions

Your IAM user needs Cognito permissions to deploy the User Pool. The policy file already includes them, but they need to be added to your actual IAM user policy.

## Quick Steps (AWS Console)

1. **Go to IAM Console**: https://console.aws.amazon.com/iam/
2. **Click "Users"** in the left sidebar
3. **Click on your user**: `catfish`
4. **Click on the policy name** under "Permissions policies" (it might be called "CatfishDeploymentPolicy" or similar)
5. **Click "Edit policy"** → **JSON** tab
6. **Find the closing bracket** `]` before the last `}`
7. **Add this statement** before the closing bracket (make sure to add a comma after the previous statement):

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

8. **Click "Review policy"** → **Save changes**
9. **Wait 10-30 seconds** for permissions to propagate
10. **Try deploying again**: `cd lambda && serverless deploy`

## Alternative: Use the Complete Policy File

The `iam-policy.json` file already includes Cognito permissions. You can:

1. Go to IAM Console → Users → `catfish` → Permissions
2. Click on your policy → Edit policy → JSON tab
3. **Replace the entire JSON** with the contents of `iam-policy.json` from this directory
4. Save changes
5. Deploy again

## Verify Permissions

After updating, test with:

```bash
aws cognito-idp list-user-pools --max-results 1
```

If this works without errors, you're good to go!

## Need Help?

See the detailed guide: `COGNITO_IAM_SETUP.md`

