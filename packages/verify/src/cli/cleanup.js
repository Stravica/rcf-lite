// `rcf-verify cleanup` (spec §3, §6 cleanup contract). Tear down provisioned
// accounts / sandboxes / data recorded in the --provision file. On a
// persistent target this stops runs accreting `zzverify-` cruft. Reports what
// it removed. The concrete teardown route is app-specific (injected).

import { parseArgs } from 'node:util';

import { formatError, isRcfError } from '@stravica-ai/rcf-lite-core/errors';

import { readProvisionFile, cleanup } from '../provision/index.js';

export const HELP = `Usage: rcf-verify cleanup --provision <file> [--url <app-url>]

Tear down artefacts recorded in the --provision file (all prefixed
'zzverify-'). Reports what was removed and what could not be.

Required:
  --provision <file>    The provisioning record written by run/provision

Exit codes:
  0  cleanup attempted; see the removed/blocked report
  2  usage error
  3  provision file could not be read
`;

/**
 * @param {string[]} argv
 * @param {object} [deps]
 * @returns {Promise<number>}
 */
export async function main(argv, deps = {}) {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;

  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: { provision: { type: 'string' }, url: { type: 'string' }, help: { type: 'boolean' } }, allowPositionals: false, strict: true });
  } catch (err) {
    stderr.write(`[error] usage ${err.message}\n`);
    stderr.write(HELP);
    return 2;
  }
  const flags = parsed.values;
  if (flags.help) { stdout.write(HELP); return 0; }
  if (!flags.provision) {
    stderr.write('[error] usage cleanup requires --provision <file>\n');
    stderr.write(HELP);
    return 2;
  }

  const record = await (deps.readProvisionFile ?? readProvisionFile)(flags.provision);
  if (isRcfError(record)) {
    stderr.write(`${formatError(record, { verbose: true })}\n`);
    return 3;
  }

  const provisioned = (record.credentials ?? []).map((c) => ({ kind: 'authAccount', ref: c.ref }));
  const result = await cleanup({ provisioned, teardown: deps.teardown });
  stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return 0;
}
