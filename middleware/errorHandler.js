/**
 * Error Handler Middleware for Lambda Functions
 * Wraps Lambda handlers with Sentry error tracking
 */

const Sentry = require('@sentry/serverless');

let isSentryInitialized = false;

/**
 * Initialize Sentry for Lambda
 */
function initializeSentry() {
  const sentryDsn = process.env.SENTRY_DSN;
  const environment = process.env.SENTRY_ENVIRONMENT || process.env.STAGE || 'dev';

  if (!sentryDsn || sentryDsn.trim() === '') {
    console.warn('Sentry DSN not configured, error tracking disabled');
    return false;
  }

  if (isSentryInitialized) {
    return true;
  }

  try {
    Sentry.AWSLambda.init({
      dsn: sentryDsn,
      environment: environment,
      tracesSampleRate: environment === 'prod' ? 0.1 : 1.0, // 10% in prod, 100% in dev
      debug: environment !== 'prod',
      beforeSend(event, hint) {
        // Filter out certain errors if needed
        return event;
      },
    });

    isSentryInitialized = true;
    console.log('Sentry initialized for Lambda');
    return true;
  } catch (error) {
    console.error('Error initializing Sentry:', error);
    return false;
  }
}

/**
 * Wrap a Lambda handler with Sentry error tracking
 * @param {Function} handler - Lambda handler function
 * @returns {Function} Wrapped handler
 */
function wrapHandler(handler) {
  // Initialize Sentry if not already done
  initializeSentry();

  // If Sentry is not configured, return original handler
  if (!isSentryInitialized) {
    return handler;
  }

  // Wrap with Sentry
  return Sentry.AWSLambda.wrapHandler(handler, {
    timeoutWarningLimit: 500, // Warn if handler takes >500ms
    flushTimeout: 2000, // Wait up to 2s for events to be sent
  });
}

/**
 * Capture an exception manually
 * @param {Error} error - Error to capture
 * @param {Object} context - Additional context
 */
function captureException(error, context = {}) {
  if (!isSentryInitialized) {
    console.error('Sentry not initialized, error:', error);
    return;
  }

  try {
    Sentry.withScope((scope) => {
      if (context.tags) {
        Object.keys(context.tags).forEach((key) => {
          scope.setTag(key, context.tags[key]);
        });
      }
      if (context.extra) {
        Object.keys(context.extra).forEach((key) => {
          scope.setExtra(key, context.extra[key]);
        });
      }
      if (context.user) {
        scope.setUser(context.user);
      }
      Sentry.captureException(error);
    });
  } catch (err) {
    console.error('Error capturing exception to Sentry:', err);
  }
}

/**
 * Capture a message (non-error event)
 * @param {string} message - Message to log
 * @param {string} level - Log level (info, warning, error)
 * @param {Object} context - Additional context
 */
function captureMessage(message, level = 'info', context = {}) {
  if (!isSentryInitialized) {
    console.log(`[Sentry not initialized] ${level}:`, message);
    return;
  }

  try {
    Sentry.withScope((scope) => {
      if (context.tags) {
        Object.keys(context.tags).forEach((key) => {
          scope.setTag(key, context.tags[key]);
        });
      }
      if (context.extra) {
        Object.keys(context.extra).forEach((key) => {
          scope.setExtra(key, context.extra[key]);
        });
      }
      Sentry.captureMessage(message, level);
    });
  } catch (error) {
    console.error('Error capturing message to Sentry:', error);
  }
}

/**
 * Set user context for error tracking
 * @param {string} userId - User ID
 * @param {Object} userData - Additional user data
 */
function setUser(userId, userData = {}) {
  if (!isSentryInitialized) return;

  try {
    Sentry.setUser({
      id: userId,
      ...userData,
    });
  } catch (error) {
    console.error('Error setting Sentry user:', error);
  }
}

/**
 * Add breadcrumb
 * @param {string} message - Breadcrumb message
 * @param {string} category - Breadcrumb category
 * @param {string} level - Log level
 * @param {Object} data - Additional data
 */
function addBreadcrumb(message, category = 'default', level = 'info', data = {}) {
  if (!isSentryInitialized) return;

  try {
    Sentry.addBreadcrumb({
      message,
      category,
      level,
      data,
      timestamp: Date.now() / 1000,
    });
  } catch (error) {
    console.error('Error adding breadcrumb to Sentry:', error);
  }
}

module.exports = {
  initializeSentry,
  wrapHandler,
  captureException,
  captureMessage,
  setUser,
  addBreadcrumb,
};
