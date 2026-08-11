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

import { formatErrors } from '#core/errors';
import { resolveTestPointers, walkTree } from '#core/store';
import { findProjectRoot } from '../view/index.js';
import {
  classifyCoverageScope,
  computeCoverage,
  formatJson,
  formatMermaid,
  formatTable,
} from '../query/index.js';
import {
  findAttestationDrift,
  findAttestationMissing,
  findProvenanceMissing,
  findServicesWithEmptyAffectedFbsIds,
} from '../query/attestation.js';

const OPTION_SPEC = {
  strict: { type: 'boolean' },
  format: { type: 'string' },
  help: { type: 'boolean' },
  // Phase 10 (X2 CodeNode bridge, D11): layer the code axis onto coverage.
  'with-code': { type: 'boolean' },
  // 0.7.0 verification-integrity: opt-in extra gate on --strict that
  // refuses any TS still `draft` after Stage 4 (spec §7.2).
  'require-approved': { type: 'boolean' },
};

export const HELP = `Usage: rcf coverage [scope-id] [options]

Report structural coverage over the REQ chain (PRD -> REQ -> US -> AC
-> TS -> TC). A TC counts as covering its AC only when its testPointer
(filePath::testName) resolves to a real test in the working tree; a TC
whose pointer does not resolve is reported as covered-unresolved, never
counted as coverage. Default is shallow-any (any AC covered by any
resolving TC = REQ covered); --strict flips to per-AC-strict (every AC
has resolving TC coverage).

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
  --strict                  Per-AC-strict mode; exits 4 on any gap. Also
                            runs the attestation × profile matrix over
                            every AC that binds a dependsOnServices
                            entry (verification-integrity 0.7.0 §5.2):
                            attestation drift, missing provenance, and
                            missing FBS-level attestation all exit 4.
  --require-approved        Extra --strict gate: refuse any TS still at
                            authoringStatus 'draft' after Stage 4
                            (verification-integrity 0.7.0 §7.2). Off
                            by default; opt-in via CI.
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

  // w-2026-07-28-005: resolve every TC's testPointer against the working
  // tree first - "covered" means a pointer that resolves to a real test,
  // and a TC that fails resolution surfaces as covered-unresolved.
  const testPointers = await resolveTestPointers({ projectRoot, tree });
  const result = computeCoverage(tree, {
    strict: Boolean(flags.strict), scopeId, withCode: Boolean(flags['with-code']), testPointers,
  });

  let output;
  if (format === 'json') output = formatJson(result, 'coverage');
  else if (format === 'mermaid') output = formatMermaid(result, 'coverage');
  else output = formatTable(result, 'coverage');
  stdout.write(output);

  // --strict on any gap = exit 4 (CI-gate friendly). Otherwise 0.
  if (flags.strict && !result.ok) return 4;

  // 0.7.0 verification-integrity extension: --strict also runs the
  // attestation × profile matrix (spec §5.2). Three refusal classes:
  // (1) attestation missing, (2) provenance missing, (3) attestation
  // drift. All are additive — they never turn a passing coverage into
  // a passing --strict run; they only add exit-4 refusals on new
  // failure modes that the matrix now polices.
  if (flags.strict) {
    // Review N-3 (non-blocking): surface preFlightConfig services with
    // empty affectedFbsIds so the operator knows findAttestationMissing
    // is skipping them on purpose (honest-but-invisible without this
    // line). Warn-only, additive, never turns a passing strict run
    // into a failing one.
    const emptyAffected = findServicesWithEmptyAffectedFbsIds(tree);
    for (const s of emptyAffected) {
      stderr.write(`[warn] coverage --strict: preFlightConfig service '${s.serviceId}' (${s.preFlightConfigId}) has empty affectedFbsIds; the attestation-missing detector cannot cross-check it until the back-reference is populated.\n`);
    }

    const missing = findAttestationMissing(tree);
    const provMissing = findProvenanceMissing(tree);
    const drift = findAttestationDrift(tree);
    const refusals = [];
    if (missing.length > 0) {
      refusals.push('Attestation missing (FBSes listed in preflight affectedFbsIds but with no dependsOnServices entry):');
      for (const m of missing) refusals.push(`  - ${m.fbsId}: run \`rcf fbs ${m.fbsId} depends-on --service ${m.serviceId} --mode ${m.attestationMode} --acs <acIds>\``);
    }
    if (provMissing.length > 0) {
      refusals.push('Runtime provenance missing (TC covers an AC that binds a service):');
      for (const p of provMissing) refusals.push(`  - ${p.tsId}/${p.tcId} on ${p.acId}: run \`rcf test-suite ${p.tsId} provenance --tc ${p.tcId} --profile <mock|stub|fixture|live>\``);
    }
    const drifts = drift.filter((d) => d.verdict === 'refuse');
    if (drifts.length > 0) {
      refusals.push('Attestation drift (§3.5 matrix refusal):');
      for (const d of drifts) refusals.push(`  - ${d.tsId}/${d.tcId} on ${d.acId} (service ${d.serviceId}): ${d.reason}`);
    }
    if (refusals.length > 0) {
      stderr.write(`[error] coverage --strict: refused - the verification-integrity matrix caught the following:\n${refusals.join('\n')}\n`);
      return 4;
    }

    if (flags['require-approved']) {
      const draftTsIds = (tree.testSuites ?? []).filter((ts) => ts.status !== 'approved').map((ts) => ts.id);
      if (draftTsIds.length > 0) {
        stderr.write(`[error] coverage --strict --require-approved: refused - ${draftTsIds.length} test suite(s) still not approved: ${draftTsIds.join(', ')}\n`);
        return 4;
      }
    }
  }
  return 0;
}
