import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The page is served by the agent at /display/ (local displays) and at / (Wi-Fi displays),
// so every asset path is relative.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2020',
  },
});
