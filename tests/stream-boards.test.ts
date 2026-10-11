import { describe, expect, test, vi } from 'vitest';

import {
  formatStreamBoardsSummary,
  main,
  parseArgs,
} from '../src/stream-boards';

describe('parseArgs', () => {
  test('parses the supported flags', () => {
    const options = parseArgs([
      '--ply', '3',
      '--size', '11',
      '--limit', '12',
      '--time-ms', '34',
      '--translation-symmetry',
      '--color-symmetry',
      '--seed', '55',
    ]);

    expect(options).toEqual({
      ply: 3,
      boardSize: 11,
      maxBoards: 12,
      timeLimitMs: 34,
      includeTranslationSymmetry: true,
      includeColorSymmetry: true,
      seed: 55,
    });
  });

  test('uses defaults when optional flags are omitted', () => {
    expect(parseArgs(['--ply', '2'])).toEqual({
      ply: 2,
      boardSize: 9,
      includeTranslationSymmetry: false,
      includeColorSymmetry: false,
    });
  });

  test('ignores unknown flags', () => {
    expect(parseArgs(['--ply', '2', '--unknown'])).toEqual({
      ply: 2,
      boardSize: 9,
      includeTranslationSymmetry: false,
      includeColorSymmetry: false,
    });
  });

  test('rejects a missing ply value', () => {
    expect(() => parseArgs([])).toThrow('Missing required --ply value');
  });

  test('rejects missing and invalid flag values', () => {
    expect(() => parseArgs(['--limit'])).toThrow('Missing value for --limit');
    expect(() => parseArgs(['--ply', 'x'])).toThrow('Invalid value for --ply: x');
    expect(() => parseArgs(['--ply', '1', '--size', '10'])).toThrow('Unsupported board size: 10');
    expect(() => parseArgs(['--ply', '1', '--seed', 'nope'])).toThrow('Invalid value for --seed: nope');
  });
});

describe('formatStreamBoardsSummary', () => {
  test('includes truncation reasons when present', () => {
    expect(formatStreamBoardsSummary({
      emitted: 5,
      exploredNodes: 12,
      prunedPrefixes: 3,
      truncatedByAmount: true,
      truncatedByTime: true,
    })).toContain('truncated=time,amount');
  });

  test('reports a clean completion when not truncated', () => {
    expect(formatStreamBoardsSummary({
      emitted: 1,
      exploredNodes: 2,
      prunedPrefixes: 0,
      truncatedByAmount: false,
      truncatedByTime: false,
    })).toContain('truncated=none');
  });
});

describe('main', () => {
  test('uses default console writers when none are provided', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    main(['--ply', '0']);

    expect(logSpy).toHaveBeenCalledWith('B9');
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('emitted=1'));
    vi.restoreAllMocks();
  });

  test('streams boards to stdout and summary to stderr', () => {
    const stdout: string[] = [];
    const stderr: string[] = [];

    main(
      ['--ply', '1', '--translation-symmetry', '--seed', '9'],
      {
        writeStdout: (line) => {
          stdout.push(line);
        },
        writeStderr: (line) => {
          stderr.push(line);
        },
      },
    );

    expect(stdout).toEqual(['B9 e5']);
    expect(stderr).toHaveLength(1);
    expect(stderr[0]).toContain('emitted=1');
  });

  test('writes usage errors to stderr and exits with code 1', () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const stderr: string[] = [];

    main([], {
      writeStdout: () => {},
      writeStderr: (line) => {
        stderr.push(line);
      },
    });

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(stderr[0]).toContain('Missing required --ply value');
    vi.restoreAllMocks();
  });

  test('string errors are forwarded through the fallback formatter', () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const stderr: string[] = [];

    main(['--ply', '0'], {
      writeStdout: () => {
        throw 'plain failure';
      },
      writeStderr: (line) => {
        stderr.push(line);
      },
    });

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(stderr).toEqual(['plain failure']);
    vi.restoreAllMocks();
  });
});
