// `rcf create <kind>` subcommand handler. Delegates to writer.js for
// the actual persistence; this file handles CLI parsing + defaults +
// pre-run tree walk. Phase 4 §D6 (revised).

import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';

import { writeUnexpectedFailure } from '#core/errors';
import { createDocument, deriveSlug, splitCnPath, walkTree } from '#core/store';
import { deriveFileDeps, mapDerivedDepsToCnIds } from '#core/store/derive-deps.js';
import { findProjectRoot } from '../view/index.js';
// Track C+D §4.4: run the REQ-shape classifier on newly-created REQs
// so downstream tooling (rcf req-baseline, rcf preflight, the Stage-1
// gate) can act without a manual `rcf req-classify` first.
import { classifyAndPersistReq } from '../req-detection/index.js';
// Track C+D §5.3 moment 4: surface open baseline candidates on a
// newly-created US so the operator sees the sweep queue immediately.
import { openCandidatesForUs } from '../req-baseline/open-candidates.js';

const OPTION_SPEC = {
  parent: { type: 'string' },
  id: { type: 'string' },
  title: { type: 'string' },
  description: { type: 'string' },
  acs: { type: 'string' },
  ac: { type: 'string' },
  purpose: { type: 'string' },
  'test-level': { type: 'string' },
  slug: { type: 'string' },
  'test-pointer': { type: 'string' },
  'build-order': { type: 'string' },
  'from-file': { type: 'string' },
  'dry-run': { type: 'boolean' },
  quiet: { type: 'boolean' },
  help: { type: 'boolean' },
  // Phase 10 (X2 CodeNode bridge): `rcf create cn` flags.
  path: { type: 'string' },
  deps: { type: 'string' },
  'derive-deps': { type: 'boolean' },
};

export const HELP = `Usage: rcf define create <kind> [options]

Kinds: req | us | ac | tac | adr | fbs | ts | tc | cn

Parent by kind (--parent takes the id of the DIRECT parent listed here,
not any higher ancestor):
  req  -> PRD id            us  -> REQ id             ac -> US id
  tac  -> TAD id            adr -> TAD id             fbs -> BS id
  ts   -> US id             tc  -> TS id
  cn   -> no --parent; a Code Node's identity is its --path

Note ts -> US id. A test suite hangs off the user story, not off the FBS
that scheduled the work.

Options:
  --parent <id>             Required for every kind except cn (post-3.7
                            every non-root child carries a mandatory
                            parentId-style field). See the parent table
                            above for which id each kind expects.
  --id <id>                 Override auto-assigned id (refuses on
                            collision)
  --title <string>          Required for req / us / tac / adr / fbs / ts
                            (ac / tc use --description)
  --description <string>    Body description; required for ac / tc
  --acs <id>[,<id>...]      Required for fbs and ts (one or more AC ids)
  --ac <id>                 Required for tc (single AC id per test case)
  --purpose <string>        Required for ts
  --test-level <level>      Required for ts; one of
                            unit / integration / e2e / contract / manual
  --slug <slug>             Optional for tc; derived from description if
                            absent
  --test-pointer <path>     Required for tc; format filePath::testName.
                            Coverage counts a TC only when this pointer
                            resolves to a real test in the working tree
  --build-order <int>       Optional for fbs; default = max+1 within its BS
  --from-file <path>        Read body fields from a JSON file
                            (merged with CLI fields; CLI wins on conflict)
  --dry-run                 Print intended writes without executing
  --quiet                   Suppress non-error stdout
  --help                    Print this help

Code Node (cn) options:
  --path <path>             Repo-relative source path, optionally
                            #symbol-suffixed (required)
  --acs <ids>               Comma-separated AC ids this node implements
                            (may be empty - an orphan CN is legitimate)
  --deps <ids>              Comma-separated CN ids this node depends on
  --derive-deps             Assist --deps with dependency-cruiser file-level
                            analysis (dev-time only; never a runtime dep -
                            errors helpfully when the tool is not resolvable)
`;

const VALID_KINDS = new Set(['req', 'us', 'ac', 'tac', 'adr', 'fbs', 'ts', 'tc', 'cn']);
// Root-singleton kinds: created by `rcf init`, not by `rcf create`. When
// a user reaches for `rcf create prd|tad|bs|manifest`, we return a clearer
// message that points them at `rcf init` (BUG-010).
const SINGLETON_KINDS = new Set(['prd', 'tad', 'bs', 'manifest']);

