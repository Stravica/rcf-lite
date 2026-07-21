// `rcf coverage` subcommand handler. Reports structural coverage over
// the REQ chain (PRD -> REQ -> US -> AC -> TS -> TC). Phase 5 §D2 / §D10.
//
// Shallow-any default (any AC covered by any TC = REQ covered);
// --strict opts into per-AC-strict. --strict on a tree with uncovered
// ACs exits 4 (CI-gate friendly). Otherwise coverage always exits 0 -
// the gap count is data, not a refusal.
//
// Phase-boundary reminder (§D2, §1.4): this verb is a MECHANICAL /
// DETERMINISTIC structural check. It does NOT answer "does the AC
// set adequately capture the REQ's intent?" - that non-deterministic
// question belongs to a later prompting + MCP resources phase (7+).

import { parseArgs } from 'node:util';

import { formatErrors } from '@stravica-ai/rcf-lite-core/errors';
import { walkTree } from '@stravica-ai/rcf-lite-core/store';
import { findProjectRoot } from '../view/index.js';
import {
  classifyCoverageScope,
  computeCoverage,
  formatJson,
  formatMermaid,
  formatTable,
} from '../query/index.js';

const OPTION_SPEC = {
  strict: { type: 'boolean' },
  format: { type: 'string' },
  help: { type: 'boolean' },
  // Phase 10 (X2 CodeNode bridge, D11): layer the code axis onto coverage.
  'with-code': { type: 'boolean' },
};

const HELP = `Usage: rcf coverage [scope-id] [options]

Report structural coverage over the REQ chain (PRD -> REQ -> US -> AC
-> TS -> TC). Default is shallow-any (any AC covered by any TC = REQ
covered); --strict flips to per-AC-strict (every AC has TC coverage).

This is a mechanical / deterministic structural check. It does NOT
answer 'does the AC set adequately capture the REQ's intent?' - that
non-deterministic question is out of scope for Phase 5 (belongs to a
later prompting + MCP resources phase).

Positional:
  scope-id                  Optional PRD / REQ / US id to scope
                            coverage to a subtree. Below-AC ids
                            (AC / TS / TC / FBS / TAC / ADR / BS /
                            TAD) are refused with exit 2.

Options:
  --strict                  Per-AC-strict mode; exits 4 on any gap
  --with-code               Layer the code axis onto every AC: one of
                            implemented-and-covered / implemented-uncovered
                            / unimplemented, plus a tree-wide list of
                            CN-orphaned code nodes. INFORMATIONAL ONLY -
                            never blocks or affects the exit code (D11;
                            the mark-complete gate is where CN
                            completeness is enforced).
  --format <format>         table (default) | json | mermaid
  --help                    Print this help
`;

const VALID_FORMATS = new Set(['table', 'json', 'mermaid']);

/**
 * @param {string[]} argv - argv slice after `coverage`
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
  const positionals = parsed.positionals;
  if (flags.help) { stdout.write(HELP); return 0; }

  const format = flags.format ?? 'table';
  if (!VALID_FORMATS.has(format)) {
    stderr.write(`[error] usage coverage: unknown --format ${format} (expected table | json | mermaid)\n`);
    return 2;
  }
  if (positionals.length > 1) {
    stderr.write('[error] usage coverage: multiple positional ids are not supported\n');
    return 2;
  }

  const projectRoot = await findProjectRoot(cwd);
  if (!projectRoot) {
    stderr.write('[error] usage no project root found (no rcf/manifest.json in this directory or any ancestor). Run `npx rcf init` to create and wire a project.\n');
    return 2;
  }
  const { tree, errors } = await walkTree({ projectRoot });
  if (errors.length > 0) {
    stderr.write(`${formatErrors(errors, { verbose: false, strict: false })}\n`);
    return 3;
  }

  let scopeId = null;
  if (positionals.length === 1) {
    scopeId = positionals[0];
    // Reject wildcards / globs (spec §D13).
    if (scopeId.includes('*') || scopeId.includes('?')) {
      stderr.write('[error] usage coverage: wildcard / glob positional not supported\n');
      return 2;
    }
    const classification = classifyCoverageScope(tree, scopeId);
    if (classification === 'below-ac') {
      stderr.write(
        `[error] usage coverage: scope-id ${scopeId} is below the AC layer or off the REQ chain; ` +
          'coverage scope must be a PRD / REQ / US id\n',
      );
      return 2;
    }
    if (classification === 'not-found' || classification === 'unknown-kind') {
      stderr.write(`[error] usage coverage: id ${scopeId} not found\n`);
      return 2;
    }
  }

  const result = computeCoverage(tree, {
    strict: Boolean(flags.strict), scopeId, withCode: Boolean(flags['with-code']),
  });

  let output;
  if (format === 'json') output = formatJson(result, 'coverage');
  else if (format === 'mermaid') output = formatMermaid(result, 'coverage');
  else output = formatTable(result, 'coverage');
  stdout.write(output);

  // --strict on any gap = exit 4 (CI-gate friendly). Otherwise 0.
  if (flags.strict && !result.ok) return 4;
  return 0;
}
