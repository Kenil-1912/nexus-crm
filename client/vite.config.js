import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In development the React app calls /api/..., which Vite forwards to the Node API.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': process.env.VITE_API_TARGET || 'http://localhost:4000' },
  },
});
