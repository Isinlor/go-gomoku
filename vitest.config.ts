import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: 'happy-dom',
    include: ['tests/**/*.test.ts'],
    testTimeout: 250,
    slowTestThreshold: 250,
    tags: [{
      name: 'slow',
      description: 'Measured integration or exhaustive search exceeding 250 ms',
      timeout: 5_000,
    }],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,vue}', 'scripts/puzzle-performance.mjs', 'scripts/ai-strength.mjs'],
      exclude: [
        'src/env.d.ts',
        'src/engine/index.ts',
        'src/engine/puzzleGenerator.ts',
      ],
      thresholds: {
        lines: 100,
        functions: 100,
        branches: 100,
      },
    },
  },
});
