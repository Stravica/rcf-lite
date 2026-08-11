// `rcf-verify report <report-path>` (spec §3, parallels `rcf view`).
// Re-render / summarise a prior report artifact using verify's own
// self-contained finding-renderer (§7.2 — no core view dependency).

import { readFile } from 'node:fs/promises';
import { resolve as resolvePath } from 'node:path';
import { parseArgs } from 'node:util';

import { formatError, isRcfError } from '@stravica-ai/rcf-lite-core/errors';

import { parseReport } from '../report/index.js';
import { renderReport } from '../report/renderer.js';

export const HELP = `Usage: rcf-verify report <report-path> [--json]

Re-render a prior report artifact. Default output is the human-readable
summary; --json re-emits the parsed artifact as JSON.

Exit codes:
  0  rendered
  2  usage error (no path)
  3  the report could not be read / parsed / is an unsupported schema
`;

/**
 * @param {string[]} argv - argv slice after `report`
 * @param {object} [deps]
 * @returns {Promise<number>}
 */
export async function main(argv, deps = {}) {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  const cwd = deps.cwd ?? process.cwd();

  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: { json: { type: 'boolean' }, help: { type: 'boolean' } }, allowPositionals: true, strict: true });
  } catch (err) {
    stderr.write(`[error] usage ${err.message}\n`);
    stderr.write(HELP);
    return 2;
  }
  if (parsed.values.help) {
    stdout.write(HELP);
    return 0;
  }
  const target = parsed.positionals[0];
  if (!target) {
    stderr.write('[error] usage report: a <report-path> is required\n');
    stderr.write(HELP);
    return 2;
  }

  const reader = deps.readFile ?? readFile;
  let raw;
  try {
    raw = await reader(resolvePath(cwd, target), 'utf8');
  } catch (err) {
    stderr.write(`[error] missingFile ${target}: ${err.message}\n`);
    return 3;
  }

  const report = parseReport(raw);
  if (isRcfError(report)) {
    stderr.write(`${formatError(report, { verbose: true })}\n`);
    return 3;
  }

  stdout.write(parsed.values.json ? `${JSON.stringify(report, null, 2)}\n` : renderReport(report));
  return 0;
}
