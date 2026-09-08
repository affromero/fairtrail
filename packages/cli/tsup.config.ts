import { defineConfig } from 'tsup';
import path from 'node:path';

export default defineConfig({
  entry: ['src/index.tsx'],
  format: ['esm'],
  target: 'node22',
  dts: false,
  clean: true,
  splitting: false,
  metafile: true,
  esbuildOptions(options) {
    options.alias = {
      '@': path.resolve(__dirname, '../../apps/web/src'),
    };
    options.jsx = 'automatic';
  },
  // Externalize every npm package. Bundling React together with ink's own
  // react-reconciler creates two React copies and breaks hooks ("Cannot read
  // properties of null reading useState"). Production runtime resolves all of
  // these from /app/packages/cli/node_modules (see Dockerfile).
  external: [
    '@prisma/client',
    'playwright',
    'ioredis',
    'react',
    'react-reconciler',
    'react-devtools-core',
    'scheduler',
    'ink',
    'ink-select-input',
    'ink-spinner',
    'ink-text-input',
    'chalk',
    'commander',
  ],
});
