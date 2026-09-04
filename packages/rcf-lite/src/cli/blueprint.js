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
  enrichRowsWithCategories,
  groupRowsByCategory,
  listBlueprints,
  loadBlueprint,
  removeBlueprint,
  removeResolution,
  renderDiff,
  resolveBlueprintSource,
  supersedeBlueprintTopic,
  readCompanionsFile,
  setCompanionPin,
  unsetCompanionPin,
  resolveCompanions,
  renderCompanionLines,
  renderAmbiguousLibraryRefusal,
  enumerateShelfProviders,
  enumerateLibraryProviders,
} from '../blueprint/index.js';
import { conflictReportJson, renderConflictReport } from '../blueprint/conflicts.js';
import { handleLibraryVerb, LIBRARY_HELP } from './blueprint-library.js';

export const HELP = `Usage: rcf define blueprint <verb> [options]

Verbs:
  add <source>           Apply a blueprint from a source directory.
                         <source> resolves in this order:
                           - a path (./foo, /abs, has a slash) is used as-is;
                           - @stock/<slug> resolves to the packaged shelf that
                             ships with rcf-lite (recommended long form);
                           - a bare kebab slug (deploy-cloudflare-workers,
                             application-spa) resolves to the same shelf;
                           - any other @<library>/<slug> is reserved for the
                             phase-2 external-libraries mechanism and refuses.
                         Writes an entry to manifest.blueprints[] and copies
                         namespaced contributions into the tree.
  list                   List every applied blueprint (slug, version,
                         appliedAt, contributionCount), grouped by the
                         \`category\` declared on each blueprint's own
                         \`blueprint.json\`. Blueprints whose source no
                         longer resolves, or whose source declares no
                         category, appear under \`uncategorised\`.
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
  remove-resolution <adr-id>
                         Remove a single manifest.resolutions[] entry by
                         its resolvedByAdrId (the id the doctor's
                         probe-path-owner check names when a historical
                         resolution has become redundant after a
                         blueprint upgrade). Writes nothing else: the
                         project-level ADR file at rcf/adrs/<adr-id>.json
                         is left in place as historical context. Refuses
                         exit 2 when <adr-id> is malformed or names no
                         ADR on the project tree. Idempotent on re-run:
                         when <adr-id> is a well-formed ADR id that
                         names an ADR present on the tree but is no
                         longer on any resolutions[] entry, prints
                         "nothing to remove" and exits 0.
  companions <slug>      Print the resolved companion set for the
                         named applied service blueprint. Reads its
                         source blueprint.json's suggestedCompanions[],
                         walks the deterministic tier ladder (applied
                         > registered library > core shelf, with
                         rcf/companions.json pin overriding library +
                         shelf), and prints one line per role. Refuses
                         exit 3 when two or more registered libraries
                         provide the same role with no pin. \`--json\`
                         emits a machine-readable envelope.
  companions set <role> <slug>
                         Write a project-level pin to rcf/companions.json
                         under roles.<role>.provider. <slug> accepts
                         \`<libraryPrefix>:<slug>\` for a library provider
                         or a bare kebab slug for a shelf provider.
                         Refuses exit 2 when the named provider does
                         not declare providesRoles containing <role>.
  companions unset <role>
                         Remove a pin from rcf/companions.json. Refuses
                         exit 2 when no pin exists for <role>.
  library <verb>         Manage external blueprint libraries. Sub-verbs:
                         add, list, remove, refresh. See
                         'rcf define blueprint library --help' for the
                         full surface. Phase 2b covers local sources;
                         network fetchers land in Phase 2c.

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
  --companion <role>=<slug>
                         (add only, repeatable) Pin a companion
                         provider at apply time; writes the pin to
                         rcf/companions.json (schemaVersion 1, current
                         pin per role) with pinnedAt. <slug> is
                         \`<libraryPrefix>:<slug>\` for a library
                         provider or a bare kebab slug for a shelf
                         provider. Refuses exit 2 when the named
                         provider does not declare providesRoles
                         containing <role>.
  --no-companion-suggestions
                         (add only) Suppress both the --companion pin
                         phase and the post-apply resolved suggestion
                         block; every other apply behaviour is
                         unchanged.
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
  // library-verb flags (parsed centrally so strict:true doesn't refuse
  // them when the operator types `rcf define blueprint library add`).
  prefix: { type: 'string' },
  sha256: { type: 'string' },
  'i-have-reviewed': { type: 'boolean' },
  'no-review': { type: 'boolean' },
  json: { type: 'boolean' },
  'dry-run': { type: 'boolean' },
  quiet: { type: 'boolean' },
  help: { type: 'boolean' },
  // Companion-suggestion mechanism (core-companions spec section 2).
  companion: { type: 'string', multiple: true },
  'no-companion-suggestions': { type: 'boolean' },
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
  const firstPositional = parsed.positionals[0];
  // `rcf define blueprint library --help` routes into the library
  // handler so the sub-verb HELP block is what the operator sees.
  // Every other --help (and empty argv) prints the top-level HELP.
  if (firstPositional !== 'library' && (parsed.values.help || parsed.positionals.length === 0)) {
    stdout.write(HELP);
    return 0;
  }
  const verb = parsed.positionals[0];
  const rest = parsed.positionals.slice(1);

  // `library` sub-verbs manage the external-library registry; they
  // never walk the RCF tree, and delegating early keeps the option
  // parser from consuming `--i-have-reviewed` (a library-add-only flag)
  // against a `library` add invocation.
  if (verb === 'library') {
    return handleLibraryVerb(parsed, rest, { stdout, stderr, cwd, now, stdin: deps.stdin });
  }

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
    const rawSource = rest[0];
    const resolved = await resolveBlueprintSource(rawSource, { projectRoot });
    if (isRcfError(resolved)) {
      if (parsed.values.json) {
        stderr.write(`${JSON.stringify({ refused: true, error: { kind: resolved.kind, message: resolved.message } })}\n`);
      } else {
        stderr.write(`[error] blueprint add: ${resolved.message}\n`);
      }
      return 2;
    }
    // Feed the resolved absolute path to the applier. The original
    // typed source is preserved on the CLI for the conflict renderer's
    // supersede hint (so the operator sees exactly the string they can
    // copy back into a fresh shell). It is ONLY forwarded to the applier
    // as `displaySource` for library-qualified resolves - spec §5.3
    // requires the qualified typed ref (`wsd:auth-oauth2`) to be the
    // record's `source`. For shelf and path resolves the record must
    // carry the RESOLVED ABSOLUTE PATH, which is the pre-#120 behaviour
    // that /scope.json and `blueprint list --category` both depend on
    // to load the shipping source file (integration review d-2026-08-31-046).
    const source = resolved.resolved;
    const resolveDeclarations = parseResolveOptions(parsed.values.resolve, parsed.values.reason);
    if (resolveDeclarations.error) {
      stderr.write(`[error] blueprint add: ${resolveDeclarations.error}\n`);
      return 2;
    }
    // Pre-flight --companion selectors (core-companions spec section
    // 5). Validate BEFORE the apply so a bad selector refuses without
    // side effects (the pin write and the applied contributions both
    // stay untouched). --no-companion-suggestions suppresses the
    // pre-flight too.
    const companionSelectorsPre = parseCompanionOptions(parsed.values.companion);
    if (companionSelectorsPre.error) {
      stderr.write(`[error] blueprint add: ${companionSelectorsPre.error}\n`);
      return 2;
    }
    if (!parsed.values['no-companion-suggestions']) {
      for (const sel of companionSelectorsPre.value) {
        const providerCheck = await validateCompanionProvider({ selector: sel, projectRoot, tree });
        if (providerCheck.error) {
          stderr.write(`[error] blueprint add: ${providerCheck.error}\n`);
          return 2;
        }
      }
    }
    const result = await applyBlueprint({
      projectRoot, tree, source,
      namespaceOverride: parsed.values.namespace,
      // Library-qualified resolves rewire the applied identity under
      // the library prefix and forward the library's declared bands
      // for the apply-time gate (spec §5.3, §8.3). The qualified typed
      // ref is passed as `displaySource` so the applied record's
      // `source` field carries it verbatim (spec §5.3). The library
      // prefix is stamped onto the applied record so the ownership
      // fact for `rcf library remove` lives on the record itself
      // rather than being re-derived by string-matching `source`.
      ...(resolved.kind === 'library' ? {
        displaySource: resolved.original,
        effectiveSlug: resolved.effectiveSlug,
        libraryPrefix: resolved.libraryPrefix,
        libraryBands: resolved.libraryBands,
      } : {}),
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
    // Companion-suggestion mechanism (spec 2.6). Runs AFTER the apply
    // writes so a failed apply never produces a suggestion block.
    // Composed of two phases: (a) --companion selectors record pins to
    // rcf/companions.json (spec 2.4); (b) print the resolved
    // suggestion block using the current tree + pins + libraries + shelf.
    // Both phases are suppressed by --no-companion-suggestions.
    if (!parsed.values['no-companion-suggestions']) {
      // Re-walk the tree so applied writes are visible to the resolver.
      const { tree: postTree } = await walkTree({ projectRoot });
      // Phase (a): --companion selectors. Pre-flight validated the
      // shape and provider gate before the apply; here we only write
      // the pins.
      for (const sel of companionSelectorsPre.value) {
        const pinRes = await setCompanionPin({ projectRoot, role: sel.role, provider: sel.provider, now });
        if (pinRes.kind) {
          stderr.write(`[error] blueprint add: ${pinRes.message}\n`);
          return 2;
        }
        if (pinRes.previousProvider && pinRes.previousProvider !== sel.provider) {
          stderr.write(`[blueprint] companion pin for role '${sel.role}' updated: '${pinRes.previousProvider}' -> '${sel.provider}'\n`);
        }
      }
      // Phase (b): print the resolved suggestion block for the just-
      // applied service blueprint. Skipped if the applied blueprint
      // declared no suggestedCompanions[].
      if (Array.isArray(result.suggestedCompanions) && result.suggestedCompanions.length > 0) {
        const pins = await readCompanionsFile(projectRoot);
        const pinsClean = pins && pins.kind ? null : pins;
        const resolved = await resolveCompanions({
          projectRoot,
          tree: postTree,
          suggestedCompanions: result.suggestedCompanions,
          pins: pinsClean,
        });
        // Surface ambiguous refusal as a hard exit-3 (spec 2.4).
        const ambiguous = resolved.find((r) => r.origin === 'ambiguousLibraries');
        if (ambiguous) {
          stderr.write(renderAmbiguousLibraryRefusal({
            role: ambiguous.role,
            providers: ambiguous.ambiguousProviders,
            serviceSlug: result.slug,
          }));
          return 3;
        }
        if (!parsed.values.quiet) {
          stdout.write(`\nSuggested companions this blueprint recommends alongside it:\n`);
          stdout.write(`${renderCompanionLines(resolved)}\n`);
          stdout.write(`Apply either with: rcf define blueprint add <slug>\n`);
        }
      }
    }
    return 0;
  }

  if (verb === 'list') {
    const rows = listBlueprints(tree);
    if (rows.length === 0) {
      if (!parsed.values.quiet) stdout.write('[blueprint] no blueprints applied on this project.\n');
      return 0;
    }
    // Enrich with category from each applied blueprint's source. The
    // manifest schema does not carry category (additionalProperties:
    // false on appliedBlueprintRecord), so the enricher re-loads each
    // source's blueprint.json at list time; a source that no longer
    // resolves surfaces under the `uncategorised` group rather than
    // being dropped.
    const enriched = await enrichRowsWithCategories(rows, { projectRoot });
    const groups = groupRowsByCategory(enriched);
    let first = true;
    for (const group of groups) {
      const label = group.category ?? 'uncategorised';
      if (!first) stdout.write('\n');
      first = false;
      stdout.write(`# ${label}\n`);
      for (const row of group.rows) {
        stdout.write(`${row.slug}\t${row.version}\t${row.appliedAt}\t${row.contributionCount} contribution(s)\n`);
      }
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

  if (verb === 'remove-resolution') {
    if (rest.length === 0) {
      stderr.write('[error] blueprint remove-resolution: missing <adr-id>\n');
      return 2;
    }
    const adrId = rest[0];
    const result = await removeResolution({
      projectRoot, tree, resolvedByAdrId: adrId,
      dryRun: parsed.values['dry-run'] === true,
    });
    if (isRcfError(result)) {
      stderr.write(`[error] blueprint remove-resolution: ${result.message}\n`);
      return 2;
    }
    if (result.alreadyAbsent) {
      if (!parsed.values.quiet) stdout.write(`[blueprint] nothing to remove: '${adrId}' is not on manifest.resolutions[].\n`);
      return 0;
    }
    if (!parsed.values.quiet) {
      const topicSuffix = result.topic ? ` (topic '${result.topic}')` : '';
      const idSuffix = result.resolutionId ? `; dropped resolution ${result.resolutionId}` : '';
      stdout.write(`[blueprint] removed resolution for '${adrId}'${topicSuffix}${idSuffix}.\n`);
    }
    return 0;
  }

  if (verb === 'companions') {
    return handleCompanionsVerb({
      rest,
      parsed,
      projectRoot,
      tree,
      now,
      stdout,
      stderr,
    });
  }

  stderr.write(`[error] blueprint: unknown verb '${verb}'\n`);
  stderr.write(HELP);
  return 2;
}

