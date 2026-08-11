// `rcf-verify provision` (spec §3, §6). Stand up prerequisites standalone and
// write credentials to the --provision file. Derives what to provision from
// the chain's ACs (needs --repo). The concrete signup route is app-specific
// and agent-driven; where it can't be derived, this BLOCKS honestly rather
// than silently skipping (§6).

import { parseArgs } from 'node:util';

import { formatError, isRcfError } from '@stravica-ai/rcf-lite-core/errors';

import { readChain } from '../chain/index.js';
import { runProvisioning } from '../provision/index.js';

export const HELP = `Usage: rcf-verify provision --repo <path> --url <app-url> --provision <file>

Stand up prerequisite accounts / sandboxes / seed data for a later run.
Credentials are written to the --provision FILE only, never echoed.

Required:
  --repo <path>         RCF chain source (to derive what to provision)
  --url <app-url>       The running app
  --provision <file>    Where to write provisioned credentials

Exit codes:
  0  provisioning attempted; see the report of what was provisioned/blocked
  2  usage error
  3  chain could not be loaded
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
    parsed = parseArgs({ args: argv, options: { repo: { type: 'string' }, url: { type: 'string' }, provision: { type: 'string' }, help: { type: 'boolean' } }, allowPositionals: false, strict: true });
  } catch (err) {
    stderr.write(`[error] usage ${err.message}\n`);
    stderr.write(HELP);
    return 2;
  }
  const flags = parsed.values;
  if (flags.help) { stdout.write(HELP); return 0; }
  if (!flags.repo || !flags.url || !flags.provision) {
    stderr.write('[error] usage provision requires --repo, --url and --provision\n');
    stderr.write(HELP);
    return 2;
  }

  const chain = await (deps.readChain ?? readChain)({ repo: flags.repo });
  if (isRcfError(chain)) {
    stderr.write(`${formatError(chain, { verbose: true })}\n`);
    return 3;
  }

  const { provisioning } = await runProvisioning({
    acs: chain.acs,
    url: flags.url,
    provisionPath: flags.provision,
    mode: 'run',
    signup: deps.signup,
  });

  stdout.write(`${JSON.stringify(provisioning, null, 2)}\n`);
  return 0;
}
