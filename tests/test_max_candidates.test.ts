import { test } from 'vitest';
import { GogoAI, decodeGame, decodeMove, encodeMove, PUZZLES } from '../src/engine';

test('Analyze puzzles for MAX_CANDIDATES sensitivity', { timeout: 300_000 }, () => {
  const results = [];
  
  for (const puzzle of PUZZLES) {
    const position = decodeGame(puzzle.encoded);
    const expectedIndex = decodeMove(puzzle.solution, position.meta);
    
    const ai = new GogoAI({ maxDepth: 10, quiescenceDepth: 4 });
    const result = ai.findBestMove(position, 20000);
    
    const foundMove = result.move >= 0 ? encodeMove(result.move, position.meta) : 'none';
    const solved = result.move === expectedIndex;
    
    results.push({
      id: puzzle.id,
      encoded: puzzle.encoded,
      solution: puzzle.solution,
      found: foundMove,
      solved,
      nodes: result.nodes,
      complexity: puzzle.encoded.split(' ').length
    });
    
    console.log(`${puzzle.id.padEnd(25)} ${solved ? '✓' : '✗'} found:${foundMove.padEnd(4)} expected:${puzzle.solution.padEnd(4)} nodes:${result.nodes.toString().padStart(7)} moves:${puzzle.encoded.split(' ').length}`);
  }
  
  const difficult = results.filter(r => !r.solved || r.nodes > 100000);
  console.log(`\nDifficult/unsolved puzzles: ${difficult.length}`);
  for (const r of difficult) {
    console.log(`  ${r.id}: ${r.solved ? 'solved' : 'UNSOLVED'} (${r.nodes} nodes)`);
  }
});
