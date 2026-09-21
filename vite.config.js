import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Project site: https://albertollamass.github.io/fantasy/
  base: '/fantasy/',
  plugins: [react()],
  server: {
    port: 5173,
    // Proxy local para saltar el CORS de la API oficial.
    // El navegador llama a /api-fantasy/... (mismo origen) y Vite lo reenvía.
    proxy: {
      '/api-fantasy': {
        target: 'https://fantasy-api.llt-services.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api-fantasy/, '')
      }
    }
  },
  preview: {
    port: 5173,
    proxy: {
      '/api-fantasy': {
        target: 'https://fantasy-api.llt-services.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api-fantasy/, '')
      }
    }
  }
});