/**
 * Parse `--companion <role>=<providerSlug>` occurrences. Slug accepts
 * either `<libraryPrefix>:<slug>` for a library-qualified provider or a
 * bare kebab slug for a shelf provider. Returns { value: [{role,
 * provider}] } on success or { error: string }.
 */
function parseCompanionOptions(rawList) {
  if (!Array.isArray(rawList) || rawList.length === 0) return { value: [] };
  const out = [];
  for (const raw of rawList) {
    if (typeof raw !== 'string' || raw.length === 0) {
      return { error: `--companion expects <role>=<slug>, got '${raw}'` };
    }
    const eq = raw.indexOf('=');
    if (eq === -1) {
      return { error: `--companion expects <role>=<slug>, got '${raw}' (missing '=')` };
    }
    const role = raw.slice(0, eq);
    const provider = raw.slice(eq + 1);
    if (!/^[a-z][a-zA-Z0-9]*$/.test(role)) {
      return { error: `--companion role '${role}' is not lower camelCase (^[a-z][a-zA-Z0-9]*$).` };
    }
    if (provider.length === 0) {
      return { error: `--companion provider slug is empty for role '${role}'` };
    }
    out.push({ role, provider });
  }
  return { value: out };
}

/**
 * Validate a --companion selector: locate the named provider blueprint
 * (library-qualified or shelf), load it, and refuse when its
 * `providesRoles[]` does not contain the requested role. Message shape
 * per spec 5.
 */
