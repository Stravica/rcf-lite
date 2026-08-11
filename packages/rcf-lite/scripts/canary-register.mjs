#!/usr/bin/env node
// Register-regression canary CLI entry point (spec §7.4).
//
// Reads the shipped fixture pack from
// `@stravica-ai/rcf-lite-core/fixtures/register-canary/`, injects the
// shipping build's guidance content as system context for a subagent
// driver (mock by default; production Anthropic Agent SDK driver is a
// separate ship), grades every response with the core register-canary
// pattern set, and appends one record per fixture onto the fixture
// manifest at `packages/build/fixtures/canary-manifest.json`.
//
// Exit codes:
//   0  every fixture passed, or --accept-fail was set on a fail run
//   1  IO / unexpected failure
//   2  usage error
//   4  one or more fixtures failed and --accept-fail was NOT set

import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

import {
  loadFixturePack,
  readCanaryManifest,
  writeCanaryManifest,
  runCanaryPack,
  MOCK_SUBAGENT,
  DEFAULT_CANARY_MANIFEST_PATH,
} from '../src/register-canary/index.js';
import { MOCK_DRIVER_MARKER } from '../src/register-canary/runner.js';

const here = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(here, '..');
const GUIDANCE_DIR = join(PACKAGE_ROOT, 'guidance');

const OPTION_SPEC = {
  'accept-fail': { type: 'boolean' },
  reason: { type: 'string' },
  json: { type: 'boolean' },
  'dry-run': { type: 'boolean' },
  help: { type: 'boolean' },
};

const HELP = `Usage: canary-register [--accept-fail --reason "..."] [--dry-run] [--json]

Runs the register-regression canary against the shipped fixture pack.
Fixtures come from @stravica-ai/rcf-lite-core; the shipping build's
guidance content is injected as system context for a subagent driver
(mock by default). Records are appended to
${DEFAULT_CANARY_MANIFEST_PATH}.

Options:
  --accept-fail --reason "..."   Ship-despite-fail (spec §7.5). Reason is
                                 recorded on the record. Ordinary usage
                                 does NOT combine these flags.
  --dry-run                      Grade without writing to the manifest
  --json                         Emit records as JSON on stdout
  --help                         Print this help
`;

async function main() {
  const parsed = parseArgs({ args: process.argv.slice(2), options: OPTION_SPEC, allowPositionals: false, strict: true });
  const flags = parsed.values;
  if (flags.help) { process.stdout.write(HELP); return 0; }

  if (flags['accept-fail'] && (typeof flags.reason !== 'string' || flags.reason.length < 20)) {
    process.stderr.write('[error] usage canary-register: --accept-fail requires --reason "..." with at least 20 characters\n');
    return 2;
  }

  const buildVersion = await readBuildVersion();
  const guidance = await readGuidance();

  // Driver selection: the production driver (Anthropic Agent SDK
  // dispatch pinned to Opus 4.7 per estate ladder) is a separate ship;
  // v1 ships only the mock. The env var switch keeps the seam ready
  // for the live driver without changing the CLI contract.
  const driverKind = process.env.RCF_CANARY_DRIVER ?? 'mock';
  if (driverKind !== 'mock') {
    process.stderr.write(`[error] canary-register: only the mock driver is wired in this ship (RCF_CANARY_DRIVER=${driverKind} is not yet supported). Live driver lands in a follow-up under a separate work item.\n`);
    return 2;
  }
  const driverMode = 'mock';
  const driver = MOCK_SUBAGENT;

  const fixtures = await loadFixturePack();
  const existingManifest = await readCanaryManifest();
  const existingRecords = existingManifest.registerCanary ?? [];

  const { records, verdict } = await runCanaryPack({
    fixtures,
    driver,
    driverMode,
    buildVersion,
    guidance,
    existingRecords,
  });

  // A mock run's verdict is already forced to `fail` inside the
  // runner and the shipDespiteFailReason is stamped with the
  // MOCK_DRIVER_MARKER. --accept-fail with a real operator reason is
  // the release-gate-side escape hatch (§7.5) for live-driver fails
  // and would OVERWRITE the mock marker; refuse the combination so a
  // release engineer cannot accidentally paper over a mock run.
  if (flags['accept-fail'] && driverMode === 'mock') {
    process.stderr.write('[error] canary-register: --accept-fail is not available for mock-driver runs. Mock-driver records are infrastructure-only and always ship with the mock marker; the ship-despite-fail path is for live-driver fails only.\n');
    return 2;
  }
  if (flags['accept-fail'] && verdict === 'fail') {
    for (const r of records) {
      if (r.verdict === 'fail') r.shipDespiteFailReason = flags.reason;
    }
  }

  const finalRecords = [...existingRecords, ...records];
  if (!flags['dry-run']) {
    await writeCanaryManifest({ records: finalRecords });
  }

  if (flags.json) {
    process.stdout.write(`${JSON.stringify({ verdict, records, driverMode }, null, 2)}\n`);
  } else {
    for (const r of records) {
      const mockMark = r.shipDespiteFailReason === MOCK_DRIVER_MARKER ? ' (mock-driver)' : (r.shipDespiteFailReason ? ' (ship-despite-fail)' : '');
      process.stdout.write(`${r.id} ${r.fixturePromptId}: ${r.verdict}${mockMark}\n`);
    }
    process.stdout.write(`aggregate: ${verdict} (driverMode=${driverMode})\n`);
    if (driverMode === 'mock') {
      process.stdout.write('[note] mock driver — this run verifies canary infrastructure only, not the register itself. A real subagent driver (Anthropic Agent SDK) is a separate ship.\n');
    }
  }

  // Mock runs always report fail at the top; the release-gate caller
  // in CI treats mock exit 4 as "infrastructure ran; no release gate".
  // Live runs return 0 on pass and 4 on fail per spec §7.4.
  if (verdict === 'fail' && !flags['accept-fail']) return 4;
  return 0;
}

async function readBuildVersion() {
  try {
    const pkg = JSON.parse(await readFile(join(PACKAGE_ROOT, 'package.json'), 'utf8'));
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

async function readGuidance() {
  // Concatenate the two prompt-shaped playbooks as system context.
  // Follows the manifest.json prompts[] set; the shipping content
  // matches what the CLI itself surfaces via `rcf guidance <topic>`.
  const files = ['elicitation-playbook.md', 'build-cycle-playbook.md'];
  const chunks = [];
  for (const name of files) {
    try {
      const text = await readFile(join(GUIDANCE_DIR, name), 'utf8');
      chunks.push(`# ${name}\n\n${text}`);
    } catch {
      // Missing guidance file is a canary defect in its own right;
      // fall through so the runner sees an empty guidance context and
      // the operator can debug from the log.
    }
  }
  return chunks.join('\n\n---\n\n');
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    process.stderr.write(`[canary-register] unexpected failure: ${err.message}\n${err.stack}\n`);
    process.exit(1);
  });
