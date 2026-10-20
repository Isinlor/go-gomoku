import type { GogoAIOptions } from './ai';

/** Playing configuration shared by the app and strength regression checks. */
export const AI_CONFIG = Object.freeze({
  maxDepth: 30,
  quiescenceDepth: 4,
  maxPly: 96,
} as const satisfies GogoAIOptions);
