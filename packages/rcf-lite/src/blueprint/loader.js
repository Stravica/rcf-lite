// Blueprint loader. Phase 1 keeps the loader local: a blueprint source
// is a filesystem directory containing a `blueprint.json` metadata file
// plus a `contributions/` subdirectory. The metadata declares the
// blueprint's slug, version, and every contribution's { id, kind, path
// (relative to contributions/) }. ADR contributions may carry a
// `scope: 'global'` tag plus a `topic` string; these are the only
// contributions the conflict detector reasons about.
//
// The registry / git-ref resolver is a Phase 2 concern (application-spa and application-api-rest
// blueprints ship as npm packages); this loader intentionally has no
// network path so tests are hermetic.

import { readFile, stat } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';

import { rcfError } from '../core/errors/index.js';

// Contribution kinds a blueprint MAY carry. The RCF hierarchy is composed
// downward: a blueprint contributes REQuirements, UserStories, TACs and
// ADRs (plus their supporting FBS / TS / CN artefacts written by later
// phases). PRDs, TADs and the Build Sequence are project-level singletons
// -- one PRD per project, one TAD per project, one BS per project -- so
// no blueprint gets to own them. FBS is excluded by ratified principle
// (composition happens at the requirements layer, not the build layer).
const CONTRIBUTABLE_KINDS = new Set(['req', 'us', 'tac', 'adr', 'ts', 'cn']);
const ROOT_SINGLETON_KINDS = new Set(['prd', 'tad', 'bs']);
const EXCLUDED_KINDS = new Set(['fbs']);

// Role name grammar for providesRoles[] and suggestedCompanions[].role.
// Lower camelCase: starts with a lowercase letter, contains only letters
// and digits, no separators. Same shape as global-topic strings by
// design (a role name IS the topic name the paired ADR claims, per
// core-companions spec section 2.2), so `providesRoles: ["logging"]`
// and the ADR contribution `{"scope":"global","topic":"logging"}`
// co-locate the two facts on one string.
const ROLE_NAME_RE = /^[a-z][a-zA-Z0-9]*$/;

// Em-dash sentinel + emoji-ish detection for the suggestedCompanions
// reason string, per the estate-wide banned-tells baseline. Em-dash
// (U+2014) is refused outright; emojis approximated by a broad
// symbols / pictographs range. Reason is operator-facing prose, so the
// same discipline that applies to READMEs and guides applies here.
// Refused shapes surface as a validation rcfError before apply.
const EM_DASH = /—/;
const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F2FF}]/u;

/**
 * @typedef {object} BlueprintContribution
 * @property {string} id           canonical id (bare or already namespaced)
 * @property {'prd'|'req'|'us'|'tad'|'tac'|'adr'|'bs'|'fbs'|'ts'|'cn'} kind
 * @property {string} path         relative to the blueprint's contributions/
 * @property {'global'} [scope]    ADR only; marks whole-project decisions
 * @property {string}   [topic]    ADR only when scope=global; conflict key
 * @property {boolean}  [recommendedDefault] ADR only. Standards-derived
 *                                  discipline (spec 3.2): marks a SHOULD
 *                                  clause, or a choice-shaped MUST per
 *                                  amendment A2 (Baz 2026-09-04T12:20:31Z).
 * @property {boolean}  [elicited] ADR only. Marks a MAY clause: the
 *                                  applying operator supplies the value
 *                                  at apply.
 * @property {string}   [standardsTraceClause] ADR only. Standard clause
 *                                  identifier verbatim (`WSD-001 clause 3.1`,
 *                                  `RFC 7807 section 3.1`) or the sentinel
 *                                  `"generic enterprise practice"`. Required
 *                                  on every ADR contribution when the
 *                                  blueprint declares standardsTrace[].
 */

/**
 * @typedef {object} SuggestedCompanion
 * @property {string} role     lower camelCase role name
 * @property {string} reason   one-sentence operator-facing reason string
 *                             (no em-dashes, no emojis)
 */

/**
 * @typedef {object} StandardsTraceEntry
 * @property {string} id       standard identifier (e.g. `WSD-001`)
 * @property {string} version  standard version (free-form)
 */

