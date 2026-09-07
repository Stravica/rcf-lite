// Source-tree scan probe for the deploy-cloudflare-workers v1.2.0
// Workers-with-static-assets shape (T-0 of the Cloudflare round 6
// spec, section 5.0). accountBound false: this probe reads the
// applied fixture wrangler.toml and asserts three properties:
//
//   1. When the elicited assets-directory answer is non-empty, the
//      [assets] table's directory field equals the elicited answer
//      (assetsBlockEmitted, canonical AC-12113-1).
//   2. When the elicited run-worker-first answer is truthy, the
//      [assets] table carries run_worker_first equal to true; when
//      falsy or unanswered, run_worker_first is absent
//      (spaFallbackShape facet of AC-12113-1).
//   3. The manifest never carries a Pages-only pages_build_output_dir
//      field alongside [assets]; the two shapes are mutually
//      exclusive per Cloudflare's static-assets doc.
//
// Verdict envelope per spec section 3.2: { verdict, detail,
// anchorAcId, aggregateVerdict } where anchorAcId is
// AC-12113-1 (the assetsBlockEmitted anchor). aggregateVerdict is
// pass when every result is pass, warn when any is warn (unused
// here), fail when any is fail. Cleans up any temporary files it
// wrote on exit.

import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';

export const anchorAcId = 'AC-12113-1';
export const accountBound = false;

// Minimal wrangler.toml reader. Handles the small subset of TOML the
// blueprint's manifest declares (top-level scalars, one [assets]
// table, and boolean/string literals). Reaches for no runtime dep;
// keeps the probe accountBound-false and dependency-free.
export function parseWranglerToml(text) {
  const lines = text.split(/\r?\n/);
  const root = {};
  let currentTable = root;
  let currentTableName = '';
  for (const raw of lines) {
    const line = raw.replace(/^\s+/, '').replace(/\s+$/, '');
    if (line === '' || line.startsWith('#')) continue;
    const tableMatch = line.match(/^\[([A-Za-z0-9_.\-]+)\]$/);
    if (tableMatch) {
      currentTableName = tableMatch[1];
      root[currentTableName] = root[currentTableName] || {};
      currentTable = root[currentTableName];
      continue;
    }
    const kv = line.match(/^([A-Za-z0-9_\-]+)\s*=\s*(.+)$/);
    if (!kv) continue;
    const key = kv[1];
    let value = kv[2].trim();
    // Strip trailing comments (a naive #-then-space split; sufficient
    // for the wrangler shapes this blueprint generates).
    const hashAt = value.indexOf(' #');
    if (hashAt !== -1) value = value.slice(0, hashAt).trim();
    if (value === 'true') {
      currentTable[key] = true;
    } else if (value === 'false') {
      currentTable[key] = false;
    } else if (/^-?\d+$/.test(value)) {
      currentTable[key] = Number(value);
    } else if (value.startsWith('"') && value.endsWith('"')) {
      currentTable[key] = value.slice(1, -1);
    } else if (value.startsWith("'") && value.endsWith("'")) {
      currentTable[key] = value.slice(1, -1);
    } else {
      currentTable[key] = value;
    }
  }
  return root;
}

