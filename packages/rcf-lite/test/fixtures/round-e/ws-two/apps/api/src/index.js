import { readFileSync } from 'node:fs';

// ms is installed in this package's node_modules only (pnpm does not hoist it).
export async function toMs(text) {
  const { default: ms } = await import('ms');
  const value = ms(text);
  if (value === undefined) throw new Error(`not a duration: ${text}`);
  return value;
}

// Read relative to this package's directory, as its own test script runs.
export function readPort() {
  const cfg = JSON.parse(readFileSync('fixtures/config.json', 'utf8'));
  return cfg.port > 0 ? cfg.port : 80;
}

// Read relative to the workspace root, the rcf project root.
export function readRootPort() {
  const cfg = JSON.parse(readFileSync('apps/api/fixtures/config.json', 'utf8'));
  return cfg.port > 0 ? cfg.port : 80;
}

export function clampPort(n) {
  return n > 0 && n < 65536 ? n : 80;
}