/**
 * @typedef {object} LoadedBlueprint
 * @property {string} slug
 * @property {string} version
 * @property {string} source        source directory (absolute)
 * @property {string} [category]    optional shelf-grouping tag; kebab slug.
 *                                  Read by `rcf define blueprint list` and by
 *                                  the docs blueprint shelf to group entries.
 *                                  The starter vocabulary (`application`,
 *                                  `security`, `email`, `deploy`, `delivery`,
 *                                  `persistence`, `observability`) lives in
 *                                  the authoring standard; the loader
 *                                  validates the shape (kebab slug), not the
 *                                  vocabulary, so a new category can be
 *                                  minted by adding it to the standard
 *                                  without a code change.
 * @property {string[]} [providesRoles]        core-companions spec 2.1
 * @property {SuggestedCompanion[]} [suggestedCompanions] core-companions spec 2.1
 * @property {StandardsTraceEntry[]} [standardsTrace] standards-derived
 *                                  discipline (spec 3.2). When set, every
 *                                  ADR contribution MUST carry a non-null
 *                                  standardsTraceClause.
 * @property {BlueprintContribution[]} contributions
 */

/**
 * Load a blueprint's metadata from a directory containing blueprint.json.
 *
 * @param {string} source - path to the blueprint's root directory
 * @returns {Promise<LoadedBlueprint | import('../core/errors/index.js').RcfError>}
 */
export async function loadBlueprint(source) {
  const root = resolve(source);
  const metaPath = join(root, 'blueprint.json');
  try {
    await stat(metaPath);
  } catch (err) {
    if (err.code === 'ENOENT') {
      return rcfError({
        kind: 'usage',
        message: `blueprint: no blueprint.json found at ${metaPath}`,
        filePath: metaPath,
      });
    }
    return rcfError({ kind: 'ioFailure', message: `blueprint: ${err.message}`, filePath: metaPath });
  }
  let raw;
  try {
    raw = await readFile(metaPath, 'utf8');
  } catch (err) {
    return rcfError({ kind: 'ioFailure', message: `blueprint: read failed: ${err.message}`, filePath: metaPath });
  }
  let doc;
  try {
    doc = JSON.parse(raw);
  } catch (err) {
    return rcfError({ kind: 'parseFailure', message: `blueprint: JSON parse failed: ${err.message}`, filePath: metaPath });
  }
  const validation = validateMetadata(doc, metaPath);
  if (validation) return validation;
  return {
    slug: doc.slug,
    version: doc.version,
    source: root,
    ...(typeof doc.category === 'string' ? { category: doc.category } : {}),
    ...(Array.isArray(doc.providesRoles) ? { providesRoles: doc.providesRoles.slice() } : {}),
    ...(Array.isArray(doc.suggestedCompanions)
      ? { suggestedCompanions: doc.suggestedCompanions.map((s) => ({ role: s.role, reason: s.reason })) }
      : {}),
    ...(Array.isArray(doc.standardsTrace)
      ? { standardsTrace: doc.standardsTrace.map((s) => ({ id: s.id, version: s.version })) }
      : {}),
    // Capability-declaration mechanism (visual round T-5 spec section
    // 5.5.2). Blueprints declare identity or platform capabilities they
    // provide (principalDirectory, roleModel, tenancy, auditLog); the
    // vocabulary lives in the section 6a table in blueprint-authoring.md
    // and the shape validation lives in this loader. Consumer blueprints
    // gate surfaces on the union of currently-applied blueprints'
    // capabilities via the apply-time source read-back (see apply.js).
    ...(Array.isArray(doc.capabilities) ? { capabilities: doc.capabilities.slice() } : {}),
    // Elicitation phase (visual round T-5 spec section 5.5, T-2 gate
    // note d-2026-09-04-051). ADR-elicited fields on contributions are
    // declarative only; a blueprint that needs apply-time answers
    // declares them on this top-level list. Each entry has an id
    // (kebab), a prompt (operator-facing), a kind (enum|string|boolean)
    // with default and options, and an optional `when` predicate whose
    // capability list gates whether the elicit fires.
    ...(Array.isArray(doc.elicits) ? { elicits: doc.elicits.map((e) => normaliseElicit(e)) } : {}),
    // Refusal gate (visual round T-5 spec section 5.5.1). A blueprint
    // that requires at least one applied blueprint declaring a listed
    // capability refuses at apply unless the CLI passes the named skip
    // flag; the message and shape are validated on load, evaluated on
    // apply.
    ...(doc.requiresAppliedCapabilities !== undefined
      ? {
          requiresAppliedCapabilities: {
            capabilities: doc.requiresAppliedCapabilities.capabilities.slice(),
            allowSkipFlag: doc.requiresAppliedCapabilities.allowSkipFlag,
            refusalMessageId: doc.requiresAppliedCapabilities.refusalMessageId,
          },
        }
      : {}),
    contributions: Array.isArray(doc.contributions) ? doc.contributions.map(preserveAdrDisciplineFields) : [],
  };
}

