// `rcf blueprint <verb>` CLI landing.
//
// Verbs:
//   add          apply a blueprint (with optional --resolve)
//   list         projection over manifest.blueprints[]
//   remove       remove an applied blueprint
//   supersede    scaffold a project ADR + record a resolutions[] entry
//   diff         side-by-side view of applied blueprints' scope:global
//                ADRs on a topic

import { parseArgs } from 'node:util';

import { isRcfError } from '#core/errors';
import { walkTree } from '#core/store';
import { findProjectRoot } from '../view/index.js';
import {
  applyBlueprint,
  diffBlueprintTopic,
  listBlueprints,
  removeBlueprint,
  renderDiff,
  supersedeBlueprintTopic,
} from '../blueprint/index.js';
import { conflictReportJson, renderConflictReport } from '../blueprint/conflicts.js';

export const HELP = `Usage: rcf define blueprint <verb> [options]

Verbs:
  add <source>           Apply a blueprint from a source directory
                         (Phase 1: local path; the registry / git-ref
                         resolver is a Phase 2 concern). Writes an entry
                         to manifest.blueprints[] and copies namespaced
                         contributions into the tree.
  list                   List every applied blueprint (slug, version,
                         appliedAt, contributionCount).
  remove <slug>          Remove an applied blueprint. Refuses when any
                         project-authored doc references a contribution
                         id; prints the referring docs and exits 3.
  supersede <topic> [--incoming <source>]
                         Author a project-level ADR that supersedes the
                         conflict pair on <topic> (one applied blueprint
                         ADR + one incoming blueprint ADR named via
                         --incoming <source>), and record a
                         manifest.resolutions[] entry so the conflict
                         detector honours the resolution when the
                         operator re-runs \`rcf define blueprint add <source>\`.
                         --incoming is required when the topic has fewer
                         than two applied scope:global ADRs (the
                         refused-add state) and is silently accepted
                         when already >= 2 are applied. Both blueprint
                         ADRs co-reside on disk as superseded history.
  diff <topic>           Side-by-side view of every applied blueprint's
                         scope:global ADR on <topic>: id, path, title,
                         status, decision. Read-only.

Options:
  --namespace <slug>     Override the blueprint's default namespace
                         (defaults to the blueprint's slug).
  --resolve <t=project:ADR-id>
                         (add only) Declare a resolution on this add.
                         Repeatable per conflicted topic. Records a
                         manifest.resolutions[] entry before conflict
                         detection runs, so a would-be conflict on the
                         topic is honoured. resolvedByAdrId must be a
                         well-formed ADR id; the referenced ADR should
                         already exist on the project (this verb does
                         not scaffold one -- use \`supersede\` for that).
  --reason <text>        (supersede, add --resolve) Optional operator
                         note attached to the manifest.resolutions[]
                         record.
  --json                 (add only) Emit the result (or conflict
                         report) as a machine-readable JSON object.
                         Exit code is unchanged (0 on apply, 3 on
                         conflict).
  --dry-run              Print intended writes without executing.
  --quiet                Suppress non-error stdout.
  --help                 Print this help.

Composition and namespacing:

  Blueprint-contributed doc ids are namespaced by the blueprint's slug.
  REQ / US / PRD / BS / TAD / TS: slug PREFIX (spa-REQ-001).
  ADR / TAC / FBS / CN: slug SUFFIX (ADR-005-spa).
  Two blueprints both contributing a scope:global ADR on the same topic
  is a genuine conflict: rcf define blueprint add refuses and prints both
  sides, plus four resolution paths (adopt incoming, keep existing,
  supersede via project ADR, or declare on the add itself via
  --resolve).
`;

const OPTION_SPEC = {
  namespace: { type: 'string' },
  resolve: { type: 'string', multiple: true },
  reason: { type: 'string' },
  incoming: { type: 'string' },
  json: { type: 'boolean' },
  'dry-run': { type: 'boolean' },
  quiet: { type: 'boolean' },
  help: { type: 'boolean' },
};

/**
 * @param {string[]} argv - argv slice after `blueprint`
 * @param {object} [deps]
 * @returns {Promise<number>}
 */
