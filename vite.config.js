import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// "npm run dev:ui" serves only the screens with live reload and forwards
// every /api call to the local Cloudflare server on port 8788.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { proxy: { '/api': 'http://127.0.0.1:8788' } },
  build: { outDir: 'dist', chunkSizeWarningLimit: 1200 },
});