/**
 * @param {string[]} argv - argv slice after `create`
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
  // BUG-009 fix: split the two distinct usage errors so the operator can
  // tell "kind missing" apart from "kind unknown". BUG-010 fix: singleton
  // kinds (prd / tad / bs / manifest) get a clarifying "use rcf init"
  // hint rather than the generic "unknown kind" line.
  if (positionals.length === 0) {
    stderr.write('[error] usage create: <kind> is required (one of req|us|ac|tac|adr|fbs|ts|tc)\n');
    stderr.write(HELP);
    return 2;
  }
  if (positionals.length > 1) {
    stderr.write(`[error] usage create: expected exactly one <kind>, got ${positionals.length}\n`);
    stderr.write(HELP);
    return 2;
  }
  const rawKind = positionals[0];
  if (SINGLETON_KINDS.has(rawKind)) {
    stderr.write(`[error] usage create: ${rawKind} is a root singleton — use \`rcf init\` to create it\n`);
    return 2;
  }
  if (!VALID_KINDS.has(rawKind)) {
    stderr.write(
      `[error] usage create: unknown kind: ${rawKind} (expected one of req|us|ac|tac|adr|fbs|ts|tc)\n`,
    );
    stderr.write(HELP);
    return 2;
  }
  const kind = rawKind;

  const projectRoot = await findProjectRoot(cwd);
  if (!projectRoot) {
    stderr.write('[error] usage no project root found (no rcf/manifest.json in this directory or any ancestor). Run `npx rcf init` to create and wire a project.\n');
    return 2;
  }

  const walkResult = await walkTree({ projectRoot });
  // B5: pre-existing tree breakage no longer blocks write verbs - the
  // write is gated on the POST-write tree state inside the writer, so
  // repairing a broken tree is possible while net-new breakage is still
  // refused.
  if (walkResult.errors.length > 0) {
    stderr.write(`[warn] tree has ${walkResult.errors.length} pre-existing issue(s); proceeding - writes are validated against the post-write state (run 'rcf validate' for details)\n`);
  }

  let fileBody = null;
  if (flags['from-file']) {
    try {
      const raw = await readFile(flags['from-file'], 'utf8');
      fileBody = JSON.parse(raw);
    } catch (err) {
      stderr.write(`[error] usage create: cannot read --from-file: ${err.message}\n`);
      return 2;
    }
  }

  const body = { ...(fileBody ?? {}) };
  // CLI wins on conflict.
  if (flags.title !== undefined) body.title = flags.title;
  if (flags.description !== undefined) body.description = flags.description;
  if (flags.purpose !== undefined) body.purpose = flags.purpose;
  if (flags['test-level'] !== undefined) body.testLevel = flags['test-level'];
  // Phase 10: `cn`'s AC cross-link field is `implementsAcIds`, not `acIds`
  // (fbs/ts share `acIds`) - --acs maps to whichever the kind expects.
  if (flags.acs !== undefined) {
    const ids = flags.acs.split(',').map((s) => s.trim()).filter(Boolean);
    if (kind === 'cn') body.implementsAcIds = ids;
    else body.acIds = ids;
  }
  if (kind === 'cn') {
    if (flags.path !== undefined) body.path = flags.path;
    if (flags.deps !== undefined) body.dependencies = flags.deps.split(',').map((s) => s.trim()).filter(Boolean);
  }

  const options = {
    id: flags.id,
    parentId: flags.parent,
    dryRun: Boolean(flags['dry-run']),
  };

  // Per-kind mandatory-title / mandatory-description checks.
  if (kind === 'ac' || kind === 'tc') {
    if (!body.description) {
      stderr.write(`[error] usage create ${kind}: --description is required\n`);
      return 2;
    }
  } else if (kind === 'cn') {
    if (!body.path) {
      stderr.write('[error] usage create cn: --path is required\n');
      return 2;
    }
    // Pre-validate the #symbol portion so the refusal names the rule and
    // the fix (paper-cut batch): the CN symbol regex admits identifier
    // characters only, so a dotted symbol like `#Store.put` fails the
    // schema pattern with an opaque message. Catch it here and teach.
    const symbolCheck = checkCnSymbolPath(body.path);
    if (!symbolCheck.ok) {
      stderr.write(`[error] usage create cn: ${symbolCheck.message}\n`);
      return 2;
    }
    // Phase 10 D5: --derive-deps assist. Optional, dev-time only, never a
    // runtime dependency - errors helpfully (exit 2) when the tool cannot
    // be resolved rather than silently degrading or reaching for the
    // network to install it.
    if (flags['derive-deps']) {
      const { file } = splitCnPath(body.path);
      const derived = await deriveFileDeps({ projectRoot, filePath: file });
      if (!derived.ok) {
        stderr.write(`[error] usage create cn: --derive-deps: ${derived.message}\n`);
        return 2;
      }
      const { cnIds, unmatched } = mapDerivedDepsToCnIds(walkResult.tree, derived.deps);
      const existing = Array.isArray(body.dependencies) ? body.dependencies : [];
      body.dependencies = [...new Set([...existing, ...cnIds])].sort();
      if (unmatched.length > 0 && !flags.quiet) {
        stdout.write(`[info] --derive-deps: ${unmatched.length} file-level import(s) have no matching CN yet, skipped: ${unmatched.join(', ')}\n`);
      }
    }
  } else if (!body.title) {
    stderr.write(`[error] usage create ${kind}: --title is required\n`);
    return 2;
  }

  if (kind === 'ts') {
    if (!body.purpose) { stderr.write('[error] usage create ts: --purpose is required\n'); return 2; }
    if (!body.testLevel) { stderr.write('[error] usage create ts: --test-level is required\n'); return 2; }
    if (!Array.isArray(body.acIds) || body.acIds.length === 0) {
      stderr.write('[error] usage create ts: --acs is required (one or more AC ids)\n');
      return 2;
    }
  }
  if (kind === 'fbs') {
    if (!Array.isArray(body.acIds) || body.acIds.length === 0) {
      stderr.write('[error] usage create fbs: --acs is required (one or more AC ids)\n');
      return 2;
    }
    if (flags['build-order'] !== undefined) {
      const n = Number(flags['build-order']);
      if (!Number.isInteger(n) || n < 1) {
        stderr.write(`[error] usage create fbs: --build-order expects a positive integer, got ${flags['build-order']}\n`);
        return 2;
      }
      options.buildOrder = n;
    }
  }
  if (kind === 'tc') {
    if (!flags.ac) { stderr.write('[error] usage create tc: --ac is required\n'); return 2; }
    // w-2026-07-28-005: a TC without a pointer is a coverage claim with
    // nothing behind it; refuse at the usage layer with the fix in hand.
    if (!flags['test-pointer']) {
      stderr.write('[error] usage create tc: --test-pointer is required (format filePath::testName; coverage counts a TC only when its pointer resolves to a real test)\n');
      return 2;
    }
    body.acId = flags.ac;
    // 0.8.0 slug-train (w-2026-07-28-012 landmine 4): deriveSlug returns ''
    // on empty derivation; TC keeps its historical 'tc' fallback locally
    // rather than letting deriveSlug bake it in.
    options.slug = flags.slug ?? (deriveSlug(body.description) || 'tc');
    options.testPointer = flags['test-pointer'];
  }

  const result = await createDocument({
    projectRoot, tree: walkResult.tree, kind, body, options, walkErrors: walkResult.errors,
  });
  if (isRcfError(result)) {
    return handleWriterError(result, stderr);
  }
  if (options.dryRun) {
    if (!flags.quiet) stdout.write(`[dry-run] would create ${result.id} at ${result.filePath}\n`);
    return 0;
  }
  if (!flags.quiet) {
    stdout.write(`${result.id} created at ${result.filePath}\n`);
  }
  // Track C+D §5.3 moment 4: on a newly-created US under a
  // shape-classified REQ, surface any baseline keys that will be OPEN
  // until the operator resolves them. The Stage-1 gate refuses build
  // on the same set; the operator sees the queue here rather than at
  // the refusal.
  if (kind === 'us') {
    try {
      const postWalk = await walkTree({ projectRoot });
      const usDoc = postWalk.tree.byId.get(result.id);
      if (usDoc) {
        const open = openCandidatesForUs(postWalk.tree, usDoc);
        if (open.length > 0 && !flags.quiet) {
          const keys = open.map((c) => c.baselineKey).join(', ');
          stdout.write(`${result.id} has ${open.length} open baseline candidate${open.length === 1 ? '' : 's'}: ${keys}\n`);
          stdout.write(`  Resolve: rcf req-baseline sweep --req ${usDoc.reqId}\n`);
        }
      }
    } catch (err) {
      stderr.write(`[warn] baseline-scan (post-create-us): ${err.message}\n`);
    }
  }

  // Track C+D §4.4: fire the classifier on newly-created REQs. Best-
  // effort: a classification error surfaces on stderr but never fails
  // the create (the REQ file was already written; classification is
  // provenance layered on top).
  if (kind === 'req') {
    try {
      const postWalk = await walkTree({ projectRoot });
      const classifyOutcome = await classifyAndPersistReq({
        projectRoot,
        tree: postWalk.tree,
        reqId: result.id,
      });
      if (classifyOutcome && classifyOutcome.ok === false) {
        stderr.write(`[warn] ${classifyOutcome.message}\n`);
      } else if (!flags.quiet && classifyOutcome?.block?.shapes?.length > 0) {
        const shapes = classifyOutcome.block.shapes.join(', ');
        stdout.write(`${result.id} shapeClassification: [${shapes}] (${classifyOutcome.block.reason})\n`);
      }
    } catch (err) {
      stderr.write(`[warn] req-classify (post-create): ${err.message}\n`);
    }
  }
  return 0;
}

const ERROR_KINDS = new Set([
  'validation',
  'missingFile',
  'brokenReference',
  'parseFailure',
  'ioFailure',
  'usage',
]);

function isRcfError(value) {
  return Boolean(value) && typeof value === 'object' && typeof value.kind === 'string'
    && ERROR_KINDS.has(value.kind) && typeof value.message === 'string';
}

/**
 * Pre-flight the CN --path against the same identity rule the schema
 * enforces (see cn.schema.json: `^[^#]+(#[A-Za-z_$][A-Za-z0-9_$]*)?$`).
 * When the symbol part carries a dot (or any other non-identifier
 * character), the schema-driven message reads as a bare pattern-mismatch
 * and buries the fix. This surfaces it: name the rule, name the fix,
 * point at the TC pointer as the right seat for method-level precision.
 *
 * @param {string} path - the --path argument
 * @returns {{ ok: true } | { ok: false, message: string }}
 */
