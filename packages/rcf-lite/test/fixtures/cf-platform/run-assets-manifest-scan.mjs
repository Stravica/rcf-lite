#!/usr/bin/env node
// Run-shim for the deploy-cloudflare-workers v1.2.0 assets-manifest
// scan probe. Wires the probe module against this fixture and
// writes the report to .rcf/reports/blueprints/deploy-cloudflare-
// workers/assets-manifest-scan.json under the fixture root. Two
// induced-failure switches:
//
//   SIMULATE_MIXED_SHAPE=true
//     Copies wrangler.toml into a scratch path with a
//     pages_build_output_dir field appended; the probe surfaces the
//     mixed-shape refusal on that copy.
//
//   SIMULATE_EMPTY_ASSETS=true
//     Copies wrangler.toml into a scratch path with the [assets]
//     block removed; the probe records the bare-Worker shape
//     without any [assets] table and passes with an empty-directory
//     record.
//
// The switches never mutate the base wrangler.toml. The shim also
// takes an explicit --elicited path so the scan can be driven with
// a different answered assets-directory (used by the anatomy test).

import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..', '..', '..');
const probeModulePath = resolve(
  repoRoot,
  'blueprints',
  'deploy-cloudflare-workers',
  'contributions',
  'probes',
  'assets-manifest-scan.mjs',
);

const probe = await import(probeModulePath);

const args = new Map();
for (const raw of process.argv.slice(2)) {
  const match = raw.match(/^--([^=]+)=(.*)$/);
  if (match) args.set(match[1], match[2]);
}

const simulateMixedShape = process.env.SIMULATE_MIXED_SHAPE === 'true';
const simulateEmptyAssets = process.env.SIMULATE_EMPTY_ASSETS === 'true';

const baseManifest = join(here, 'wrangler.toml');
const scratchDir = join(here, '.scratch');
let manifestPath = baseManifest;
let elicited = {
  'assets-directory': args.get('assets-directory') ?? './dist',
  'run-worker-first':
    args.get('run-worker-first') !== undefined
      ? args.get('run-worker-first') === 'true'
      : true,
};

if (simulateMixedShape) {
  await mkdir(scratchDir, { recursive: true });
  manifestPath = join(scratchDir, 'wrangler.mixed.toml');
  const text = await readFile(baseManifest, 'utf8');
  const mixed = 'pages_build_output_dir = "./public"\n\n' + text;
  await writeFile(manifestPath, mixed, 'utf8');
} else if (simulateEmptyAssets) {
  await mkdir(scratchDir, { recursive: true });
  manifestPath = join(scratchDir, 'wrangler.empty-assets.toml');
  const text = await readFile(baseManifest, 'utf8');
  const stripped = text
    .split(/\r?\n/)
    .reduce(
      (acc, line) => {
        if (line.trim().startsWith('[assets]')) {
          acc.inAssets = true;
          return acc;
        }
        if (acc.inAssets && /^\s*\[/.test(line)) {
          acc.inAssets = false;
        }
        if (!acc.inAssets) acc.out.push(line);
        return acc;
      },
      { inAssets: false, out: [] },
    )
    .out.join('\n');
  await writeFile(manifestPath, stripped, 'utf8');
  elicited = { 'assets-directory': '', 'run-worker-first': false };
}

const report = await probe.scan({ fixtureRoot: here, manifestPath, elicited });
const reportPath = join(
  here,
  '.rcf',
  'reports',
  'blueprints',
  'deploy-cloudflare-workers',
  'assets-manifest-scan.json',
);
await probe.writeReport(reportPath, report);

if (simulateMixedShape || simulateEmptyAssets) {
  await probe.removeIfExists(manifestPath);
  await rm(scratchDir, { recursive: true, force: true });
}

process.stdout.write(
  JSON.stringify(
    {
      aggregateVerdict: report.aggregateVerdict,
      anchorAcId: report.anchorAcId,
      reportPath,
      results: report.results.map((r) => ({ verdict: r.verdict, detail: r.detail })),
    },
    null,
    2,
  ) + '\n',
);

if (report.aggregateVerdict === 'fail') {
  process.exitCode = 1;
}
