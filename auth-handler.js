// Load environment variables from .env file
require('dotenv').config();

const AWS = require('aws-sdk');

// Configure AWS SDK
const awsConfig = {
  region: process.env.AWS_REGION || 'us-east-1',
};

// Only set credentials if provided AND we're running locally (not in Lambda)
const isLambda = !!process.env.AWS_LAMBDA_FUNCTION_NAME;
if (!isLambda && process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
  awsConfig.accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  awsConfig.secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
}

AWS.config.update(awsConfig);

const cognitoIdentityServiceProvider = new AWS.CognitoIdentityServiceProvider();

// Get Cognito configuration from environment variables
const USER_POOL_ID = process.env.COGNITO_USER_POOL_ID;
const CLIENT_ID = process.env.COGNITO_USER_POOL_CLIENT_ID;

/**
 * CORS headers
 */
function getCorsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Allow-Methods': 'POST,OPTIONS,GET',
    'Content-Type': 'application/json',
  };
}

/**
 * Handle preflight OPTIONS request
 */
function handleOptions() {
  return {
    statusCode: 200,
    headers: getCorsHeaders(),
    body: '',
  };
}

/**
 * Sign up a new user
 */
async function signUp(email, password, name = null) {
  if (!USER_POOL_ID || !CLIENT_ID) {
    throw new Error('Cognito configuration missing. USER_POOL_ID and CLIENT_ID must be set.');
  }

  const params = {
    ClientId: CLIENT_ID,
    Username: email,
    Password: password,
    UserAttributes: [
      {
        Name: 'email',
        Value: email,
      },
    ],
  };

  // Add name attribute if provided
  if (name) {
    params.UserAttributes.push({
      Name: 'name',
      Value: name,
    });
  }

  try {
    const result = await cognitoIdentityServiceProvider.signUp(params).promise();
    return {
      success: true,
      userSub: result.UserSub,
      codeDeliveryDetails: result.CodeDeliveryDetails,
      message: 'User registered successfully. Please check your email for verification code.',
    };
  } catch (error) {
    if (error.code === 'UsernameExistsException') {
      throw new Error('An account with this email already exists.');
    } else if (error.code === 'InvalidPasswordException') {
      throw new Error('Password does not meet requirements. Must be at least 8 characters with uppercase, lowercase, and numbers.');
    } else if (error.code === 'InvalidParameterException') {
      throw new Error(`Invalid input: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Confirm sign up with verification code
 */
async function confirmSignUp(email, confirmationCode) {
  if (!USER_POOL_ID || !CLIENT_ID) {
    throw new Error('Cognito configuration missing. USER_POOL_ID and CLIENT_ID must be set.');
  }

  const params = {
    ClientId: CLIENT_ID,
    Username: email,
    ConfirmationCode: confirmationCode,
  };

  try {
    await cognitoIdentityServiceProvider.confirmSignUp(params).promise();
    return {
      success: true,
      message: 'Email verified successfully. You can now sign in.',
    };
  } catch (error) {
    if (error.code === 'CodeMismatchException') {
      throw new Error('Invalid verification code. Please check your email and try again.');
    } else if (error.code === 'ExpiredCodeException') {
      throw new Error('Verification code has expired. Please request a new code.');
    } else if (error.code === 'NotAuthorizedException') {
      throw new Error('User is already confirmed or does not exist.');
    }
    throw error;
  }
}

/**
 * Resend confirmation code
 */
async function resendConfirmationCode(email) {
  if (!USER_POOL_ID || !CLIENT_ID) {
    throw new Error('Cognito configuration missing. USER_POOL_ID and CLIENT_ID must be set.');
  }

  const params = {
    ClientId: CLIENT_ID,
    Username: email,
  };

  try {
    const result = await cognitoIdentityServiceProvider.resendConfirmationCode(params).promise();
    return {
      success: true,
      codeDeliveryDetails: result.CodeDeliveryDetails,
      message: 'Verification code sent to your email.',
    };
  } catch (error) {
    if (error.code === 'UserNotFoundException') {
      throw new Error('User not found. Please sign up first.');
    } else if (error.code === 'InvalidParameterException') {
      throw new Error('Invalid email address.');
    } else if (error.code === 'LimitExceededException') {
      throw new Error('Too many attempts. Please wait before requesting a new code.');
    }
    throw error;
  }
}

/**
 * Sign in user
 */
async function signIn(email, password) {
  if (!USER_POOL_ID || !CLIENT_ID) {
    throw new Error('Cognito configuration missing. USER_POOL_ID and CLIENT_ID must be set.');
  }

  const params = {
    AuthFlow: 'USER_PASSWORD_AUTH',
    ClientId: CLIENT_ID,
    AuthParameters: {
      USERNAME: email,
      PASSWORD: password,
    },
  };

  try {
    const result = await cognitoIdentityServiceProvider.initiateAuth(params).promise();
    
    if (result.ChallengeName) {
      // Handle challenges (e.g., NEW_PASSWORD_REQUIRED, MFA)
      return {
        success: false,
        challengeName: result.ChallengeName,
        challengeParameters: result.ChallengeParameters,
        session: result.Session,
        message: 'Additional authentication required.',
      };
    }

    return {
      success: true,
      accessToken: result.AuthenticationResult.AccessToken,
      idToken: result.AuthenticationResult.IdToken,
      refreshToken: result.AuthenticationResult.RefreshToken,
      expiresIn: result.AuthenticationResult.ExpiresIn,
      tokenType: result.AuthenticationResult.TokenType,
      message: 'Sign in successful.',
    };
  } catch (error) {
    if (error.code === 'NotAuthorizedException') {
      throw new Error('Incorrect email or password.');
    } else if (error.code === 'UserNotConfirmedException') {
      throw new Error('Please verify your email address before signing in.');
    } else if (error.code === 'UserNotFoundException') {
      throw new Error('User not found. Please sign up first.');
    } else if (error.code === 'TooManyRequestsException') {
      throw new Error('Too many sign-in attempts. Please try again later.');
    }
    throw error;
  }
}

/**
 * Refresh access token
 */
async function refreshToken(refreshToken) {
  if (!USER_POOL_ID || !CLIENT_ID) {
    throw new Error('Cognito configuration missing. USER_POOL_ID and CLIENT_ID must be set.');
  }

  const params = {
    AuthFlow: 'REFRESH_TOKEN_AUTH',
    ClientId: CLIENT_ID,
    AuthParameters: {
      REFRESH_TOKEN: refreshToken,
    },
  };

  try {
    const result = await cognitoIdentityServiceProvider.initiateAuth(params).promise();
    return {
      success: true,
      accessToken: result.AuthenticationResult.AccessToken,
      idToken: result.AuthenticationResult.IdToken,
      expiresIn: result.AuthenticationResult.ExpiresIn,
      tokenType: result.AuthenticationResult.TokenType,
    };
  } catch (error) {
    if (error.code === 'NotAuthorizedException') {
      throw new Error('Invalid or expired refresh token.');
    }
    throw error;
  }
}

/**
 * Forgot password - initiate password reset
 */
async function forgotPassword(email) {
  if (!USER_POOL_ID || !CLIENT_ID) {
    throw new Error('Cognito configuration missing. USER_POOL_ID and CLIENT_ID must be set.');
  }

  const params = {
    ClientId: CLIENT_ID,
    Username: email,
  };

  try {
    const result = await cognitoIdentityServiceProvider.forgotPassword(params).promise();
    return {
      success: true,
      codeDeliveryDetails: result.CodeDeliveryDetails,
      message: 'Password reset code sent to your email.',
    };
  } catch (error) {
    if (error.code === 'UserNotFoundException') {
      throw new Error('User not found.');
    } else if (error.code === 'LimitExceededException') {
      throw new Error('Too many attempts. Please wait before requesting a new code.');
    }
    throw error;
  }
}

/**
 * Confirm forgot password - reset password with code
 */
async function confirmForgotPassword(email, confirmationCode, newPassword) {
  if (!USER_POOL_ID || !CLIENT_ID) {
    throw new Error('Cognito configuration missing. USER_POOL_ID and CLIENT_ID must be set.');
  }

  const params = {
    ClientId: CLIENT_ID,
    Username: email,
    ConfirmationCode: confirmationCode,
    Password: newPassword,
  };

  try {
    await cognitoIdentityServiceProvider.confirmForgotPassword(params).promise();
    return {
      success: true,
      message: 'Password reset successful. You can now sign in with your new password.',
    };
  } catch (error) {
    if (error.code === 'CodeMismatchException') {
      throw new Error('Invalid verification code.');
    } else if (error.code === 'ExpiredCodeException') {
      throw new Error('Verification code has expired. Please request a new code.');
    } else if (error.code === 'InvalidPasswordException') {
      throw new Error('Password does not meet requirements. Must be at least 8 characters with uppercase, lowercase, and numbers.');
    }
    throw error;
  }
}

/**
 * Get user information from access token
 */
async function getUserInfo(accessToken) {
  try {
    const result = await cognitoIdentityServiceProvider.getUser({
      AccessToken: accessToken,
    }).promise();
    
    const userAttributes = {};
    result.UserAttributes.forEach(attr => {
      userAttributes[attr.Name] = attr.Value;
    });

    return {
      success: true,
      username: result.Username,
      userAttributes: userAttributes,
      userStatus: result.UserStatus,
    };
  } catch (error) {
    if (error.code === 'NotAuthorizedException') {
      throw new Error('Invalid or expired access token.');
    }
    throw error;
  }
}

/**
 * Generate a secure random password
 */
function generateRandomPassword() {
  const length = 16;
  const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*';
  let password = '';
  // Ensure at least one of each required character type
  password += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[Math.floor(Math.random() * 26)]; // uppercase
  password += 'abcdefghijklmnopqrstuvwxyz'[Math.floor(Math.random() * 26)]; // lowercase
  password += '0123456789'[Math.floor(Math.random() * 10)]; // number
  // Fill the rest randomly
  for (let i = password.length; i < length; i++) {
    password += charset[Math.floor(Math.random() * charset.length)];
  }
  // Shuffle the password
  return password.split('').sort(() => Math.random() - 0.5).join('');
}

/**
 * Guest sign up - creates a temporary user account with device ID
 */
async function guestSignUp(deviceId) {
  if (!USER_POOL_ID || !CLIENT_ID) {
    throw new Error('Cognito configuration missing. USER_POOL_ID and CLIENT_ID must be set.');
  }

  if (!deviceId) {
    throw new Error('Device ID is required for guest signup.');
  }

  // Generate a unique email for the guest user based on device ID
  // Use a format that won't conflict with real emails
  const guestEmail = `guest-${deviceId.replace(/[^a-zA-Z0-9]/g, '-')}@temp.catfish.app`;
  
  // Generate a secure random password
  const tempPassword = generateRandomPassword();

  try {
    // Check if guest user already exists for this device ID
    let existingUser = null;
    try {
      const listResult = await cognitoIdentityServiceProvider.listUsers({
        UserPoolId: USER_POOL_ID,
        Filter: `email = "${guestEmail}"`,
        Limit: 1,
      }).promise();
      
      if (listResult.Users && listResult.Users.length > 0) {
        existingUser = listResult.Users[0];
      }
    } catch (listError) {
      // If listUsers fails, continue to create new user
      console.log('Could not check for existing user:', listError.message);
    }

    let userSub;
    let username;

    if (existingUser) {
      // User already exists, use existing user
      userSub = existingUser.Username;
      username = existingUser.Username;
      
      // Try to sign in with existing user
      try {
        // First, try to set a new temporary password (in case old one expired)
        await cognitoIdentityServiceProvider.adminSetUserPassword({
          UserPoolId: USER_POOL_ID,
          Username: username,
          Password: tempPassword,
          Permanent: false, // Temporary password
        }).promise();
      } catch (passwordError) {
        // If setting password fails, try to sign in anyway
        console.log('Could not set password, trying sign in:', passwordError.message);
      }
    } else {
      // Create new guest user using AdminCreateUser (bypasses email verification)
      const userAttributes = [
        {
          Name: 'email',
          Value: guestEmail,
        },
        {
          Name: 'email_verified',
          Value: 'true', // Auto-verify for guests
        },
      ];

      // Try to add custom attributes (may fail if not defined in User Pool schema)
      // These are optional and won't break guest signup if they don't exist
      userAttributes.push({
        Name: 'custom:device_id',
        Value: deviceId,
      });
      userAttributes.push({
        Name: 'custom:is_guest',
        Value: 'true',
      });

      const createParams = {
        UserPoolId: USER_POOL_ID,
        Username: guestEmail,
        UserAttributes: userAttributes,
        TemporaryPassword: tempPassword,
        MessageAction: 'SUPPRESS', // Don't send welcome email
      };

      let createResult;
      try {
        createResult = await cognitoIdentityServiceProvider.adminCreateUser(createParams).promise();
      } catch (createError) {
        // If custom attributes cause an error, try without them
        if (createError.code === 'InvalidParameterException' && 
            (createError.message.includes('custom:') || createError.message.includes('attribute'))) {
          console.log('Custom attributes not available, creating user without them');
          const fallbackParams = {
            UserPoolId: USER_POOL_ID,
            Username: guestEmail,
            UserAttributes: [
              {
                Name: 'email',
                Value: guestEmail,
              },
              {
                Name: 'email_verified',
                Value: 'true',
              },
            ],
            TemporaryPassword: tempPassword,
            MessageAction: 'SUPPRESS',
          };
          createResult = await cognitoIdentityServiceProvider.adminCreateUser(fallbackParams).promise();
        } else {
          throw createError;
        }
      }
      userSub = createResult.User.Username;
      username = createResult.User.Username;
    }

    // Sign in the guest user
    try {
      // First attempt: try with temporary password
      const authParams = {
        AuthFlow: 'USER_PASSWORD_AUTH',
        ClientId: CLIENT_ID,
        AuthParameters: {
          USERNAME: username,
          PASSWORD: tempPassword,
        },
      };

      let authResult;
      try {
        authResult = await cognitoIdentityServiceProvider.initiateAuth(authParams).promise();
      } catch (authError) {
        // If we get NEW_PASSWORD_REQUIRED challenge, respond to it
        if (authError.code === 'NotAuthorizedException' && authError.message.includes('NEW_PASSWORD_REQUIRED')) {
          // Try to set permanent password first
          await cognitoIdentityServiceProvider.adminSetUserPassword({
            UserPoolId: USER_POOL_ID,
            Username: username,
            Password: tempPassword,
            Permanent: true,
          }).promise();
          
          // Retry sign in
          authResult = await cognitoIdentityServiceProvider.initiateAuth(authParams).promise();
        } else {
          throw authError;
        }
      }

      // If we get NEW_PASSWORD_REQUIRED challenge, respond to it
      if (authResult.ChallengeName === 'NEW_PASSWORD_REQUIRED') {
        const challengeParams = {
          ClientId: CLIENT_ID,
          ChallengeName: 'NEW_PASSWORD_REQUIRED',
          Session: authResult.Session,
          ChallengeResponses: {
            USERNAME: username,
            NEW_PASSWORD: tempPassword,
          },
        };
        
        authResult = await cognitoIdentityServiceProvider.respondToAuthChallenge(challengeParams).promise();
      }

      if (authResult.ChallengeName) {
        throw new Error(`Unexpected challenge: ${authResult.ChallengeName}`);
      }

      return {
        success: true,
        userSub: userSub,
        accessToken: authResult.AuthenticationResult.AccessToken,
        idToken: authResult.AuthenticationResult.IdToken,
        refreshToken: authResult.AuthenticationResult.RefreshToken,
        expiresIn: authResult.AuthenticationResult.ExpiresIn,
        tokenType: authResult.AuthenticationResult.TokenType,
        isGuest: true,
        deviceId: deviceId,
        message: 'Guest account created successfully.',
      };
    } catch (signInError) {
      // If sign in fails, try to set permanent password and retry
      try {
        await cognitoIdentityServiceProvider.adminSetUserPassword({
          UserPoolId: USER_POOL_ID,
          Username: username,
          Password: tempPassword,
          Permanent: true,
        }).promise();

        const authParams = {
          AuthFlow: 'USER_PASSWORD_AUTH',
          ClientId: CLIENT_ID,
          AuthParameters: {
            USERNAME: username,
            PASSWORD: tempPassword,
          },
        };

        const authResult = await cognitoIdentityServiceProvider.initiateAuth(authParams).promise();

        if (authResult.ChallengeName === 'NEW_PASSWORD_REQUIRED') {
          const challengeParams = {
            ClientId: CLIENT_ID,
            ChallengeName: 'NEW_PASSWORD_REQUIRED',
            Session: authResult.Session,
            ChallengeResponses: {
              USERNAME: username,
              NEW_PASSWORD: tempPassword,
            },
          };
          
          const finalAuthResult = await cognitoIdentityServiceProvider.respondToAuthChallenge(challengeParams).promise();
          
          return {
            success: true,
            userSub: userSub,
            accessToken: finalAuthResult.AuthenticationResult.AccessToken,
            idToken: finalAuthResult.AuthenticationResult.IdToken,
            refreshToken: finalAuthResult.AuthenticationResult.RefreshToken,
            expiresIn: finalAuthResult.AuthenticationResult.ExpiresIn,
            tokenType: finalAuthResult.AuthenticationResult.TokenType,
            isGuest: true,
            deviceId: deviceId,
            message: 'Guest account created successfully.',
          };
        }

        return {
          success: true,
          userSub: userSub,
          accessToken: authResult.AuthenticationResult.AccessToken,
          idToken: authResult.AuthenticationResult.IdToken,
          refreshToken: authResult.AuthenticationResult.RefreshToken,
          expiresIn: authResult.AuthenticationResult.ExpiresIn,
          tokenType: authResult.AuthenticationResult.TokenType,
          isGuest: true,
          deviceId: deviceId,
          message: 'Guest account created successfully.',
        };
      } catch (retryError) {
        console.error('Error signing in guest user:', retryError);
        throw new Error(`Failed to sign in guest user: ${retryError.message}`);
      }
    }
  } catch (error) {
    console.error('Error creating guest user:', error);
    if (error.code === 'UsernameExistsException') {
      // User already exists, try to sign in instead
      try {
        const guestEmail = `guest-${deviceId.replace(/[^a-zA-Z0-9]/g, '-')}@temp.catfish.app`;
        // Try to get existing user and sign in
        // For now, throw error - we'll handle this in the route handler
        throw new Error('Guest user already exists. Please sign in.');
      } catch (signInError) {
        throw new Error(`Guest account exists but sign in failed: ${signInError.message}`);
      }
    }
    throw error;
  }
}

/**
 * Lambda handler
 */
exports.handler = async (event) => {
  console.log('Received event:', JSON.stringify(event, null, 2));

  const headers = getCorsHeaders();

  // Handle preflight OPTIONS request
  if (event.httpMethod === 'OPTIONS') {
    return handleOptions();
  }

  // Extract path and method
  const path = event.path || event.requestContext?.path || event.rawPath || '';
  const method = event.httpMethod || event.requestContext?.httpMethod || '';

  // Parse request body
  let body;
  try {
    body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body || {};
  } catch (error) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({
        success: false,
        error: 'Invalid JSON in request body',
      }),
    };
  }

  try {
    // Route based on path
    if ((path.includes('/signup') || path.endsWith('/signup')) && method === 'POST') {
      const { email, password, name } = body;
      
      if (!email || !password) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({
            success: false,
            error: 'Email and password are required',
          }),
        };
      }

      const result = await signUp(email, password, name);
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify(result),
      };
    }

    if ((path.includes('/guest-signup') || path.endsWith('/guest-signup')) && method === 'POST') {
      const { deviceId } = body;
      
      if (!deviceId) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({
            success: false,
            error: 'Device ID is required for guest signup',
          }),
        };
      }

      const result = await guestSignUp(deviceId);
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify(result),
      };
    }

    if ((path.includes('/confirm-signup') || path.endsWith('/confirm-signup')) && method === 'POST') {
      const { email, confirmationCode } = body;
      
      if (!email || !confirmationCode) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({
            success: false,
            error: 'Email and confirmation code are required',
          }),
        };
      }

      const result = await confirmSignUp(email, confirmationCode);
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify(result),
      };
    }

    if ((path.includes('/resend-confirmation') || path.endsWith('/resend-confirmation')) && method === 'POST') {
      const { email } = body;
      
      if (!email) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({
            success: false,
            error: 'Email is required',
          }),
        };
      }

      const result = await resendConfirmationCode(email);
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify(result),
      };
    }

    if ((path.includes('/signin') || path.endsWith('/signin')) && method === 'POST') {
      const { email, password } = body;
      
      if (!email || !password) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({
            success: false,
            error: 'Email and password are required',
          }),
        };
      }

      const result = await signIn(email, password);
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify(result),
      };
    }

    if ((path.includes('/refresh-token') || path.endsWith('/refresh-token')) && method === 'POST') {
      const { refreshToken } = body;
      
      if (!refreshToken) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({
            success: false,
            error: 'Refresh token is required',
          }),
        };
      }

      const result = await refreshToken(refreshToken);
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify(result),
      };
    }

    if ((path.includes('/forgot-password') || path.endsWith('/forgot-password')) && method === 'POST') {
      const { email } = body;
      
      if (!email) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({
            success: false,
            error: 'Email is required',
          }),
        };
      }

      const result = await forgotPassword(email);
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify(result),
      };
    }

    if ((path.includes('/confirm-forgot-password') || path.endsWith('/confirm-forgot-password')) && method === 'POST') {
      const { email, confirmationCode, newPassword } = body;
      
      if (!email || !confirmationCode || !newPassword) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({
            success: false,
            error: 'Email, confirmation code, and new password are required',
          }),
        };
      }

      const result = await confirmForgotPassword(email, confirmationCode, newPassword);
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify(result),
      };
    }

    if ((path.includes('/user') || path.endsWith('/user')) && method === 'GET') {
      const authHeader = event.headers?.Authorization || event.headers?.authorization;
      
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return {
          statusCode: 401,
          headers,
          body: JSON.stringify({
            success: false,
            error: 'Authorization header with Bearer token is required',
          }),
        };
      }

      const accessToken = authHeader.replace('Bearer ', '');
      const result = await getUserInfo(accessToken);
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify(result),
      };
    }

    // Unknown endpoint
    return {
      statusCode: 404,
      headers,
      body: JSON.stringify({
        success: false,
        error: 'Endpoint not found',
      }),
    };
  } catch (error) {
    console.error('Error processing request:', error);
    
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: error.message || 'Internal server error',
      }),
    };
  }
};

