// Sole-reader-scan probe for platform-cloudflare-durable-objects v1.0.0.
//
// Walks the cf-platform fixture applied source root, reads every
// regular file ending in .mjs, .js or .ts, strips block and line
// comments (so a documentation mention of `env.CELL` does not
// flag as a leak), and matches literal occurrences of `env.CELL`
// and `env.HUB` against the file path. The clean-fixture pass
// asserts src/do-facade.mjs is the ONLY file whose live (non-
// commented) source matches; every other file records zero. Under
// SIMULATE_NON_FACADE_IMPORT=true the probe writes a synthetic
// scratch file into a scratch directory (never inside the applied
// source root, never mutating the fixture) and re-runs the scan
// including the scratch file; the scan surfaces the injected leak
// and returns fail.
//
// anchorAcId: AC-33107-1.
// accountBound: false.

import { readdir, readFile, mkdir, writeFile, rm } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { tmpdir } from 'node:os';

export const anchorAcId = 'AC-33107-1';
export const accountBound = false;

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(HERE, '..', '..', '..', '..');
const APPLIED_SRC = resolve(PROJECT_ROOT, 'packages/rcf-lite/test/fixtures/cf-platform/src');

async function* walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      yield* walk(p);
    } else if (e.isFile() && /\.(mjs|js|ts)$/i.test(e.name)) {
      yield p;
    }
  }
}

// Strip /* ... */ block comments and // ... line comments. Not a
// full JS parser; sufficient for the sole-reader scan on the
// shipped fixture files (no template-string edge cases here). If a
// future fixture file inlines a string that contains "env.CELL",
// review at self-review catches it.
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

function facadePath() {
  return resolve(APPLIED_SRC, 'do-facade.mjs');
}

async function scanFiles(files) {
  const leaks = [];
  const facadeHits = { path: null, cellHits: 0, hubHits: 0 };
  for (const f of files) {
    const raw = await readFile(f, 'utf8');
    const live = stripComments(raw);
    const cellHits = (live.match(/env\.CELL\b/g) ?? []).length;
    const hubHits = (live.match(/env\.HUB\b/g) ?? []).length;
    const isFacade = f === facadePath();
    if (isFacade) {
      facadeHits.path = f;
      facadeHits.cellHits = cellHits;
      facadeHits.hubHits = hubHits;
    } else if (cellHits > 0 || hubHits > 0) {
      leaks.push({ file: f, cellHits, hubHits });
    }
  }
  return { leaks, facadeHits };
}

export default async function runProbe() {
  const results = [];
  const files = [];
  for await (const f of walk(APPLIED_SRC)) files.push(f);

  const baseline = await scanFiles(files);
  const baselineClean =
    baseline.leaks.length === 0 &&
    baseline.facadeHits.path === facadePath() &&
    baseline.facadeHits.cellHits > 0 &&
    baseline.facadeHits.hubHits > 0;
  results.push({
    anchorAcId: 'AC-33107-1',
    verdict: baselineClean ? 'pass' : 'fail',
    detail: baselineClean
      ? `clean-fixture scan: facade path=${baseline.facadeHits.path.split(sep).slice(-3).join('/')} cellHits=${baseline.facadeHits.cellHits} hubHits=${baseline.facadeHits.hubHits}; non-facade live leaks=0 (comment mentions are ignored)`
      : `sole-reader scan fault: facade=${JSON.stringify(baseline.facadeHits)} leaks=${JSON.stringify(baseline.leaks)}`,
  });

  if (process.env.SIMULATE_NON_FACADE_IMPORT === 'true') {
    const scratch = resolve(tmpdir(), `t3-sole-reader-scratch-${process.pid}`);
    await mkdir(scratch, { recursive: true });
    const leaker = join(scratch, 'leaky-consumer.mjs');
    await writeFile(leaker, `export function leak(env) { return { cell: env.CELL, hub: env.HUB }; }\n`, 'utf8');
    const { leaks } = await scanFiles(files.concat([leaker]));
    const leakFile = leaks.find((l) => l.file === leaker);
    const simulateSurfaced = !!leakFile && leakFile.cellHits > 0 && leakFile.hubHits > 0;
    await rm(scratch, { recursive: true, force: true });
    results.push({
      anchorAcId: 'AC-33107-1',
      verdict: simulateSurfaced ? 'fail' : 'fail',
      detail: simulateSurfaced
        ? `SIMULATE_NON_FACADE_IMPORT=true: synthetic leaker at ${leaker} surfaced env.CELL(${leakFile.cellHits}) env.HUB(${leakFile.hubHits}); scan returns fail as intended`
        : `SIMULATE_NON_FACADE_IMPORT=true: scan did not surface the synthetic leak`,
    });
  }

  return { results };
}
