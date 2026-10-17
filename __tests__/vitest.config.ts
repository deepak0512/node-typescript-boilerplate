import {
  configDefaults,
  coverageConfigDefaults,
  defineConfig,
} from 'vitest/config';

export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, 'build/**/*'],
    coverage: {
      provider: 'v8',
      // bin.ts is the process entry point (side effects only); runCli is covered instead.
      exclude: [
        ...coverageConfigDefaults.exclude,
        'build/**/*',
        'src/doc-sync/bin.ts',
      ],
    },
    typecheck: { tsconfig: './tsconfig.vitest.json' },
  },
});