export async function main(argv, deps = {}) {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  const cwd = deps.cwd ?? process.cwd();
  const now = deps.now ?? new Date();

  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: OPTION_SPEC, allowPositionals: true, strict: true });
  } catch (err) {
    stderr.write(`[error] ${err.message}\n`);
    stderr.write(HELP);
    return 2;
  }
  if (parsed.values.help || parsed.positionals.length === 0) {
    stdout.write(HELP);
    return 0;
  }
  const verb = parsed.positionals[0];
  const rest = parsed.positionals.slice(1);

  const projectRoot = await findProjectRoot(cwd);
  if (!projectRoot) {
    stderr.write('[error] no rcf/ tree found in this directory or any ancestor.\n');
    return 2;
  }
  const { tree, errors } = await walkTree({ projectRoot });
  if (errors.length > 0 && verb !== 'list') {
    // Tree errors are non-fatal for list; every other verb needs a clean tree.
    for (const e of errors) stderr.write(`[tree] ${e.kind}: ${e.message}\n`);
    return 2;
  }

  if (verb === 'add') {
    if (rest.length === 0) {
      stderr.write('[error] blueprint add: missing <source>\n');
      return 2;
    }
    const source = rest[0];
    const resolveDeclarations = parseResolveOptions(parsed.values.resolve, parsed.values.reason);
    if (resolveDeclarations.error) {
      stderr.write(`[error] blueprint add: ${resolveDeclarations.error}\n`);
      return 2;
    }
    const result = await applyBlueprint({
      projectRoot, tree, source,
      namespaceOverride: parsed.values.namespace,
      resolveDeclarations: resolveDeclarations.value,
      now,
      dryRun: parsed.values['dry-run'] === true,
    });
    // Surface any writer-side warnings (currently only
    // duplicate-topic --resolve dedupe). Warnings do not change the
    // exit code; they land on stderr so the human sees them alongside
    // the applied line on stdout.
    if (result && !isRcfError(result) && Array.isArray(result.warnings)) {
      for (const w of result.warnings) {
        if (w.kind === 'duplicateResolveTopic' && Array.isArray(w.topics)) {
          for (const t of w.topics) {
            stderr.write(`[warn] blueprint add: duplicate --resolve for topic '${t}'; keeping the first declaration only.\n`);
          }
        }
      }
    }
    if (isRcfError(result)) {
      if (parsed.values.json) {
        stderr.write(`${JSON.stringify({ refused: true, error: { kind: result.kind, message: result.message } })}\n`);
      } else {
        stderr.write(`[error] blueprint add: ${result.message}\n`);
      }
      return 2;
    }
    if (result.conflicts && result.conflicts.length > 0) {
      if (parsed.values.json) {
        stdout.write(`${JSON.stringify(conflictReportJson(result.conflicts), null, 2)}\n`);
      } else {
        stderr.write(renderConflictReport(result.conflicts));
      }
      return 3;
    }
    if (parsed.values.json) {
      stdout.write(`${JSON.stringify({
        refused: false,
        applied: result.applied === true,
        alreadyApplied: result.alreadyApplied === true,
        slug: result.slug,
        version: result.version,
        contributionCount: Array.isArray(result.contributions) ? result.contributions.length : 0,
      })}\n`);
      return 0;
    }
    if (result.alreadyApplied) {
      if (!parsed.values.quiet) stdout.write(`[blueprint] '${result.slug}' already applied at ${result.version}; no changes.\n`);
      return 0;
    }
    if (!parsed.values.quiet) {
      stdout.write(`[blueprint] applied '${result.slug}' at ${result.version} (${result.contributions.length} contribution(s)).\n`);
    }
    return 0;
  }

  if (verb === 'list') {
    const rows = listBlueprints(tree);
    if (rows.length === 0) {
      if (!parsed.values.quiet) stdout.write('[blueprint] no blueprints applied on this project.\n');
      return 0;
    }
    for (const row of rows) {
      stdout.write(`${row.slug}\t${row.version}\t${row.appliedAt}\t${row.contributionCount} contribution(s)\n`);
    }
    return 0;
  }

  if (verb === 'remove') {
    if (rest.length === 0) {
      stderr.write('[error] blueprint remove: missing <slug>\n');
      return 2;
    }
    const slug = rest[0];
    const result = await removeBlueprint({
      projectRoot, tree, slug, dryRun: parsed.values['dry-run'] === true,
    });
    if (isRcfError(result)) {
      stderr.write(`[error] blueprint remove: ${result.message}\n`);
      return 2;
    }
    if (!result.removed) {
      stderr.write(`[blueprint] remove refused: ${result.referringDocs.length} referring doc(s):\n`);
      for (const r of result.referringDocs) {
        stderr.write(`  ${r.docId} references ${r.matchedId}\n`);
      }
      stderr.write('resolve by unbinding the references, then re-run.\n');
      return 3;
    }
    if (!parsed.values.quiet) stdout.write(`[blueprint] removed '${result.slug}' (${result.deletedPaths.length} file(s) deleted).\n`);
    return 0;
  }

  if (verb === 'supersede') {
    if (rest.length === 0) {
      stderr.write('[error] blueprint supersede: missing <topic>\n');
      return 2;
    }
    const topic = rest[0];
    const result = await supersedeBlueprintTopic({
      projectRoot, tree, topic,
      incomingSource: parsed.values.incoming,
      now,
      dryRun: parsed.values['dry-run'] === true,
      reason: parsed.values.reason,
    });
    if (isRcfError(result)) {
      stderr.write(`[error] blueprint supersede: ${result.message}\n`);
      return 2;
    }
    if (!parsed.values.quiet) {
      stdout.write(`[blueprint] superseded topic '${result.topic}' via ${result.resolvedByAdrId} at ${result.resolvedByAdrPath}.\n`);
      stdout.write(`[blueprint] resolution recorded as ${result.resolutionId}; superseded: ${result.supersedes.map((s) => `${s.adrId} (blueprint ${s.slug})`).join(', ')}.\n`);
      stdout.write(`[blueprint] edit ${result.resolvedByAdrPath} to fill out the operator's ruling context / decision / consequences.\n`);
    }
    return 0;
  }

  if (verb === 'diff') {
    if (rest.length === 0) {
      stderr.write('[error] blueprint diff: missing <topic>\n');
      return 2;
    }
    const topic = rest[0];
    const result = diffBlueprintTopic({ tree, topic });
    stdout.write(renderDiff(result));
    return 0;
  }

  stderr.write(`[error] blueprint: unknown verb '${verb}'\n`);
  stderr.write(HELP);
  return 2;
}

