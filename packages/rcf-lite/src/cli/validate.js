// `rcf validate` subcommand handler. Wraps walker + validator + broken-
// reference machinery. Exits 0 clean, 2 on usage failure (a --base that
// does not resolve included), 3 on validation or broken-references or a
// criterion new or amended since the base with no verification flag
// (FBS-235). Phase 4 §D3.

import { parseArgs } from 'node:util';

import { formatErrors } from '#core/errors';
import { checkCodeNodeResolution, walkTree } from '#core/store';
import { validateCompanionPinsResolvable } from '../blueprint/companions.js';
import { findProjectRoot } from '../view/index.js';
// 0.30.0 PR 8 (REQ-178 / TAC-4126): define-validate findings.
import {
  VERIFICATION_NO_BASE_WARNING,
  collectDefineValidateFindings,
  collectVerificationFindings,
  readBaseCriteria,
  resolveVerificationBase,
  verificationWorklist,
} from '../define/validate-findings.js';
import { validateVerifyCatalogKeys } from '../verify/engine/catalog.js';
import { isHygieneTestPath, runGit } from '../audit/separation.js';

const OPTION_SPEC = {
  quiet: { type: 'boolean' },
  json: { type: 'boolean' },
  help: { type: 'boolean' },
  // Phase 10 (X2 CodeNode bridge, spec D8): skip the Code Node staleness
  // pass (spec-graph checks only). The default remains full validation -
  // the staleCode floor is only a floor if it runs by default.
  'no-code': { type: 'boolean' },
  // FBS-235 (ADR-4155): the verification base and the flag-sweep report.
  base: { type: 'string' },
  report: { type: 'string' },
};

export const HELP = `Usage: rcf define validate [options]

Walk the rcf/ tree and report schema-validation and broken-reference
issues. Exits 0 when clean, 2 on a usage error, 3 on issues.

A live criterion (no supersededBy) that is new since the base, or
amended since it (its description, given, when or then changed), and
carries no verification flag is an issue: "[error] verification <AC id>
is new|amended since <base7> and carries no verification flag
(external | testOnly)". The base is --base <ref>, else the merge-base of
HEAD with origin/main; with neither, validate prints one "[warn]
verification: no base ref; new and amended criteria not checked" line
and the rule is not checked. Retired criteria never need the flag.

Options:
  --base <ref>              The verification base (a git ref); a ref that
                            does not resolve exits 2
  --report verification     Print the flag-sweep worklist on stdout: one
                            line per live unflagged criterion, in id
                            order, "<AC id> TAB <US id> TAB <FBS id or ->
                            TAB <first 80 characters of its description>",
                            then "verification: <k> of <n> live criteria
                            unflagged"; with --json, {"unflagged": [...],
                            "live": <n>}. Read only: it never writes or
                            suggests a flag, and leaves the exit code to
                            the findings
  --quiet                   Only summary line + first 3 issues
  --json                    Emit machine-readable envelope
  --no-code                 Skip the Code Node staleness pass (spec-graph
                            checks only; the default runs full validation)
  --help                    Print this help
`;

// Case-insensitive whole-word TODO match. Word-bounded so incidental
// substrings (e.g. "autodoc") do not trip the scan.
const TODO_RE = /\btodo\b/i;

/**
 * Recursively collect dot-paths of string fields containing TODO
 * placeholder text.
 * @param {unknown} value
 * @param {string} path
 * @param {string[]} out
 */
function findTodoFields(value, path, out) {
  if (typeof value === 'string') {
    if (TODO_RE.test(value)) out.push(path);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => findTodoFields(v, `${path}[${i}]`, out));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      findTodoFields(v, path ? `${path}.${k}` : k, out);
    }
  }
}

/**
 * Scan every loaded document (roots + children; inline ACs / TCs ride
 * inside their parent doc's fields) for TODO placeholder text left over
 * from `rcf init` scaffolding. Cheap by design (B4): one string sweep,
 * one entry per affected doc.
 * @param {object} tree - walker TreeModel
 * @returns {Array<{ id: string, fields: string[] }>}
 */
