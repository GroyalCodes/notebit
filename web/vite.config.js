import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:8200',
      '/collab': { target: 'ws://127.0.0.1:8200', ws: true },
    },
  },
  build: { chunkSizeWarningLimit: 2000 },
});
