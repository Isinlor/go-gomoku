import { describe, expect, test } from 'vitest';

import { parseIntegerFlag, readFlagValue } from '../src/cliArgs';

describe('readFlagValue', () => {
  test('returns the next argument when it is a value', () => {
    expect(readFlagValue(['--time', '50'], 0)).toBe('50');
  });

  test('returns undefined when the value is missing or is another flag', () => {
    expect(readFlagValue(['--time'], 0)).toBeUndefined();
    expect(readFlagValue(['--time', '--pairs'], 0)).toBeUndefined();
  });
});

describe('parseIntegerFlag', () => {
  test('parses an integer flag value', () => {
    expect(parseIntegerFlag(['--limit', '12'], 0, '--limit')).toBe(12);
  });

  test('rejects missing and invalid values', () => {
    expect(() => parseIntegerFlag(['--limit'], 0, '--limit')).toThrow('Missing value for --limit');
    expect(() => parseIntegerFlag(['--limit', '--next'], 0, '--limit')).toThrow('Missing value for --limit');
    expect(() => parseIntegerFlag(['--limit', 'abc'], 0, '--limit')).toThrow('Invalid value for --limit: abc');
  });
});
