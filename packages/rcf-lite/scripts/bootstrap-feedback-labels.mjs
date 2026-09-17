#!/usr/bin/env node
// Maintainer aid: create the six rcf-feedback bootstrap labels on one
// destination repo (AC-15902-2). Idempotent: labels that already
// exist are left alone, missing ones are created via `gh label
// create`. Not called from `rcf init` or `rcf doctor`.
//
// Usage:
//   node scripts/bootstrap-feedback-labels.mjs --repo OWNER/REPO
//   node scripts/bootstrap-feedback-labels.mjs --repo OWNER/REPO --dry-run
//   node scripts/bootstrap-feedback-labels.mjs --repo OWNER/REPO --json
//
// Exit codes:
//   0  success (labels present on the repo after this run)
//   1  IO or gh failure
//   2  usage error (missing --repo, unknown flag)

import process from 'node:process';
import { parseArgs } from 'node:util';

import { FEEDBACK_LABELS, FEEDBACK_LABEL_DEFINITIONS } from '../src/feedback/labels.js';
import { loadGhAdapter } from '../src/feedback/gh.js';

const OPTIONS = {
  repo:      { type: 'string' },
  'dry-run': { type: 'boolean' },
  json:      { type: 'boolean' },
  help:      { type: 'boolean' },
};

const HELP = `Usage: bootstrap-feedback-labels --repo OWNER/REPO [--dry-run] [--json]

Create the six rcf-lite feedback bootstrap labels on one destination
repository. Idempotent: labels that already exist are left alone.

Labels created (source: src/feedback/labels.js:FEEDBACK_LABELS):
  ${FEEDBACK_LABELS.join('\n  ')}

Options:
  --repo OWNER/REPO   Destination repo (required).
  --dry-run           Report which labels would be created; do nothing.
  --json              Machine-readable summary.
  --help              Print this help.
`;

async function main(argv) {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: false, strict: true });
  } catch (err) {
    process.stderr.write(`[error] usage ${err.message}\n`);
    process.stdout.write(HELP);
    return 2;
  }
  const flags = parsed.values;
  if (flags.help) { process.stdout.write(HELP); return 0; }
  const repo = flags.repo;
  if (!repo || !/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(repo)) {
    process.stderr.write('[error] usage --repo OWNER/REPO is required\n');
    return 2;
  }

  const gh = await loadGhAdapter(process.env);
  const listRes = await gh.ghLabelList({ repo });
  if (!listRes.ok) {
    process.stderr.write(`[error] gh label list failed: ${listRes.message}\n`);
    return 1;
  }
  const existing = new Set(listRes.value.names ?? []);
  const missing = FEEDBACK_LABEL_DEFINITIONS.filter((d) => !existing.has(d.name));
  const summary = {
    repo,
    total: FEEDBACK_LABELS.length,
    existing: FEEDBACK_LABELS.filter((n) => existing.has(n)),
    missing: missing.map((d) => d.name),
    created: [],
    dryRun: !!flags['dry-run'],
  };

  if (!flags['dry-run']) {
    for (const def of missing) {
      const createRes = await gh.ghLabelCreate({
        repo,
        name: def.name,
        description: def.description,
        color: def.color,
      });
      if (!createRes.ok) {
        summary.error = `create ${def.name} failed: ${createRes.message}`;
        if (flags.json) process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
        else process.stderr.write(`[error] ${summary.error}\n`);
        return 1;
      }
      summary.created.push(def.name);
    }
  }

  if (flags.json) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } else if (flags['dry-run']) {
    process.stdout.write(`repo ${repo}: ${summary.existing.length}/${summary.total} present; would create ${summary.missing.length}: ${summary.missing.join(', ') || '(none)'}\n`);
  } else if (summary.created.length === 0) {
    process.stdout.write(`repo ${repo}: all ${summary.total} labels already present; nothing to do.\n`);
  } else {
    process.stdout.write(`repo ${repo}: created ${summary.created.length}/${summary.total} label(s): ${summary.created.join(', ')}\n`);
  }
  return 0;
}

// Export main for tests; entry point when invoked directly.
export { main };

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (err) => {
    process.stderr.write(`[error] ${err.stack || err.message}\n`);
    process.exit(1);
  });
}