// Shape-preserve an elicit entry. The loader's validator has already
// vetted every field; this copy strips extra keys and freezes shape.
function normaliseElicit(entry) {
  const out = { id: entry.id, prompt: entry.prompt, kind: entry.kind };
  if (entry.default !== undefined) out.default = entry.default;
  if (Array.isArray(entry.options)) out.options = entry.options.slice();
  if (entry.when !== undefined) {
    out.when = { requiresCapability: entry.when.requiresCapability };
  }
  if (typeof entry.providesCapability === 'string') {
    out.providesCapability = entry.providesCapability;
  }
  return out;
}

// Copy the standards-derived-discipline ADR fields (recommendedDefault,
// elicited, standardsTraceClause) onto the returned contribution shape
// verbatim so consumers (apply, tests, tooling) can read them without
// re-loading the blueprint.json. Non-ADR contributions ignore these
// fields; the loader does not enforce a kind gate on them because a
// blueprint author can meaningfully attach recommendedDefault to any
// ADR-flavoured contribution (the discipline is prose in section 8a,
// not code, per amendment A2).
function preserveAdrDisciplineFields(c) {
  const out = { ...c };
  if (out.recommendedDefault !== undefined) out.recommendedDefault = c.recommendedDefault === true;
  if (out.elicited !== undefined) out.elicited = c.elicited === true;
  if (typeof c.standardsTraceClause === 'string') out.standardsTraceClause = c.standardsTraceClause;
  return out;
}

