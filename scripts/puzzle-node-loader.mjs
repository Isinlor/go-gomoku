import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { extname } from 'node:path';

/** Resolve the engine's extensionless TypeScript and directory imports in Node. */
export function resolvePuzzleImport(specifier, context, nextResolve) {
  if (specifier.startsWith('.') && !extname(specifier) && context.parentURL) {
    for (const suffix of ['.ts', '/index.ts']) {
      if (existsSync(new URL(specifier + suffix, context.parentURL))) {
        return nextResolve(specifier + suffix, context);
      }
    }
  }
  return nextResolve(specifier, context);
}

registerHooks({ resolve: resolvePuzzleImport });
