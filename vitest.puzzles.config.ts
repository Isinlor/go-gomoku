import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Engine-only benchmarks need neither a DOM nor the Vue transform plugin.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/engine/puzzles.test.ts', 'tests/engine/gamePositions.test.ts'],
    // Vite rewrites the solver's imported bindings into getter-backed property
    // reads. Fixed-clock measurements with identical results and node counts
    // took 5.33s / 22.89s via Vite versus 4.13s / 14.50s via native Node for
    // ply2-i1-g6 / ply2-f9-h9. Slower execution can also exhaust speculative
    // proofs' quarter-time budgets and change the search path. Use Vitest's
    // native runner here to match test:performance's engine loading; retain
    // Vite transforms for the normal Vue/coverage suite.
    experimental: { viteModuleRunner: false },
    execArgv: ['--import', fileURLToPath(new URL('./scripts/puzzle-node-loader.mjs', import.meta.url))],
  },
});