function validateMetadata(doc, metaPath) {
  if (typeof doc !== 'object' || doc === null) {
    return rcfError({ kind: 'validation', message: 'blueprint.json must be a JSON object', filePath: metaPath });
  }
  if (typeof doc.slug !== 'string' || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(doc.slug)) {
    return rcfError({ kind: 'validation', message: `blueprint.json: slug '${doc.slug}' is not a valid kebab slug`, filePath: metaPath });
  }
  if (typeof doc.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(doc.version)) {
    return rcfError({ kind: 'validation', message: `blueprint.json: version '${doc.version}' is not semver`, filePath: metaPath });
  }
  if (doc.category !== undefined) {
    // Category is optional; when present it must be a kebab slug (same
    // shape as blueprint slug). The loader validates SHAPE only: the
    // vocabulary (application, security, email, deploy, delivery,
    // persistence, observability, and future additions) is documented
    // in the authoring standard rather than pinned in code, so a new
    // category minted at standard-review time does not need a loader
    // change. The docs shelf and `rcf define blueprint list` render
    // whatever category strings appear on the applied blueprints.
    if (typeof doc.category !== 'string' || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(doc.category)) {
      return rcfError({ kind: 'validation', message: `blueprint.json: category '${doc.category}' is not a valid kebab slug`, filePath: metaPath });
    }
  }
  if (doc.contributions !== undefined && !Array.isArray(doc.contributions)) {
    return rcfError({ kind: 'validation', message: 'blueprint.json: contributions must be an array', filePath: metaPath });
  }
  for (const c of doc.contributions ?? []) {
    if (typeof c.id !== 'string' || typeof c.kind !== 'string' || typeof c.path !== 'string') {
      return rcfError({ kind: 'validation', message: 'blueprint.json: every contribution needs { id, kind, path }', filePath: metaPath });
    }
    // Kind gate. Blueprints compose downward from project singletons;
    // PRD / TAD / BS are per-project artefacts a blueprint never gets
    // to overwrite, and FBS is excluded by ratified principle
    // (composition sits at the requirements layer). This is enforced
    // pre-registry so a mis-authored blueprint fails at load time
    // rather than at the apply-time collision.
    if (ROOT_SINGLETON_KINDS.has(c.kind)) {
      return rcfError({
        kind: 'validation',
        message: `blueprint.json: contribution ${c.id} kind '${c.kind}' is a project singleton and cannot be blueprint-owned`,
        filePath: metaPath,
      });
    }
    if (EXCLUDED_KINDS.has(c.kind)) {
      return rcfError({
        kind: 'validation',
        message: `blueprint.json: contribution ${c.id} kind '${c.kind}' is excluded from blueprint composition by ratified principle (FBS lives at the project's build layer)`,
        filePath: metaPath,
      });
    }
    if (!CONTRIBUTABLE_KINDS.has(c.kind)) {
      return rcfError({
        kind: 'validation',
        message: `blueprint.json: contribution ${c.id} kind '${c.kind}' is not a recognised contributable kind (expected one of: ${[...CONTRIBUTABLE_KINDS].join(', ')})`,
        filePath: metaPath,
      });
    }
    // Path guard. Contribution paths are ALWAYS relative to the
    // blueprint's contributions/ directory. Reject absolute paths and
    // `..` traversal outright; a registry-fetched blueprint that
    // slipped through with an escaping path would land arbitrary
    // bytes wherever the resolved path pointed. Belt-and-braces
    // before Phase 2 fronts this loader with a registry.
    const pathError = validateContributionPath(c.path, c.id);
    if (pathError) return rcfError({ kind: 'validation', message: pathError, filePath: metaPath });
    if (c.scope !== undefined && c.scope !== 'global') {
      return rcfError({ kind: 'validation', message: `blueprint.json: contribution ${c.id} scope must be 'global' when present`, filePath: metaPath });
    }
    if (c.scope === 'global' && typeof c.topic !== 'string') {
      return rcfError({ kind: 'validation', message: `blueprint.json: scope=global contribution ${c.id} requires a topic`, filePath: metaPath });
    }
    // Standards-derived discipline (spec 3.2) per-ADR fields. Shape
    // gates only; whether a MUST clause landed on an AC vs an ADR is
    // prose in blueprint-authoring.md section 8a, not code (amendment
    // A2 Baz 2026-09-04T12:20:31Z).
    if (c.recommendedDefault !== undefined && typeof c.recommendedDefault !== 'boolean') {
      return rcfError({ kind: 'validation', message: `blueprint.json: contribution ${c.id} recommendedDefault must be a boolean when set`, filePath: metaPath });
    }
    if (c.elicited !== undefined && typeof c.elicited !== 'boolean') {
      return rcfError({ kind: 'validation', message: `blueprint.json: contribution ${c.id} elicited must be a boolean when set`, filePath: metaPath });
    }
    if (c.standardsTraceClause !== undefined) {
      if (typeof c.standardsTraceClause !== 'string' || c.standardsTraceClause.trim().length === 0) {
        return rcfError({ kind: 'validation', message: `blueprint.json: contribution ${c.id} standardsTraceClause must be a non-empty string when set`, filePath: metaPath });
      }
    }
  }
  // Companion-suggestion mechanism fields (core-companions spec 2.1).
  const rolesError = validateProvidesRoles(doc, metaPath);
  if (rolesError) return rolesError;
  const suggestedError = validateSuggestedCompanions(doc, metaPath);
  if (suggestedError) return suggestedError;
  // Paired-ADR gate (spec 2.1): a blueprint declaring a role in
  // providesRoles[] MUST carry a scope:global ADR whose topic string
  // equals the role name. Enforced after per-contribution validation
  // so a mis-authored contribution fails first with the more specific
  // shape error.
  const pairedError = validateProvidesRolesPairedAdrs(doc, metaPath);
  if (pairedError) return pairedError;
  // Standards-derived discipline (spec 3.3): if standardsTrace[] is
  // set, every ADR contribution MUST carry a non-null
  // standardsTraceClause. The loader does NOT cross-check clause
  // severity to kind (per amendment A2); the discipline is prose.
  const stError = validateStandardsTrace(doc, metaPath);
  if (stError) return stError;
  // Capability-declaration mechanism (visual round T-5, spec 5.5.2).
  const capError = validateCapabilities(doc, metaPath);
  if (capError) return capError;
  const elicitError = validateElicits(doc, metaPath);
  if (elicitError) return elicitError;
  const requiresError = validateRequiresAppliedCapabilities(doc, metaPath);
  if (requiresError) return requiresError;
  return null;
}

