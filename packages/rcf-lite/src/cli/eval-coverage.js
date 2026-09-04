// `rcf audit eval coverage` subcommand handler. Sibling of `rcf audit
// coverage`; grades non-deterministic AC coverage by EVAL docs rather
// than TS/TC coverage. See spec section 4 of
// projects/rcf-lite-wsd/specs/rcf-eval-node-spec-2026-09-04.md.
//
// Coverage rule (spec 2.3): an AC counts as covered by EVAL only when
// at least one EVAL document lists its id in acIds[], is not
// superseded, and has a non-pending runRecord[] entry (a "resolving"
// EVAL, mirroring the resolving-TC rule on `rcf audit coverage`).
//
// Exit codes: 0 clean, 2 usage refusal, 3 tree drift, 4 strict-gate
// refusal (any nonDeterministic AC without a resolving EVAL).
//
// Deterministic ACs never trigger the strict gate. A subtree with zero
// nonDeterministic ACs passes trivially. Presence of a resolving EVAL
// on a deterministic AC is reported as `covered-optional`, never as a
// defect.

import { parseArgs } from 'node:util';

import { formatErrors } from '#core/errors';
import { walkTree } from '#core/store';
import { findProjectRoot } from '../view/index.js';
import {
  classifyCoverageScope,
} from '../query/index.js';
import { computeEvalCoverage } from '../query/eval-coverage.js';

const OPTION_SPEC = {
  strict: { type: 'boolean' },
  format: { type: 'string' },
  help: { type: 'boolean' },
  // 0.7.0 verification-integrity precedent: opt-in extra gate on
  // --strict that refuses any EVAL still at authoringStatus `draft`.
  // Named --require-approved to match `rcf audit coverage`'s flag,
  // spec section 12 Q1 recommendation.
  'require-approved': { type: 'boolean' },
};

export const HELP = `Usage: rcf audit eval coverage [scope-id] [options]

Report EVAL coverage of the non-deterministic ACs on the scoped
subtree. An AC counts as covered by EVAL only when at least one EVAL
document lists its id in acIds[], is not superseded, and has a
non-pending runRecord[] entry (a "resolving" EVAL, mirroring the
resolving-TC rule on \`rcf audit coverage\`).

Deterministic ACs never trigger the strict gate. Presence of a
resolving EVAL on a deterministic AC is reported as covered-optional,
never as a defect.

Positional:
  scope-id                  Optional PRD / REQ / US id to scope the
                            audit to a subtree. Below-AC ids exit 2.

Options:
  --strict                  Per-AC-strict mode; exits 4 on any
                            nonDeterministic AC without a resolving
                            EVAL. Deterministic ACs are never gated.
  --require-approved        Extra --strict gate: refuse any EVAL still
                            at authoringStatus 'draft'.
  --format <format>         table (default) | json | mermaid
  --help                    Print this help
`;

const VALID_FORMATS = new Set(['table', 'json', 'mermaid']);

/**
 * @param {string[]} argv - argv slice after `eval coverage`
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
    stderr.write(`[error] usage eval coverage: unknown --format ${format} (expected table | json | mermaid)\n`);
    return 2;
  }
  if (positionals.length > 1) {
    stderr.write('[error] usage eval coverage: multiple positional ids are not supported\n');
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
    if (scopeId.includes('*') || scopeId.includes('?')) {
      stderr.write('[error] usage eval coverage: wildcard / glob positional not supported\n');
      return 2;
    }
    const classification = classifyCoverageScope(tree, scopeId);
    if (classification === 'below-ac') {
      stderr.write(
        `[error] usage eval coverage: scope-id ${scopeId} is below the AC layer or off the REQ chain; ` +
          'eval coverage scope must be a PRD / REQ / US id\n',
      );
      return 2;
    }
    if (classification === 'not-found' || classification === 'unknown-kind') {
      stderr.write(`[error] usage eval coverage: id ${scopeId} not found\n`);
      return 2;
    }
  }

  const report = computeEvalCoverage(tree, { scopeId });

  if (format === 'json') stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else if (format === 'mermaid') stdout.write(formatMermaid(report));
  else stdout.write(formatTable(report));

  // --strict on any missing = exit 4 (CI-gate friendly). Otherwise 0.
  if (flags.strict && !report.ok) return 4;

  if (flags.strict && flags['require-approved']) {
    const draftEvalIds = (tree.evals ?? []).filter((e) => e.status !== 'approved').map((e) => e.id);
    if (draftEvalIds.length > 0) {
      stderr.write(`[error] eval coverage --strict --require-approved: refused - ${draftEvalIds.length} EVAL(s) still not approved: ${draftEvalIds.join(', ')}\n`);
      return 4;
    }
  }
  return 0;
}

/**
 * Render the EVAL coverage report as a plain-text table.
 *
 * @param {import('../query/eval-coverage.js').EvalCoverageReport} report
 * @returns {string}
 */
export function formatTable(report) {
  const lines = [];
  lines.push('EVAL coverage report');
  if (report.scopeId) lines.push(`scope: ${report.scopeId}`);
  lines.push('');
  if (report.nonDeterministicCount === 0) {
    lines.push('no nonDeterministic ACs on this chain; audit passes trivially');
    lines.push('');
    lines.push(`ok=${report.ok}`);
    return `${lines.join('\n')}\n`;
  }
  lines.push('  AC              US        determinism      evalStatus  outcome            evalId');
  for (const ac of report.acs) {
    const cols = [
      pad(ac.acId, 15),
      pad(ac.usId, 9),
      pad(ac.determinism, 16),
      pad(ac.evalStatus, 11),
      pad(ac.outcome, 18),
      ac.evalId ?? '',
    ];
    lines.push(`  ${cols.join(' ')}`);
  }
  lines.push('');
  lines.push(
    `nonDeterministic=${report.nonDeterministicCount}, `
    + `covered=${report.coveredCount}, `
    + `missing=${report.missingCount}, ok=${report.ok}`,
  );
  return `${lines.join('\n')}\n`;
}

/**
 * Colour-coded mermaid summary. Spec section 4: green deterministic
 * (out of scope), amber nonDeterministic with a resolving EVAL, red
 * nonDeterministic without one.
 *
 * @param {import('../query/eval-coverage.js').EvalCoverageReport} report
 * @returns {string}
 */
export function formatMermaid(report) {
  const lines = ['graph TD'];
  lines.push('  classDef deterministic fill:#d1f2c4,stroke:#2f7a1e;');
  lines.push('  classDef covered fill:#ffe6a1,stroke:#a56a00;');
  lines.push('  classDef missing fill:#f4b4b4,stroke:#a00000;');
  for (const ac of report.acs) {
    const cls = ac.outcome === 'missing'
      ? 'missing'
      : ac.outcome === 'covered'
        ? 'covered'
        : 'deterministic';
    const label = ac.evalId ? `${ac.acId}\\n[${ac.evalId}]` : ac.acId;
    lines.push(`  ${idOf(ac.acId)}["${label}"]:::${cls}`);
  }
  return `${lines.join('\n')}\n`;
}

function pad(s, w) {
  const str = String(s ?? '');
  return str.length >= w ? str : str + ' '.repeat(w - str.length);
}

function idOf(s) {
  return String(s).replace(/[^A-Za-z0-9]+/g, '_');
}
