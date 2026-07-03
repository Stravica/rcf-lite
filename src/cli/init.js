// `rcf init` subcommand handler. Interactive by default when stdin +
// stdout are TTYs and --non-interactive is not set. Phase 4 §D5:
// exactly four prompts (projectName, prdProblemStatement, reqTitle,
// usTitle). Zero deps; prompts via node:readline/promises.

import { parseArgs } from 'node:util';
import { createInterface } from 'node:readline/promises';

import { initProject } from '../store/init.js';

const OPTION_SPEC = {
  'project-name': { type: 'string' },
  'non-interactive': { type: 'boolean' },
  quiet: { type: 'boolean' },
  help: { type: 'boolean' },
};

const HELP = `Usage: rcf init [options]

Options:
  --project-name <name>     Project name (required for --non-interactive)
  --non-interactive         Skip prompts; use seed values (default when
                            not on a TTY or when piped)
  --quiet                   Suppress non-error stdout
  --help                    Print this help
`;

/**
 * @param {string[]} argv - argv slice after `init`
 * @param {object} [deps]
 * @returns {Promise<number>}
 */
export async function main(argv, deps = {}) {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  const stdin = deps.stdin ?? process.stdin;

  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: OPTION_SPEC, allowPositionals: true, strict: true });
  } catch (err) {
    stderr.write(`[error] usage ${err.message}\n`);
    stderr.write(HELP);
    return 2;
  }
  const flags = parsed.values;
  if (flags.help) {
    stdout.write(HELP);
    return 0;
  }
  const cwd = deps.cwd ?? process.cwd();
  const forceNonInteractive = Boolean(flags['non-interactive']);
  const isTty = Boolean(stdout.isTTY && stdin.isTTY);
  const interactive = !forceNonInteractive && isTty;

  let projectName = flags['project-name'];
  let seed = null;

  if (interactive) {
    const rl = createInterface({ input: stdin, output: stdout });
    try {
      projectName = projectName ?? (await rl.question('Project name: ')).trim();
      if (!projectName) projectName = 'New RCF Project';
      const prdProblemStatement = (await rl.question('One-line problem statement: ')).trim();
      const reqTitle = (await rl.question('First requirement title: ')).trim();
      const usTitle = (await rl.question('First user story title: ')).trim();
      seed = {
        interactive: true,
        prdProblemStatement: prdProblemStatement || undefined,
        reqTitle: reqTitle || undefined,
        usTitle: usTitle || undefined,
      };
    } finally {
      rl.close();
    }
  } else {
    if (!projectName) {
      stderr.write('[error] usage --project-name is required in non-interactive mode\n');
      stderr.write(HELP);
      return 2;
    }
  }

  const result = await initProject({ projectRoot: cwd, projectName, seed });
  if (result && 'kind' in result && result.kind === 'usage') {
    stderr.write(`[error] usage ${result.message}\n`);
    return 2;
  }
  if (result && 'kind' in result) {
    stderr.write(`[error] ${result.kind} ${result.message}\n`);
    return 1;
  }
  if (!flags.quiet) {
    stdout.write(`Scaffolded ${result.created.length} files under rcf/.\n`);
    for (const file of result.created) stdout.write(`  ${file}\n`);
  }
  return 0;
}