// The kebab-slug grammar the elicit id uses (matches blueprint slug
// and category shapes). Elicit ids must be slugs so the CLI's
// --answer <id>=<value> flag has an unambiguous key vocabulary.
const KEBAB_SLUG_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

// Set of legal elicit kinds. `enum` requires options[]; `string` and
// `boolean` do not.
const ELICIT_KINDS = new Set(['enum', 'string', 'boolean']);

/**
 * Validate capabilities[] shape (visual round T-5 spec 5.5.2). Optional;
 * when present must be a non-empty array of lower camelCase strings on
 * ^[a-z][a-zA-Z0-9]*$, matching the section 6a role convention.
 */
function validateCapabilities(doc, metaPath) {
  if (doc.capabilities === undefined) return null;
  if (!Array.isArray(doc.capabilities) || doc.capabilities.length === 0) {
    return rcfError({ kind: 'validation', message: 'blueprint.json: capabilities must be a non-empty array when set', filePath: metaPath });
  }
  for (let i = 0; i < doc.capabilities.length; i += 1) {
    const cap = doc.capabilities[i];
    if (typeof cap !== 'string' || !ROLE_NAME_RE.test(cap)) {
      return rcfError({
        kind: 'validation',
        message: `blueprint.json: capabilities[${i}] '${cap}' is not lower camelCase (^[a-z][a-zA-Z0-9]*$).`,
        filePath: metaPath,
      });
    }
  }
  return null;
}

/**
 * Validate elicits[] shape (visual round T-5 spec 5.5). Optional; when
 * present must be a non-empty array of entries carrying id (kebab
 * slug), prompt (non-empty string, no em-dashes, no emojis), kind
 * (enum|string|boolean), an optional default matching the kind, an
 * options[] array when kind is enum, and an optional when-predicate
 * whose requiresCapability[] is a non-empty array of camelCase
 * capability strings.
 */