function checkCnSymbolPath(path) {
  const hash = path.indexOf('#');
  if (hash < 0) return { ok: true };
  const symbol = path.slice(hash + 1);
  if (symbol.length === 0) {
    return {
      ok: false,
      message: `--path '${path}' has an empty #symbol suffix; drop the '#' to name the file only, or add an identifier after it (e.g. '#ClassName').`,
    };
  }
  if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(symbol)) return { ok: true };
  // The pattern rejects anything that isn't a bare identifier. The dot
  // case is by far the most common (people reach for `Class.method`), so
  // call it out explicitly; other rejections fall through to the same
  // teaching message.
  const dotted = symbol.includes('.');
  const hint = dotted
    ? `dotted symbols (like '${symbol}') are not admitted: name the class or function alone (e.g. '#${symbol.split('.')[0]}') and record method-level precision on the TC test-pointer instead`
    : `the symbol suffix admits identifier characters only (letters, digits, '_', '$'; a leading digit is not allowed)`;
  return {
    ok: false,
    message: `--path '${path}' has an invalid #symbol '${symbol}': ${hint}.`,
  };
}

function handleWriterError(err, stderr) {
  const kind = err.kind;
  // BUG-007 fix: spec §D15 mandates exit-1 emit
  // `[rcf] unexpected failure: <msg>\n<stack>` — even under --quiet.
  if (kind === 'ioFailure') {
    writeUnexpectedFailure(err, stderr);
    return 1;
  }
  stderr.write(`[error] ${kind} ${err.message}\n`);
  if (kind === 'usage') return 2;
  if (kind === 'validation' || kind === 'brokenReference') return 3;
  if (kind === 'missingFile' || kind === 'parseFailure') return 2;
  return 1;
}
