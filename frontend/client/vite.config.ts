import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// In development the JobRadar server runs on :4321; API calls are forwarded to it.
const server = 'http://localhost:4321';

export default defineConfig({
  base: '/',
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: { '/api': server, '/healthz': server },
  },
});
