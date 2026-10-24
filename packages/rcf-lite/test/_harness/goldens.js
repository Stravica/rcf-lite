// Shared test harness (GR-40): the goldens a slice's round DEFINE records
// at the round's base with the round-base bin, and the same reading the
// bound test takes at HEAD, so the golden and the test read the bin one
// way. Imports Node builtins and the harness only; nothing under src/ or
// test/_helpers/.
//
// Recording, from packages/rcf-lite at the round's base (the test-author,
// in that slice's round DEFINE, before BUILD changes anything):
//
//   node test/_harness/goldens.js coverage test/fixtures/pin-move/coverage-at-base.json
//     FBS-232 (AC-19501-5, the stage-keeper's ruling 6 on the Part B
//     summary's stops): the exit code and the sorted gap list of
//     node bin/rcf.js audit coverage --strict, as { "exitCode", "gaps" }.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BIN, rcf } from './spawn.js';
import { json } from './capture.js';

/**
 * node bin/rcf.js audit coverage --strict --format json in cwd, read as
 * { exitCode, gaps }: the exit code, and the ids of the criteria it
 * reports uncovered, sorted.
 */
export async function coverageResult(cwd, { bin = BIN } = {}) {
  const r = await rcf(['audit', 'coverage', '--strict', '--format', 'json'], { cwd, bin, timeout: 300_000 });
  const doc = json(r.stdout);
  const gaps = doc.requirements.flatMap((q) => q.acs.filter((a) => !a.covered).map((a) => a.id)).sort();
  return { exitCode: r.code, gaps };
}

function writeGolden(out, value) {
  const abs = resolve(process.cwd(), out);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, `${JSON.stringify(value, null, 2)}\n`);
  process.stdout.write(`golden written: ${out}\n`);
}

const RECORDERS = {
  coverage: async (out) => writeGolden(out, await coverageResult(process.cwd())),
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [kind, out] = process.argv.slice(2);
  if (!RECORDERS[kind] || !out) {
    process.stderr.write(`usage: node test/_harness/goldens.js <${Object.keys(RECORDERS).join('|')}> <out file>\n`);
    process.exit(2);
  }
  await RECORDERS[kind](out);
}