// Drive the scan against the fixture. `opts.fixtureRoot` names the
// directory the wrangler.toml lives in; `opts.elicited` names the
// answers the fixture baked in (assets-directory string, run-worker-
// first boolean). Optionally `opts.simulate` is one of
// 'mixed-shape' or 'empty-assets': the caller rewrites wrangler.toml
// in a scratch copy for the simulate branches so the base fixture
// stays honest.
export async function scan(opts) {
  const fixtureRoot = opts.fixtureRoot;
  const elicited = opts.elicited || {};
  const manifestPath = opts.manifestPath || join(fixtureRoot, 'wrangler.toml');
  const text = await readFile(manifestPath, 'utf8');
  const parsed = parseWranglerToml(text);
  const results = [];
  const detail = {
    manifestPath,
    parsed,
    elicited: {
      assetsDirectory: elicited['assets-directory'] || '',
      runWorkerFirst: elicited['run-worker-first'] === true,
    },
  };

  const assets = parsed.assets || null;
  const answered = detail.elicited.assetsDirectory !== '';
  if (answered) {
    if (!assets) {
      results.push({
        verdict: 'fail',
        detail: 'assets table absent: elicited assets-directory is "' + detail.elicited.assetsDirectory + '" but wrangler.toml carries no [assets] block',
        anchorAcId,
      });
    } else if (assets.directory !== detail.elicited.assetsDirectory) {
      results.push({
        verdict: 'fail',
        detail: 'assets.directory mismatch: wrangler.toml carries directory=' + JSON.stringify(assets.directory) + ' but elicited answer is ' + JSON.stringify(detail.elicited.assetsDirectory),
        anchorAcId,
      });
    } else {
      results.push({
        verdict: 'pass',
        detail: 'assets.directory equals elicited assets-directory answer ' + JSON.stringify(assets.directory),
        anchorAcId,
      });
    }
    const runWorkerFirstOnManifest = assets && Object.prototype.hasOwnProperty.call(assets, 'run_worker_first');
    if (detail.elicited.runWorkerFirst) {
      if (!runWorkerFirstOnManifest || assets.run_worker_first !== true) {
        results.push({
          verdict: 'fail',
          detail: 'run_worker_first mismatch: elicited answer is true but manifest carries ' + (runWorkerFirstOnManifest ? String(assets.run_worker_first) : 'no run_worker_first key'),
          anchorAcId,
        });
      } else {
        results.push({
          verdict: 'pass',
          detail: 'assets.run_worker_first equals true, matching the elicited run-worker-first answer',
          anchorAcId,
        });
      }
    } else {
      if (runWorkerFirstOnManifest && assets.run_worker_first !== false) {
        results.push({
          verdict: 'fail',
          detail: 'run_worker_first mismatch: elicited answer is falsy but manifest carries run_worker_first=' + JSON.stringify(assets.run_worker_first),
          anchorAcId,
        });
      } else {
        results.push({
          verdict: 'pass',
          detail: 'assets.run_worker_first is absent (or false), matching the falsy elicited run-worker-first answer',
          anchorAcId,
        });
      }
    }
  } else {
    if (assets) {
      results.push({
        verdict: 'fail',
        detail: 'assets table present without an elicited assets-directory answer: bare-Worker shape expected, wrangler.toml carries [assets] block',
        anchorAcId,
      });
    } else {
      results.push({
        verdict: 'pass',
        detail: 'no [assets] block on wrangler.toml, matching the bare-Worker shape (assets-directory elicit unanswered)',
        anchorAcId,
      });
    }
  }

  const pagesFieldAtRoot = Object.prototype.hasOwnProperty.call(parsed, 'pages_build_output_dir');
  const pagesFieldUnderAssets = assets && Object.prototype.hasOwnProperty.call(assets, 'pages_build_output_dir');
  if (pagesFieldAtRoot || pagesFieldUnderAssets) {
    results.push({
      verdict: 'fail',
      detail: 'mixed-shape drift: wrangler.toml carries pages_build_output_dir (' + (pagesFieldAtRoot ? 'top-level' : 'inside [assets]') + ') alongside the Workers-with-static-assets shape; the two are mutually exclusive per Cloudflare static-assets doc',
      anchorAcId,
    });
  } else {
    results.push({
      verdict: 'pass',
      detail: 'no pages_build_output_dir field on wrangler.toml (Workers-with-static-assets shape is exclusive of the Pages shape)',
      anchorAcId,
    });
  }

  const aggregateVerdict = results.some((r) => r.verdict === 'fail')
    ? 'fail'
    : results.some((r) => r.verdict === 'warn')
      ? 'warn'
      : 'pass';

  return { verdict: aggregateVerdict, aggregateVerdict, anchorAcId, results, detail };
}

// Convenience for the run-shim: write a report file next to a
// project-relative .rcf/reports/ path. Creates the directory if it
// does not exist; the shim removes any scratch file it wrote to
// simulate the mixed-shape or empty-assets branch before exit.
export async function writeReport(reportPath, report) {
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
}

export async function removeIfExists(path) {
  try {
    await rm(path, { force: true });
  } catch (_err) {
    // Nothing to clean.
  }
}

export default { scan, writeReport, removeIfExists, parseWranglerToml, anchorAcId, accountBound };
