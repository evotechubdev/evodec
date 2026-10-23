import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Caminhos relativos permitem publicar o mesmo build em /pwa/ ou no
  // subdiretório criado pelo GitHub Pages.
  base: './',
  plugins: [react()],
  publicDir: 'assets',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: {
        support: 'index.html',
        pwa: 'pwa/index.html',
      },
    },
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
