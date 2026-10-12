import { defineConfig } from 'vitest/config';

// Engine-only benchmarks need neither a DOM nor the Vue transform plugin.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/engine/puzzles.test.ts', 'tests/engine/gamePositions.test.ts'],
  },
});
