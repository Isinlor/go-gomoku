import { describe, expect, test } from 'vitest';
import { resolveBasePath } from '../vite.config';

describe('resolveBasePath', () => {
  test('uses repository base path in CI deployments', () => {
    expect(resolveBasePath({ GITHUB_ACTIONS: 'true' })).toBe('/go-gomoku/');
  });

  test('uses root base path for local development', () => {
    expect(resolveBasePath({})).toBe('/');
  });
});
