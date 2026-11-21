import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// El front vive en client/; se compila a dist/ en la raíz, que sirve server/index.ts
export default defineConfig({
  root: 'client',
  plugins: [react()],
  build: { outDir: '../dist', emptyOutDir: true },
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
      '/socket.io': { target: 'http://localhost:3000', ws: true },
    },
  },
});
