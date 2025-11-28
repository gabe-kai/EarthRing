/**
 * Vitest setup file
 * Handles unhandled errors from jsdom dependencies that don't affect test results
 */

// Suppress unhandled errors from jsdom dependencies (webidl-conversions, whatwg-url)
// These are known compatibility issues with jsdom and certain Node.js versions
// The errors occur during module loading but don't affect test execution
process.on('uncaughtException', (error) => {
  if (
    error &&
    (error.message?.includes('webidl-conversions') ||
      error.message?.includes('whatwg-url') ||
      error.stack?.includes('webidl-conversions') ||
      error.stack?.includes('whatwg-url') ||
      error.stack?.includes('node_modules/webidl-conversions') ||
      error.stack?.includes('node_modules/whatwg-url'))
  ) {
    // Suppress these specific errors - they're from jsdom dependencies and don't affect tests
    return; // Don't propagate the error
  }
  // Re-throw other unhandled exceptions
  throw error;
});

// Also handle unhandled rejection errors
process.on('unhandledRejection', (reason) => {
  if (
    reason &&
    typeof reason === 'object' &&
    (reason.message?.includes('webidl-conversions') ||
      reason.message?.includes('whatwg-url') ||
      reason.stack?.includes('webidl-conversions') ||
      reason.stack?.includes('whatwg-url') ||
      reason.stack?.includes('node_modules/webidl-conversions') ||
      reason.stack?.includes('node_modules/whatwg-url'))
  ) {
    // Suppress these rejections
    return;
  }
  // Re-throw other unhandled rejections
  throw reason;
});
