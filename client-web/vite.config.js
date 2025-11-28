import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:8080',
        ws: true,
      },
      // Note: /favicon.ico is not proxied to avoid ECONNREFUSED errors when backend isn't ready
      // Browsers handle missing favicons gracefully (they'll just show no favicon)
      // The backend's favicon handler is still available if accessed directly
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      // Suppress source map warnings for dependencies
      onwarn(warning, warn) {
        // Suppress source map warnings for node_modules
        if (warning.code === 'SOURCEMAP_ERROR' && warning.url && warning.url.includes('node_modules')) {
          return;
        }
        warn(warning);
      },
      output: {
        manualChunks: {
          // Split admin modal and its dependencies into a separate chunk
          'admin': ['./src/ui/admin-modal.js'],
          // Split Three.js into its own chunk (it's large)
          'three': ['three'],
        },
      },
    },
    chunkSizeWarningLimit: 600, // Increase warning limit slightly (default is 500KB)
  },
});