function collectTodoNotices(tree) {
  const docs = [
    ...(tree.prd ? [{ id: tree.prd.prdId, doc: tree.prd }] : []),
    ...(tree.tad ? [{ id: tree.tad.tadId, doc: tree.tad }] : []),
    ...(tree.bs ? [{ id: tree.bs.bsId, doc: tree.bs }] : []),
    ...tree.requirements.map((d) => ({ id: d.reqId, doc: d })),
    ...tree.userStories.map((d) => ({ id: d.usId, doc: d })),
    ...tree.tacs.map((d) => ({ id: d.tacId, doc: d })),
    ...tree.adrs.map((d) => ({ id: d.adrId, doc: d })),
    ...tree.fbsItems.map((d) => ({ id: d.fbsId, doc: d })),
    ...tree.testSuites.map((d) => ({ id: d.id, doc: d })),
  ];
  const notices = [];
  for (const { id, doc } of docs) {
    /** @type {string[]} */
    const fields = [];
    findTodoFields(doc, '', fields);
    if (fields.length > 0) notices.push({ id: id ?? '(unknown id)', fields });
  }
  return notices;
}

/**
 * FBS-233 (AC-19602-4): one warn line per test case whose testPointer
 * points into a builder hygiene test. A hygiene binding is never a
 * validation error; coverage never counts it.
 * @param {object} tree - walker TreeModel
 * @returns {string[]}
 */
function hygieneWarnings(tree) {
  const lines = [];
  for (const ts of tree.testSuites ?? []) {
    for (const tc of ts.testCases ?? []) {
      if (typeof tc?.testPointer !== 'string') continue;
      const file = tc.testPointer.split('::')[0];
      if (isHygieneTestPath(file)) {
        lines.push(`[warn] ${tc.id} points into a hygiene test (${file}); hygiene tests are outside the RCF suite and never count as coverage`);
      }
    }
  }
  return lines;
}

/**
 * FBS-235: the verification options. --report takes only verification.
 *
 * @param {{ base?: string, report?: string }} flags
 * @returns {{ error: string } | { base: string|undefined, report: boolean }}
 */
export function verificationOptions(flags) {
  if (flags.report !== undefined && flags.report !== 'verification') {
    return { error: '[error] usage --report takes verification' };
  }
  return { base: flags.base, report: flags.report === 'verification' };
}

/**
 * FBS-235 (AC-19802-1, AC-19802-2): the worklist as stdout text, or as
 * JSON { unflagged, live } with --json.
 *
 * @param {{ unflagged: Array<{ acId: string, usId: string, fbsId: string|null, description: string }>, live: number }} worklist
 * @param {{ json?: boolean }} [opts]
 * @returns {string}
 */
export function formatVerificationReport(worklist, { json = false } = {}) {
  if (json) return `${JSON.stringify({ unflagged: worklist.unflagged, live: worklist.live }, null, 2)}\n`;
  const lines = worklist.unflagged.map((w) => [w.acId, w.usId, w.fbsId ?? '-', w.description.slice(0, 80)].join('\t'));
  lines.push(`verification: ${worklist.unflagged.length} of ${worklist.live} live criteria unflagged`);
  return `${lines.join('\n')}\n`;
}

