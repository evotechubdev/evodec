import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/pwa/',
  plugins: [react()],
  publicDir: 'assets',
  build: {
    outDir: 'dist/pwa',
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    host: true,
    port: 4173,
    proxy: {
      '/pwa-api': {
        target: 'https://multimideas-evo-backend.onrender.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/pwa-api/, ''),
      },
    },
  },
  preview: {
    host: true,
    port: 4173,
  },
});
