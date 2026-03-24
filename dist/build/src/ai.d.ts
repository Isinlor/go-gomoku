import { GogoPosition } from './gogomoku.js';
export interface SearchResult {
    move: number;
    score: number;
    depth: number;
    nodes: number;
    timedOut: boolean;
}
export interface GogoAIOptions {
    maxDepth?: number;
    quiescenceDepth?: number;
    maxPly?: number;
    now?: () => number;
}
export declare class GogoAI {
    readonly maxDepth: number;
    readonly quiescenceDepth: number;
    readonly maxPly: number;
    private readonly now;
    private moveBuffers;
    private scoreBuffers;
    private history;
    private candidateMarks;
    private candidateEpoch;
    private bufferArea;
    private deadline;
    private nodesVisited;
    private timedOut;
    private readonly timeoutSignal;
    constructor(options?: GogoAIOptions);
    findBestMove(position: GogoPosition, timeLimitMs: number): SearchResult;
    private ensureBuffers;
    private pickFallbackMove;
    private searchRoot;
    private search;
    private quiescence;
    private evaluate;
    private generateOrderedMoves;
    private generateFullBoardMoves;
    private scoreMove;
    private insertMove;
    private checkTime;
}
