import { describe, expect, test } from 'vitest';
import { resolveBasePath } from '../vite.config';

describe('resolveBasePath', () => {
  test('uses repository base path in CI deployments', () => {
    expect(resolveBasePath({ GITHUB_ACTIONS: 'true' })).toBe('/go-gomoku/');
  });

  test('uses root base path for local development', () => {
    expect(resolveBasePath({})).toBe('/');
  });

  test.each(['false', '1', 'TRUE', ''])('requires the exact CI flag, not merely a nonempty string: %j', GITHUB_ACTIONS => {
    expect(resolveBasePath({ GITHUB_ACTIONS })).toBe('/');
  });
});