/**
 * @param {string[]} argv - argv slice after `validate`
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
  if (flags.help) {
    stdout.write(HELP);
    return 0;
  }
  const verification = verificationOptions(flags);
  if ('error' in verification) {
    stderr.write(`${verification.error}\n`);
    return 2;
  }
  const projectRoot = await findProjectRoot(cwd);
  if (!projectRoot) {
    stderr.write('[error] usage no project root found (no rcf/manifest.json in this directory or any ancestor). Run `npx rcf init` to create and wire a project.\n');
    return 2;
  }
  // FBS-235 (ADR-4155): the verification base, read through git from the
  // project root before the walk, so a bad --base costs no tree read.
  const git = (args, input = null) => runGit(args, { cwd: projectRoot, input });
  const base = await resolveVerificationBase({ base: verification.base, git });
  if ('badRef' in base) {
    stderr.write(`[error] usage --base ${base.badRef} does not resolve\n`);
    return 2;
  }
  if (base.sha === null) stderr.write(`${VERIFICATION_NO_BASE_WARNING}\n`);
  const { tree, errors } = await walkTree({ projectRoot });
  for (const line of hygieneWarnings(tree)) stderr.write(`${line}\n`);
  // FBS-215: journey-record load errors are parked on the tree rather
  // than pushed onto the walker error list (so audit CLIs do not fail
  // on a discovery-record bug, per ADR-4142's read posture). The
  // define validate verb is the sanctioned surfacing path: it rides
  // the same exit path as schema / referential-integrity errors so
  // operators get the diagnostic without needing a discover-specific
  // check.
  if (tree.discoveryJourneyLoadError) {
    errors.push(tree.discoveryJourneyLoadError);
  }
  // Phase 10 (X2 CodeNode bridge, spec D6): staleness pass. Every Code
  // Node's declared path/symbol is checked against the working tree;
  // unresolved ones surface as `staleCode` errors folded into the same
  // exit path as schema / referential-integrity errors. This is the X2
  // detection claim: links that break visibly.
  if (!flags['no-code']) {
    const staleErrors = await checkCodeNodeResolution({ projectRoot, tree });
    errors.push(...staleErrors);
  }
  // Core-companions spec section 5: rcf/companions.json refusals ride
  // the same exit path as schema / referential-integrity errors. An
  // absent companions.json is not itself an error; a malformed file or
  // a pin that names no known provider is exit 3.
  const companionsErrors = await validateCompanionPinsResolvable({ projectRoot, tree });
  errors.push(...companionsErrors);
  // 0.30.0 PR 8 (REQ-178, TAC-4126): interface kind outside vocabulary,
  // bracketed AC class prefix outside the known classes, tacIds naming
  // a non-TAC, and an unresolving ownerRef or deliveredBy. Absence of
  // a class marker is NOT a finding (decision 10 kept).
  const defineValidateFindings = collectDefineValidateFindings(tree);
  errors.push(...defineValidateFindings);
  // FBS-218 (issue 349): a rcf/verify-catalog.json key naming no AC in
  // the tree is exit 3, so a probe can never silently orphan.
  errors.push(...await validateVerifyCatalogKeys({ projectRoot, tree }));
  // FBS-235 (US-19801): a live criterion new or amended since the base
  // with no verification flag is exit 3, beside every other finding.
  if (base.sha !== null) {
    errors.push(...collectVerificationFindings(tree, { sha: base.sha, criteria: await readBaseCriteria(git, base.sha) }));
  }
  // FBS-235 (US-19802): --report verification puts the worklist on
  // stdout (text, or JSON with --json) in place of the clean line and the
  // issue envelope; findings still go to stderr and set the exit code.
  if (verification.report) {
    stdout.write(formatVerificationReport(verificationWorklist(tree), { json: Boolean(flags.json) }));
    if (errors.length === 0) return 0;
    stderr.write(`${formatErrors(errors, { verbose: false, strict: false })}\n`);
    return 3;
  }
  if (flags.json) {
    const issues = errors.map((e) => ({
      id: e.documentId ?? null,
      kind: e.kind,
      rule: e.rule ?? null,
      filePath: e.filePath ?? null,
      field: e.field ?? null,
      message: e.message,
    }));
    stdout.write(`${JSON.stringify({ ok: errors.length === 0, issues }, null, 2)}\n`);
    return errors.length === 0 ? 0 : 3;
  }
  if (errors.length === 0) {
    if (!flags.quiet) {
      stdout.write('rcf define validate: tree is clean.\n');
      // B4 (E2E matrix 2026-07-06-003): scaffold TODO placeholders were
      // surviving to otherwise-valid trees unflagged. Non-blocking notice
      // only - the exit code is unchanged.
      const notices = collectTodoNotices(tree);
      if (notices.length > 0) {
        stdout.write(`notice: ${notices.length} document(s) still carry scaffold TODO placeholder text (informational; exit code unaffected):\n`);
        for (const n of notices) {
          stdout.write(`  ${n.id}: ${n.fields.join(', ')}\n`);
        }
      }
    }
    return 0;
  }
  if (flags.quiet) {
    const first = errors.slice(0, 3);
    // BUG-004 fix: `--quiet` used to render `errors.length` (== 3) as the
    // summary count. Pass the true total through so the summary reads
    // "N errors found" for the whole tree, not just the shown subset.
    stderr.write(`${formatErrors(first, { verbose: false, strict: false, total: errors.length })}\n`);
    if (errors.length > 3) stderr.write(`... ${errors.length - 3} more issue(s) suppressed by --quiet\n`);
  } else {
    stderr.write(`${formatErrors(errors, { verbose: false, strict: false })}\n`);
  }
  return 3;
}
