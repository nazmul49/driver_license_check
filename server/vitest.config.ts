import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Integration tests share one MySQL test database.
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      include: [
        'src/modules/checks/**',
        'src/modules/decision/**',
        'src/modules/sessions/state-machine.ts',
      ],
      thresholds: { lines: 90 },
    },
  },
});
