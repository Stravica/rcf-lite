import { readFileSync } from 'node:fs';

// Read relative to this package's directory, as its own test script runs.
export function readPort() {
  const cfg = JSON.parse(readFileSync('fixtures/config.json', 'utf8'));
  return cfg.port > 0 ? cfg.port : 80;
}
