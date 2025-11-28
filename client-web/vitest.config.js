import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node', // Default to node for most tests
    // Use jsdom for UI component tests that need DOM APIs
    environmentMatchGlobs: [
      ['**/ui/**/*.test.js', 'jsdom'],
      ['**/ui/**/*.spec.js', 'jsdom'],
    ],
    // Setup file to handle unhandled errors from jsdom dependencies
    setupFiles: ['./vitest.setup.js'],
  },
});