function validateElicits(doc, metaPath) {
  if (doc.elicits === undefined) return null;
  if (!Array.isArray(doc.elicits) || doc.elicits.length === 0) {
    return rcfError({ kind: 'validation', message: 'blueprint.json: elicits must be a non-empty array when set', filePath: metaPath });
  }
  const seenIds = new Set();
  for (let i = 0; i < doc.elicits.length; i += 1) {
    const entry = doc.elicits[i];
    if (typeof entry !== 'object' || entry === null) {
      return rcfError({ kind: 'validation', message: `blueprint.json: elicits[${i}] must be an object`, filePath: metaPath });
    }
    if (typeof entry.id !== 'string' || !KEBAB_SLUG_RE.test(entry.id)) {
      return rcfError({
        kind: 'validation',
        message: `blueprint.json: elicits[${i}].id '${entry.id}' is not a kebab slug (^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$).`,
        filePath: metaPath,
      });
    }
    if (seenIds.has(entry.id)) {
      return rcfError({ kind: 'validation', message: `blueprint.json: elicits[${i}].id '${entry.id}' duplicates an earlier entry`, filePath: metaPath });
    }
    seenIds.add(entry.id);
    if (typeof entry.prompt !== 'string' || entry.prompt.trim().length === 0) {
      return rcfError({ kind: 'validation', message: `blueprint.json: elicits[${i}] '${entry.id}' prompt must be a non-empty string`, filePath: metaPath });
    }
    if (EM_DASH.test(entry.prompt)) {
      return rcfError({ kind: 'validation', message: `blueprint.json: elicits[${i}] '${entry.id}' prompt contains an em-dash; use a comma, a full stop, or a colon.`, filePath: metaPath });
    }
    if (EMOJI_RE.test(entry.prompt)) {
      return rcfError({ kind: 'validation', message: `blueprint.json: elicits[${i}] '${entry.id}' prompt contains an emoji; operator-facing prose must be plain text.`, filePath: metaPath });
    }
    if (!ELICIT_KINDS.has(entry.kind)) {
      return rcfError({
        kind: 'validation',
        message: `blueprint.json: elicits[${i}] '${entry.id}' kind '${entry.kind}' must be one of: ${[...ELICIT_KINDS].join(', ')}.`,
        filePath: metaPath,
      });
    }
    if (entry.kind === 'enum') {
      if (!Array.isArray(entry.options) || entry.options.length === 0) {
        return rcfError({ kind: 'validation', message: `blueprint.json: elicits[${i}] '${entry.id}' kind=enum requires a non-empty options[] array`, filePath: metaPath });
      }
      for (let j = 0; j < entry.options.length; j += 1) {
        if (typeof entry.options[j] !== 'string' || entry.options[j].length === 0) {
          return rcfError({ kind: 'validation', message: `blueprint.json: elicits[${i}] '${entry.id}' options[${j}] must be a non-empty string`, filePath: metaPath });
        }
      }
      if (entry.default !== undefined && !entry.options.includes(entry.default)) {
        return rcfError({ kind: 'validation', message: `blueprint.json: elicits[${i}] '${entry.id}' default '${entry.default}' is not in options[]`, filePath: metaPath });
      }
    } else if (entry.kind === 'boolean') {
      if (entry.default !== undefined && typeof entry.default !== 'boolean') {
        return rcfError({ kind: 'validation', message: `blueprint.json: elicits[${i}] '${entry.id}' kind=boolean default must be a boolean`, filePath: metaPath });
      }
    } else if (entry.kind === 'string') {
      if (entry.default !== undefined && typeof entry.default !== 'string') {
        return rcfError({ kind: 'validation', message: `blueprint.json: elicits[${i}] '${entry.id}' kind=string default must be a string`, filePath: metaPath });
      }
    }
    if (entry.when !== undefined) {
      if (typeof entry.when !== 'object' || entry.when === null) {
        return rcfError({ kind: 'validation', message: `blueprint.json: elicits[${i}] '${entry.id}' when must be an object`, filePath: metaPath });
      }
      if (!Array.isArray(entry.when.requiresCapability) || entry.when.requiresCapability.length === 0) {
        return rcfError({ kind: 'validation', message: `blueprint.json: elicits[${i}] '${entry.id}' when.requiresCapability must be a non-empty array`, filePath: metaPath });
      }
      for (let j = 0; j < entry.when.requiresCapability.length; j += 1) {
        const cap = entry.when.requiresCapability[j];
        if (typeof cap !== 'string' || !ROLE_NAME_RE.test(cap)) {
          return rcfError({
            kind: 'validation',
            message: `blueprint.json: elicits[${i}] '${entry.id}' when.requiresCapability[${j}] '${cap}' is not lower camelCase.`,
            filePath: metaPath,
          });
        }
      }
    }
    // Custom-auth capability discovery (visual round T-5 spec 5.5
    // "Risks"). An elicit that declares providesCapability is a
    // boolean prompt asking the operator whether their custom auth
    // provides the named capability; a truthy answer folds the
    // capability into the effective applied set at apply time, so a
    // project with no shelf auth blueprint can still satisfy a
    // consumer blueprint's requiresAppliedCapabilities gate without
    // the allowNoAuthYet override. Rules: kind MUST be boolean,
    // when MUST be absent (custom-auth elicits fire pre-refusal,
    // before any discovered-capability set exists), and the value
    // MUST be lower camelCase (same grammar as capabilities[]).
    if (entry.providesCapability !== undefined) {
      if (entry.kind !== 'boolean') {
        return rcfError({
          kind: 'validation',
          message: `blueprint.json: elicits[${i}] '${entry.id}' providesCapability requires kind=boolean (got '${entry.kind}').`,
          filePath: metaPath,
        });
      }
      if (entry.when !== undefined) {
        return rcfError({
          kind: 'validation',
          message: `blueprint.json: elicits[${i}] '${entry.id}' providesCapability is incompatible with when (custom-auth elicits fire pre-refusal, before applied capabilities are discovered).`,
          filePath: metaPath,
        });
      }
      if (typeof entry.providesCapability !== 'string' || !ROLE_NAME_RE.test(entry.providesCapability)) {
        return rcfError({
          kind: 'validation',
          message: `blueprint.json: elicits[${i}] '${entry.id}' providesCapability '${entry.providesCapability}' is not lower camelCase (^[a-z][a-zA-Z0-9]*$).`,
          filePath: metaPath,
        });
      }
    }
  }
  return null;
}

/**
 * Validate requiresAppliedCapabilities shape (visual round T-5 spec
 * 5.5.1). Optional; when present must be an object with capabilities
 * (non-empty array of lower camelCase strings), allowSkipFlag (kebab
 * slug matching a CLI flag name), and refusalMessageId (non-empty
 * string; the apply verb maps it to a message template).
 */
