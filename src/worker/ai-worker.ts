import { GogoAI, decodeGame, type SearchResult } from '../engine';

export type AIType = 'classic';

export interface AIRequest {
  encodedGame: string;
  timeLimitMs: number;
  maxDepth: number;
  quiescenceDepth: number;
  maxPly: number;
  aiType?: AIType;
}

export type AIResponse = SearchResult;

export function handleAIRequest(data: AIRequest): AIResponse {
  const position = decodeGame(data.encodedGame);
  return new GogoAI({
    maxDepth: data.maxDepth,
    quiescenceDepth: data.quiescenceDepth,
    maxPly: data.maxPly,
  }).findBestMove(position, data.timeLimitMs);
}

interface WorkerScope {
  onmessage: ((event: MessageEvent) => void) | null;
  postMessage(data: unknown): void;
}

export function setupWorkerHandler(scope: WorkerScope): void {
  scope.onmessage = (event: MessageEvent<AIRequest>) => {
    scope.postMessage(handleAIRequest(event.data));
  };
}

// Auto-setup when running as a web worker
setupWorkerHandler(self as unknown as WorkerScope);