async function validateCompanionProvider({ selector, projectRoot, tree }) {
  const { role, provider } = selector;
  // Applied?
  const applied = (tree?.manifest?.blueprints ?? []).find((bp) => bp.slug === provider);
  if (applied && typeof applied.source === 'string' && !applied.source.includes(':')) {
    const bp = await loadBlueprint(applied.source);
    if (bp.kind) return { error: `--companion ${role}=${provider}: source blueprint failed to load: ${bp.message}` };
    if (Array.isArray(bp.providesRoles) && bp.providesRoles.includes(role)) return { ok: true };
    return { error: `--companion ${role}=${provider}: blueprint '${provider}' does not declare providesRoles containing '${role}'.` };
  }
  // Library-qualified?
  if (provider.includes(':')) {
    const libraries = await enumerateLibraryProviders({ projectRoot, role });
    if (libraries.some((l) => `${l.libraryPrefix}:${l.slug}` === provider)) return { ok: true };
    // Additional diagnostic: check if the library exists but the blueprint does not declare the role
    return { error: `--companion ${role}=${provider}: blueprint '${provider}' does not declare providesRoles containing '${role}'.` };
  }
  // Shelf?
  const shelfProviders = await enumerateShelfProviders(role);
  if (shelfProviders.includes(provider)) return { ok: true };
  return { error: `--companion ${role}=${provider}: blueprint '${provider}' does not declare providesRoles containing '${role}'.` };
}

