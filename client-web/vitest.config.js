import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node', // Using node for now, can switch to jsdom if needed for DOM tests
  },
});

