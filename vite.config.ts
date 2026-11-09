import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API_PORT = Number(process.env.API_PORT || 8787);

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': { target: `http://localhost:${API_PORT}`, changeOrigin: true } },
  },
  build: { target: 'es2022', sourcemap: true, chunkSizeWarningLimit: 1500 },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    testTimeout: 60000,
  },
} as any);