function validateRequiresAppliedCapabilities(doc, metaPath) {
  if (doc.requiresAppliedCapabilities === undefined) return null;
  const r = doc.requiresAppliedCapabilities;
  if (typeof r !== 'object' || r === null) {
    return rcfError({ kind: 'validation', message: 'blueprint.json: requiresAppliedCapabilities must be an object', filePath: metaPath });
  }
  if (!Array.isArray(r.capabilities) || r.capabilities.length === 0) {
    return rcfError({ kind: 'validation', message: 'blueprint.json: requiresAppliedCapabilities.capabilities must be a non-empty array', filePath: metaPath });
  }
  for (let i = 0; i < r.capabilities.length; i += 1) {
    const cap = r.capabilities[i];
    if (typeof cap !== 'string' || !ROLE_NAME_RE.test(cap)) {
      return rcfError({
        kind: 'validation',
        message: `blueprint.json: requiresAppliedCapabilities.capabilities[${i}] '${cap}' is not lower camelCase.`,
        filePath: metaPath,
      });
    }
  }
  if (typeof r.allowSkipFlag !== 'string' || !KEBAB_SLUG_RE.test(r.allowSkipFlag)) {
    return rcfError({
      kind: 'validation',
      message: `blueprint.json: requiresAppliedCapabilities.allowSkipFlag '${r.allowSkipFlag}' is not a kebab slug (matches a CLI flag name).`,
      filePath: metaPath,
    });
  }
  if (typeof r.refusalMessageId !== 'string' || r.refusalMessageId.trim().length === 0) {
    return rcfError({ kind: 'validation', message: 'blueprint.json: requiresAppliedCapabilities.refusalMessageId must be a non-empty string', filePath: metaPath });
  }
  return null;
}

/**
 * Validate providesRoles[] shape (spec 2.1). Optional; when present
 * must be a non-empty array of lower camelCase strings on the pattern
 * ^[a-z][a-zA-Z0-9]*$.
 */
function validateProvidesRoles(doc, metaPath) {
  if (doc.providesRoles === undefined) return null;
  if (!Array.isArray(doc.providesRoles) || doc.providesRoles.length === 0) {
    return rcfError({ kind: 'validation', message: 'blueprint.json: providesRoles must be a non-empty array when set', filePath: metaPath });
  }
  for (let i = 0; i < doc.providesRoles.length; i += 1) {
    const role = doc.providesRoles[i];
    if (typeof role !== 'string' || !ROLE_NAME_RE.test(role)) {
      return rcfError({
        kind: 'validation',
        message: `blueprint.json: providesRoles[${i}] '${role}' is not lower camelCase (^[a-z][a-zA-Z0-9]*$).`,
        filePath: metaPath,
      });
    }
  }
  return null;
}

/**
 * Validate suggestedCompanions[] shape (spec 2.1). Optional; when
 * present must be a non-empty array of `{role, reason}` objects; role
 * is a lower camelCase string; reason is a non-empty string with no
 * em-dashes and no emojis (banned-tells baseline applies to operator-
 * facing prose).
 */
function validateSuggestedCompanions(doc, metaPath) {
  if (doc.suggestedCompanions === undefined) return null;
  if (!Array.isArray(doc.suggestedCompanions) || doc.suggestedCompanions.length === 0) {
    return rcfError({ kind: 'validation', message: 'blueprint.json: suggestedCompanions must be a non-empty array when set', filePath: metaPath });
  }
  for (let i = 0; i < doc.suggestedCompanions.length; i += 1) {
    const entry = doc.suggestedCompanions[i];
    if (typeof entry !== 'object' || entry === null) {
      return rcfError({ kind: 'validation', message: `blueprint.json: suggestedCompanions[${i}] must be an object with role and reason`, filePath: metaPath });
    }
    if (typeof entry.role !== 'string' || !ROLE_NAME_RE.test(entry.role)) {
      return rcfError({
        kind: 'validation',
        message: `blueprint.json: suggestedCompanions[${i}].role '${entry.role}' is not lower camelCase (^[a-z][a-zA-Z0-9]*$).`,
        filePath: metaPath,
      });
    }
    if (typeof entry.reason !== 'string' || entry.reason.trim().length === 0) {
      return rcfError({
        kind: 'validation',
        message: `blueprint.json: suggestedCompanions[${i}].reason for role '${entry.role}' must be a non-empty string.`,
        filePath: metaPath,
      });
    }
    if (EM_DASH.test(entry.reason)) {
      return rcfError({
        kind: 'validation',
        message: `blueprint.json: suggestedCompanions[${i}].reason for role '${entry.role}' contains an em-dash; use a comma, a full stop, or a colon.`,
        filePath: metaPath,
      });
    }
    if (EMOJI_RE.test(entry.reason)) {
      return rcfError({
        kind: 'validation',
        message: `blueprint.json: suggestedCompanions[${i}].reason for role '${entry.role}' contains an emoji; operator-facing prose must be plain text.`,
        filePath: metaPath,
      });
    }
  }
  return null;
}