/**
 * `rcf define blueprint companions <slug>|set|unset` sub-verb
 * dispatcher (spec 2.5). Read-only against the blueprint tree; set /
 * unset only touch rcf/companions.json.
 */
async function handleCompanionsVerb({ rest, parsed, projectRoot, tree, now, stdout, stderr }) {
  const asJson = parsed.values.json === true;
  const quiet = parsed.values.quiet === true;
  if (rest.length === 0) {
    stderr.write('[error] blueprint companions: missing <slug> or sub-verb (set|unset)\n');
    return 2;
  }
  const head = rest[0];
  // set / unset sub-verbs.
  if (head === 'set') {
    if (rest.length < 3) {
      stderr.write('[error] blueprint companions set: expected <role> <slug>\n');
      return 2;
    }
    const role = rest[1];
    const provider = rest[2];
    const validation = await validateCompanionProvider({ selector: { role, provider }, projectRoot, tree });
    if (validation.error) {
      stderr.write(`[error] blueprint companions set: ${validation.error}\n`);
      return 2;
    }
    const res = await setCompanionPin({ projectRoot, role, provider, now });
    if (res.kind) {
      stderr.write(`[error] blueprint companions set: ${res.message}\n`);
      return 2;
    }
    if (asJson) {
      stdout.write(`${JSON.stringify({ ok: true, role, provider, previousProvider: res.previousProvider, pinnedAt: now.toISOString() })}\n`);
    } else if (!quiet) {
      if (res.previousProvider && res.previousProvider !== provider) {
        stdout.write(`[blueprint] companion pin for role '${role}' updated: '${res.previousProvider}' -> '${provider}'\n`);
      } else {
        stdout.write(`[blueprint] companion pin for role '${role}' set to '${provider}'\n`);
      }
    }
    return 0;
  }
  if (head === 'unset') {
    if (rest.length < 2) {
      stderr.write('[error] blueprint companions unset: expected <role>\n');
      return 2;
    }
    const role = rest[1];
    const res = await unsetCompanionPin({ projectRoot, role });
    if (res.kind) {
      stderr.write(`[error] blueprint companions unset: ${res.message}\n`);
      return 2;
    }
    if (asJson) {
      stdout.write(`${JSON.stringify({ ok: true, role, removed: true })}\n`);
    } else if (!quiet) {
      stdout.write(`[blueprint] companion pin for role '${role}' removed\n`);
    }
    return 0;
  }
  // <slug> form: print the resolved companion set for an applied
  // service blueprint (spec 2.5 first form).
  const slug = head;
  const applied = (tree?.manifest?.blueprints ?? []).find((bp) => bp.slug === slug);
  if (!applied) {
    stderr.write(`[error] blueprint companions: no applied blueprint with slug '${slug}' on this project.\n`);
    return 2;
  }
  if (typeof applied.source !== 'string' || applied.source.length === 0) {
    stderr.write(`[error] blueprint companions: applied blueprint '${slug}' has no readable source.\n`);
    return 2;
  }
  if (applied.source.includes(':') && !applied.source.startsWith('/')) {
    stderr.write(`[error] blueprint companions: applied blueprint '${slug}' has a library-qualified source '${applied.source}' the companions reader cannot resolve directly; refresh the library and retry, or supply the source path.\n`);
    return 2;
  }
  const bp = await loadBlueprint(applied.source);
  if (bp.kind) {
    stderr.write(`[error] blueprint companions: applied blueprint '${slug}' source failed to load: ${bp.message}\n`);
    return 2;
  }
  if (!Array.isArray(bp.suggestedCompanions) || bp.suggestedCompanions.length === 0) {
    stderr.write(`[error] blueprint companions: applied blueprint '${slug}' declares no suggestedCompanions[].\n`);
    return 2;
  }
  const pins = await readCompanionsFile(projectRoot);
  const pinsClean = pins && pins.kind ? null : pins;
  const resolved = await resolveCompanions({
    projectRoot,
    tree,
    suggestedCompanions: bp.suggestedCompanions,
    pins: pinsClean,
  });
  const ambiguous = resolved.find((r) => r.origin === 'ambiguousLibraries');
  if (ambiguous && !asJson) {
    stderr.write(renderAmbiguousLibraryRefusal({
      role: ambiguous.role,
      providers: ambiguous.ambiguousProviders,
      serviceSlug: slug,
    }));
    return 3;
  }
  if (asJson) {
    stdout.write(`${JSON.stringify({
      slug,
      suggestions: resolved.map((r) => ({
        role: r.role,
        reason: r.reason,
        provider: r.provider,
        origin: r.origin,
        notes: r.notes,
        ...(r.ambiguousProviders ? { ambiguousProviders: r.ambiguousProviders } : {}),
      })),
    }, null, 2)}\n`);
    return ambiguous ? 3 : 0;
  }
  stdout.write(`${slug} suggests companions:\n`);
  stdout.write(`${renderCompanionLines(resolved)}\n`);
  return 0;
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
