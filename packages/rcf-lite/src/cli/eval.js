// `rcf audit eval <sub-verb>` dispatcher. v1 exposes one sub-verb:
// `coverage`. The compound invocation `rcf audit eval coverage`
// matches the spec text exactly (section 4). Future sibling sub-verbs
// (`rcf audit eval trace`, `rcf build eval run`, ...) plug in here.

import { main as evalCoverageMain, HELP as COVERAGE_HELP } from './eval-coverage.js';

export const HELP = `Usage: rcf audit eval <sub-verb> [options]

Sub-verbs:
  coverage           Report EVAL coverage over the chain.

Options:
  --help             Print this help
`;

const SUB_VERBS = {
  coverage: evalCoverageMain,
};

/**
 * @param {string[]} argv - argv slice after `eval`
 * @param {object} [deps]
 * @returns {Promise<number>}
 */
export async function main(argv, deps = {}) {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    stdout.write(HELP);
    return 0;
  }
  const subVerb = argv[0];
  const handler = SUB_VERBS[subVerb];
  if (!handler) {
    stderr.write(`[error] usage unknown sub-verb '${subVerb}' under 'audit eval'.\n`);
    stderr.write(HELP);
    return 2;
  }
  return await handler(argv.slice(1), deps);
}

export { COVERAGE_HELP };