/**
 * Paired-ADR gate for providesRoles (spec 2.1). A blueprint that
 * declares a role MUST also carry a scope:global ADR whose topic
 * string equals the role name. The check runs after per-contribution
 * shape validation so the more specific per-contribution message
 * fires first on a mis-authored file.
 */
function validateProvidesRolesPairedAdrs(doc, metaPath) {
  if (!Array.isArray(doc.providesRoles) || doc.providesRoles.length === 0) return null;
  const globalTopics = new Set(
    (doc.contributions ?? [])
      .filter((c) => c.kind === 'adr' && c.scope === 'global' && typeof c.topic === 'string')
      .map((c) => c.topic),
  );
  for (const role of doc.providesRoles) {
    if (!globalTopics.has(role)) {
      return rcfError({
        kind: 'validation',
        message: `blueprint.json: providesRoles[] names '${role}' but no scope:global ADR carries topic '${role}'.`,
        filePath: metaPath,
      });
    }
  }
  return null;
}

/**
 * Standards-derived-discipline gate (spec 3.3). If standardsTrace[]
 * is declared, every ADR contribution MUST carry a non-null
 * standardsTraceClause. No cross-check on severity-to-kind mapping
 * (amendment A2 Baz 2026-09-04T12:20:31Z): the discipline is prose in
 * blueprint-authoring.md section 8a, not code.
 */
function validateStandardsTrace(doc, metaPath) {
  if (doc.standardsTrace === undefined) return null;
  if (!Array.isArray(doc.standardsTrace)) {
    return rcfError({ kind: 'validation', message: 'blueprint.json: standardsTrace must be an array when set', filePath: metaPath });
  }
  for (let i = 0; i < doc.standardsTrace.length; i += 1) {
    const entry = doc.standardsTrace[i];
    if (typeof entry !== 'object' || entry === null) {
      return rcfError({ kind: 'validation', message: `blueprint.json: standardsTrace[${i}] must be an object with id and version`, filePath: metaPath });
    }
    if (typeof entry.id !== 'string' || entry.id.trim().length === 0) {
      return rcfError({ kind: 'validation', message: `blueprint.json: standardsTrace[${i}].id must be a non-empty string`, filePath: metaPath });
    }
    if (typeof entry.version !== 'string' || entry.version.trim().length === 0) {
      return rcfError({ kind: 'validation', message: `blueprint.json: standardsTrace[${i}].version must be a non-empty string`, filePath: metaPath });
    }
  }
  const slug = doc.slug;
  for (const c of doc.contributions ?? []) {
    if (c.kind !== 'adr') continue;
    if (typeof c.standardsTraceClause !== 'string' || c.standardsTraceClause.trim().length === 0) {
      return rcfError({
        kind: 'validation',
        message: `blueprint '${slug}' declares standardsTrace but ADR contribution '${c.id}' has no standardsTraceClause; every ADR must reference a standard clause or the sentinel 'generic enterprise practice'.`,
        filePath: metaPath,
      });
    }
  }
  return null;
}

function validateContributionPath(p, id) {
  if (typeof p !== 'string' || p.length === 0) {
    return `blueprint.json: contribution ${id} path must be a non-empty string`;
  }
  if (isAbsolute(p) || /^[A-Za-z]:[\\/]/.test(p)) {
    return `blueprint.json: contribution ${id} path '${p}' must be relative (absolute paths are refused)`;
  }
  const segments = p.split(/[\\/]/);
  if (segments.some((s) => s === '..')) {
    return `blueprint.json: contribution ${id} path '${p}' contains a '..' segment (parent-directory traversal is refused)`;
  }
  return null;
}
