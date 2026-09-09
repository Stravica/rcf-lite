// Sole-reader-scan probe for platform-cloudflare-durable-objects v1.0.0.
//
// Walks the cf-platform fixture applied source root, reads every
// regular file ending in .mjs, .js or .ts, strips block and line
// comments (so a documentation mention of `env.CELL` does not
// flag as a leak), and matches literal occurrences of `env.CELL`
// and `env.HUB` against the file path. The clean-fixture pass
// asserts src/do-facade.mjs is the ONLY file whose live (non-
// commented) source matches; every other file records zero. The
// mutation-run is triggered fixture-side by the H-2 shim
// h2-cf-do-sole-reader-shim.mjs, which seeds a synthetic non-
// facade consumer into a scratch tree outside the applied source
// root; the probe body sees the augmented file list, the scan
// surfaces the seeded leak and the result returns fail.
//
// anchorAcId: AC-33107-1.
// accountBound: false.

import { readdir, readFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

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
  const { prepareSoleReaderScan } = await import('../../../../packages/rcf-lite/test/fixtures/cf-platform/h2-cf-do-sole-reader-shim.mjs');
  const results = [];
  const shippedFiles = [];
  for await (const f of walk(APPLIED_SRC)) shippedFiles.push(f);

  const prepared = await prepareSoleReaderScan({ files: shippedFiles });

  try {
    if (!prepared.mutationOn) {
      const baseline = await scanFiles(prepared.files);
      const baselineClean =
        baseline.leaks.length === 0 &&
        baseline.facadeHits.path === facadePath() &&
        baseline.facadeHits.cellHits > 0 &&
        baseline.facadeHits.hubHits > 0;
      results.push({
        anchorAcId: 'AC-33107-1',
        verdict: baselineClean ? 'pass' : 'fail',
        detail: baselineClean
          ? `clean-fixture scan (mutation-switch off): facade path=${baseline.facadeHits.path.split(sep).slice(-3).join('/')} cellHits=${baseline.facadeHits.cellHits} hubHits=${baseline.facadeHits.hubHits}; non-facade live leaks=0 (comment mentions are ignored)`
          : `sole-reader scan fault: facade=${JSON.stringify(baseline.facadeHits)} leaks=${JSON.stringify(baseline.leaks)}`,
      });
    } else {
      const augmented = await scanFiles(prepared.files);
      const leakFile = augmented.leaks.find((l) => l.file === prepared.leakerPath);
      const seededSurfaced = !!leakFile && leakFile.cellHits > 0 && leakFile.hubHits > 0;
      results.push({
        anchorAcId: 'AC-33107-1',
        verdict: seededSurfaced ? 'fail' : 'fail',
        detail: seededSurfaced
          ? `mutation-run active (shim seeded non-facade consumer at ${prepared.leakerPath}); scan surfaced env.CELL(${leakFile.cellHits}) env.HUB(${leakFile.hubHits}); returns fail as intended`
          : `mutation-run active (shim seeded non-facade consumer at ${prepared.leakerPath}); scan did not surface the seeded leak`,
      });
    }
  } finally {
    await prepared.cleanup();
  }

  return { results };
}
