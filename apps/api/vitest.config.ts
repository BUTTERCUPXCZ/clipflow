import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Resolves the path aliases declared in tsconfig.json, including the ones
  // added by `nest g library`. Requires Vite 8, which ships this option.
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.spec.ts'],
    globalSetup: ['./test/global-setup.ts'],
    // DB suites share clipforge_test; run files one at a time so resets never race.
    fileParallelism: false,
  },
});
