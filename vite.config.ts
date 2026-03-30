import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export const resolveBasePath = (env: NodeJS.ProcessEnv): string =>
  env.GITHUB_ACTIONS === 'true' ? '/go-gomoku/' : '/';

export default defineConfig({
  base: resolveBasePath(process.env),
  plugins: [vue()],
  build: {
    outDir: 'dist',
  },
});
