import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';

// Workspace packages are TypeScript sources and electron-store is ESM-only, so both are
// bundled into the main process. Native modules (better-sqlite3, koffi) stay external.
const bundled = ['@counterpay/core', '@counterpay/drivers', '@counterpay/plugins', 'electron-store'];

const alias = {
  '@shared': resolve(__dirname, 'src/shared'),
  '@locales': resolve(__dirname, '../../locales'),
};

export default defineConfig({
  main: {
    resolve: { alias },
    build: {
      externalizeDeps: { exclude: bundled },
    },
  },
  preload: {
    resolve: { alias },
    build: {
      externalizeDeps: { exclude: bundled },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: { alias },
    plugins: [react()],
    build: {
      rollupOptions: {
        input: {
          popup: resolve(__dirname, 'src/renderer/popup/index.html'),
          toast: resolve(__dirname, 'src/renderer/toast/index.html'),
          app: resolve(__dirname, 'src/renderer/app/index.html'),
        },
      },
    },
  },
});
