export function readFlagValue(args: string[], index: number): string | undefined {
  return index + 1 < args.length && !args[index + 1].startsWith('--') ? args[index + 1] : undefined;
}

export function parseIntegerFlag(args: string[], index: number, flag: string): number {
  const rawValue = readFlagValue(args, index);
  if (rawValue === undefined) {
    throw new Error(`Missing value for ${flag}`);
  }
  const value = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid value for ${flag}: ${rawValue}`);
  }
  return value;
}
