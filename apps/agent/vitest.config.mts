import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

// Main-process modules that don't need Electron (History, servers, merging) are tested in plain Node.
export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@locales': resolve(__dirname, '../../locales'),
    },
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
