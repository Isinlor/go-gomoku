import { GogoAI, decodeGame } from '../engine';

export type AIType = 'classic';

export interface AIRequest {
  encodedGame: string;
  timeLimitMs: number;
  maxDepth: number;
  quiescenceDepth: number;
  maxPly: number;
  aiType?: AIType;
}

export interface AIResponse {
  move: number;
  score: number;
  depth: number;
  nodes: number;
  timedOut: boolean;
  forcedWin: boolean;
  forcedLoss: boolean;
  swap: boolean;
}

export function handleAIRequest(data: AIRequest): AIResponse {
  const position = decodeGame(data.encodedGame);
  const result = new GogoAI({
    maxDepth: data.maxDepth,
    quiescenceDepth: data.quiescenceDepth,
    maxPly: data.maxPly,
  }).findBestMove(position, data.timeLimitMs);
  return {
    move: result.move,
    score: result.score,
    depth: result.depth,
    nodes: result.nodes,
    timedOut: result.timedOut,
    forcedWin: result.forcedWin,
    forcedLoss: result.forcedLoss,
    swap: result.swap,
  };
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
