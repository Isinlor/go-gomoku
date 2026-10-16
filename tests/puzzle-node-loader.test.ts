// @vitest-environment node
import { afterAll, expect, test } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolvePuzzleImport } from '../scripts/puzzle-node-loader.mjs';

const root = mkdtempSync(join(tmpdir(), 'puzzle-node-loader-'));
writeFileSync(join(root, 'engine.ts'), 'export const value = 1;');
mkdirSync(join(root, 'collection'));
writeFileSync(join(root, 'collection', 'index.ts'), 'export const value = 2;');
const context = { parentURL: pathToFileURL(join(root, 'test.ts')).href };
const delegate = (specifier: string) => specifier;
afterAll(() => rmSync(root, { recursive: true, force: true }));

test('resolves extensionless TypeScript imports using the importing file', () => {
  expect(resolvePuzzleImport('./engine', context, delegate)).toBe('./engine.ts');
});

test('resolves directory imports to their TypeScript index', () => {
  expect(resolvePuzzleImport('./collection', context, delegate)).toBe('./collection/index.ts');
});

test.each(['node:fs', 'vitest', './engine.ts', './missing'])(
  'delegates %s without rewriting it', specifier => {
    expect(resolvePuzzleImport(specifier, context, delegate)).toBe(specifier);
  },
);

test('delegates entry points without an importing module', () => {
  expect(resolvePuzzleImport('./engine', {}, delegate)).toBe('./engine');
});

test('preserves errors from the Node resolver', () => {
  const error = new Error('resolution failed');
  expect(() => resolvePuzzleImport('./engine', context, () => { throw error; })).toThrow(error);
});