/**
 * Parse `--resolve <topic>=project:<ADR-id>` occurrences into a list
 * of declarations, attaching an optional shared `reason` (from the
 * single `--reason` flag) to every declaration on this add. Returns
 * `{ value: Array }` on success or `{ error: string }` on any
 * mis-shaped input.
 *
 * The `--reason` flag is singular per invocation because a single
 * add's resolutions typically share one operator justification
 * (`--reason "Project auth model stands over both blueprint
 * defaults."`); if per-topic reasons are needed later, the flag can
 * grow a `--reason <topic>=<text>` shape without breaking this call
 * shape.
 */
function parseResolveOptions(rawList, reason) {
  if (!Array.isArray(rawList) || rawList.length === 0) return { value: [] };
  const trimmedReason = typeof reason === 'string' ? reason : undefined;
  const out = [];
  for (const raw of rawList) {
    if (typeof raw !== 'string' || raw.length === 0) {
      return { error: `--resolve expects <topic>=project:<ADR-id>, got '${raw}'` };
    }
    const eq = raw.indexOf('=');
    if (eq === -1) {
      return { error: `--resolve expects <topic>=project:<ADR-id>, got '${raw}' (missing '=')` };
    }
    const topic = raw.slice(0, eq);
    const rhs = raw.slice(eq + 1);
    if (topic.length === 0) return { error: `--resolve expects a topic before '=', got '${raw}'` };
    if (!rhs.startsWith('project:')) {
      return { error: `--resolve rhs must start with 'project:' (that is the currently supported resolution target), got '${rhs}'` };
    }
    const adrId = rhs.slice('project:'.length);
    if (adrId.length === 0) return { error: `--resolve resolvedByAdrId is empty for topic '${topic}'` };
    const decl = { topic, resolvedByAdrId: adrId };
    if (trimmedReason !== undefined) decl.reason = trimmedReason;
    out.push(decl);
  }
  return { value: out };
}
