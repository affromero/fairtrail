import { defineConfig } from 'tsup';
import path from 'node:path';

export default defineConfig({
  entry: ['src/index.tsx'],
  format: ['esm'],
  target: 'node22',
  dts: false,
  clean: true,
  splitting: false,
  esbuildOptions(options) {
    options.alias = {
      '@': path.resolve(__dirname, '../../apps/web/src'),
    };
    options.jsx = 'automatic';
  },
  external: [
    '@prisma/client',
    'playwright',
    'ioredis',
  ],
});
