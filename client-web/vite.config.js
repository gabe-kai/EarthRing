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
      '/favicon.ico': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
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

