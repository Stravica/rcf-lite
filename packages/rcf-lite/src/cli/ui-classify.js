// `rcf ui-classify <fbs-id>` subcommand handler
// (ui-design-gate-0.7.0-spec §4.2).
//
// Runs the UI-bearing classifier on demand and prints the verdict. No
// side effects: the classifier does not write to the FBS document; the
// operator ratifies via `rcf update <fbs-id> --set uiBearing=true|false`
// when they want the verdict recorded (§4.4).

import { parseArgs } from 'node:util';
import process from 'node:process';

import { walkTree } from '@stravica-ai/rcf-lite-core/store';

import { findProjectRoot } from '../view/index.js';
import { classifyFbs } from '../ui-detection/classifier.js';

const OPTION_SPEC = {
  json: { type: 'boolean' },
  help: { type: 'boolean' },
};

export const HELP = `Usage: rcf ui-classify <fbs-id> [options]

Run the UI-bearing classifier on one FBS and print the verdict. Does
not write to the FBS document; ratify with:
  rcf update <fbs-id> --set uiBearing=true

Options:
  --json                    Emit the uiClassification block as JSON.
  --help                    Print this help.

Exit codes:
  0  classified (verdict printed)
  1  IO / unexpected runtime failure
  2  usage error
  3  tree validation failure
`;

/**
 * @param {string[]} argv
 * @param {object} [deps]
 * @returns {Promise<number>}
 */
export async function main(argv, deps = {}) {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  const cwd = deps.cwd ?? process.cwd();

  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: OPTION_SPEC, allowPositionals: true, strict: true });
  } catch (err) {
    stderr.write(`[error] usage ${err.message}\n`);
    stderr.write(HELP);
    return 2;
  }
  const flags = parsed.values;
  if (flags.help) { stdout.write(HELP); return 0; }
  if (parsed.positionals.length !== 1) {
    stderr.write('[error] usage ui-classify: expected exactly one <fbs-id> positional\n');
    return 2;
  }
  const fbsId = parsed.positionals[0];
  if (!/^FBS-\d{3,}$/.test(fbsId)) {
    stderr.write(`[error] usage ui-classify: expected an FBS id like FBS-011, got '${fbsId}'\n`);
    return 2;
  }

  const projectRoot = await findProjectRoot(cwd);
  if (!projectRoot) {
    stderr.write('[error] usage no project root found (no rcf/manifest.json in this directory or any ancestor). Run `rcf init` first.\n');
    return 2;
  }
  const { tree, errors } = await walkTree({ projectRoot });
  if (errors.length > 0) {
    stderr.write(`[warn] tree has ${errors.length} pre-existing issue(s); classification proceeds against what could be loaded\n`);
  }
  if (!tree.byId.has(fbsId) || tree.kindById.get(fbsId) !== 'fbs') {
    stderr.write(`[error] usage ui-classify: ${fbsId} not found or not an FBS\n`);
    return 2;
  }

  const now = deps.now ? new Date(deps.now()) : new Date();
  const block = classifyFbs(tree, fbsId, { now });

  if (flags.json) {
    stdout.write(`${JSON.stringify(block, null, 2)}\n`);
    return 0;
  }

  stdout.write(`ui-classify ${fbsId}: verdict=${block.verdict} reason=${block.reason}\n`);
  const signals = Array.isArray(block.signals) ? block.signals : [];
  if (signals.length > 0) {
    stdout.write(`  signals (${signals.length}):\n`);
    for (const s of signals) {
      const anchor = s.acId ? `${s.source}[${s.acId}]` : s.source;
      stdout.write(`    - ${anchor}: ${s.match}\n`);
    }
  }
  if (block.verdict === 'ui') {
    stdout.write('  Ratify with: rcf update ' + fbsId + ' --set uiBearing=true\n');
  } else if (block.verdict === 'notUi' && signals.length === 0) {
    stdout.write('  No UI signals detected. Override with: rcf update ' + fbsId + ' --set uiBearing=true\n');
  } else if (block.verdict === 'operatorOverride') {
    stdout.write('  Operator ruling recorded on FBS.uiBearing wins over the classifier.\n');
  }
  return 0;
}
