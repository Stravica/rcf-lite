// `rcf blueprint supersede <topic> [--incoming <source>]` implementation.
//
// Scaffolds a project-level ADR at `rcf/adrs/adr-NNN-<kebab-topic>.json`
// that supersedes the CONFLICT PAIR on the topic (one currently-applied
// blueprint's scope:global ADR + one incoming (would-be-applied)
// blueprint's scope:global ADR — Baz ruling, w-2026-08-19-008 round 3),
// and appends a matching `manifest.resolutions[]` record so the conflict
// detector honours the resolution when the operator re-runs
// `rcf blueprint add <incoming source>`.
//
// The `incomingSource` argument (mapped to `--incoming <source>` on the
// CLI) is REQUIRED when the applied-blueprints count on the topic is
// < 2, and silently accepted (informational) when it is already >= 2.
// This is what makes option 3 as printed by the reshaped conflict
// message executable VERBATIM from the refused-add state: the operator
// runs `rcf blueprint supersede <topic> --incoming <source>` immediately
// after the refused add, with zero prep; the verb loads the incoming
// blueprint from disk, finds its scope:global ADR on <topic>, stamps
// the id into the incoming blueprint's namespace, and uses that
// {slug, adrId} as the second side of supersedes[]. Round-2 shipped
// with the writer requiring 2 already-applied ADRs, which meant option
// 3 as printed exited 2 in the refused-add state; the escalation the
// worker adapted around was that AC-1002-5 could not pass as written.
//
// Two side effects, both governed by dryRun:
//   1. Writes the project ADR file (JSON, minimally valid — the operator
//      is expected to fill out the context / decision / consequences
//      body; the file lands with prefilled stubs that are valid against
//      adr.schema.json so no adr-shaped tool errors on the freshly
//      scaffolded file).
//   2. Appends `manifest.resolutions[]` via the shared manifest writer.
//
// The two writes are ordered: ADR first, manifest second. If the ADR
// write succeeds and the manifest write fails, the operator is left
// with a well-formed project ADR they can either re-run supersede
// against (idempotent by resolvedByAdrId) or hand-clean; the reverse
// order would leave a manifest resolution pointing at a non-existent
// ADR, which is the worse failure mode.
//
// Error-message prefix discipline (round-3 mechanical P1):
// every rcfError returned from this module is PREFIX-FREE — no
// `blueprint supersede: ` in the message body. The CLI edge prepends
// `[error] blueprint supersede: ` on every rcfError from the supersede
// verb, and doubling the prefix reads badly on the terminal.

import { mkdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { rcfError } from '../core/errors/index.js';
import { loadBlueprint } from './loader.js';
import { updateManifest } from './manifest-writer.js';
import { stampId } from './namespace.js';
import { nextResolutionId } from './resolutions.js';

/**
 * @typedef {object} SupersedeResult
 * @property {boolean} superseded
 * @property {string}  topic
 * @property {string}  resolvedByAdrId
 * @property {string}  resolvedByAdrPath
 * @property {Array<{ slug: string, adrId: string, path: string }>} supersedes
 * @property {string}  resolutionId
 */

/**
 * @param {object} args
 * @param {string} args.projectRoot
 * @param {import('#core/store/walker.js').TreeModel} args.tree
 * @param {string} args.topic
 * @param {string} [args.incomingSource]
 *   Path to a blueprint source directory (a `blueprint.json` + a
 *   `contributions/` tree). Required when the applied-blueprints count
 *   on `topic` is < 2 — the verb loads the blueprint from disk, finds
 *   its scope:global ADR on `topic`, stamps its id into the incoming
 *   blueprint's namespace, and uses that {slug, adrId} as the second
 *   side of `supersedes[]`. Silently accepted (informational, does not
 *   contribute a second entry beyond dedupe) when >= 2 applied ADRs on
 *   the topic already exist.
 * @param {Date} [args.now]
 * @param {boolean} [args.dryRun]
 * @param {string} [args.reason]
 * @returns {Promise<SupersedeResult | import('../core/errors/index.js').RcfError>}
 */
export async function supersedeBlueprintTopic({ projectRoot, tree, topic, incomingSource, now = new Date(), dryRun = false, reason }) {
  if (typeof topic !== 'string' || topic.trim().length === 0) {
    // Schema minLength:1 accepts whitespace-only; the writer refuses
    // it up-front so a whitespace-only topic never lands on disk.
    return rcfError({ kind: 'usage', message: `topic is required (e.g. rcf blueprint supersede errorEnvelope --incoming ./blueprints/rest)` });
  }
  // Topic is a LOOKUP KEY into applied ADR topics, not a slug (ADR-010).
  // Schema is minLength:1 with no character constraint and the schema
  // docs explicitly cite camelCase examples ('errorEnvelope'). The
  // shipped SPA + REST blueprints declare camelCase topics; we accept
  // any topic string that exact-matches an applied or incoming ADR
  // topic below, and kebab-ify only when projecting into the
  // scaffolded project-ADR id slug tail (adrId grammar requires
  // lowercase kebab after the digits).
  if (reason !== undefined && typeof reason === 'string' && reason.length > 0 && reason.trim().length === 0) {
    // Non-empty whitespace-only reason: refuse before write. An
    // undefined / empty-string reason is fine (the field is optional
    // on the schema; empty-string simply becomes 'omit').
    return rcfError({ kind: 'usage', message: `--reason must not be whitespace-only.` });
  }

  const applied = Array.isArray(tree.manifest?.blueprints) ? tree.manifest.blueprints : [];
  const supersedes = [];
  for (const bp of applied) {
    for (const c of bp.contributions ?? []) {
      if (c.kind === 'adr' && c.scope === 'global' && c.topic === topic) {
        supersedes.push({ slug: bp.slug, adrId: c.id, path: c.path });
      }
    }
  }

  // Baz ruling (round 3): the supersession record's two sides are the
  // CONFLICT PAIR — one applied + one incoming — and this verb must
  // accept the incoming blueprint as the second side. `--incoming
  // <source>` loads the incoming blueprint from disk, finds its
  // scope:global ADR on the topic, and adds it to supersedes[]. When
  // supersedes[] already has >= 2 entries from applied blueprints, an
  // incomingSource is informational only (skipped silently unless it
  // would add a distinct {slug, adrId} pair, in which case it is
  // appended for a >= 3-blueprint scenario).
  if (typeof incomingSource === 'string' && incomingSource.length > 0) {
    const loaded = await loadBlueprint(incomingSource);
    if (loaded.kind) {
      // Preserve the loader's own rcfError but drop any 'blueprint: '
      // narrator prefix so the CLI's `[error] blueprint supersede: `
      // reads clean.
      return rcfError({
        kind: loaded.kind === 'usage' ? 'usage' : loaded.kind,
        message: `--incoming ${incomingSource}: ${loaded.message.replace(/^blueprint(?:\s+add|\s+supersede)?:\s*/, '')}`,
        filePath: loaded.filePath,
      });
    }
    let matched = null;
    for (const c of loaded.contributions ?? []) {
      if (c.kind === 'adr' && c.scope === 'global' && c.topic === topic) {
        matched = c;
        break;
      }
    }
    if (!matched) {
      return rcfError({
        kind: 'usage',
        message: `--incoming ${incomingSource}: blueprint '${loaded.slug}' declares no scope:global ADR on topic '${topic}'.`,
      });
    }
    const stamped = stampId(matched.id, loaded.slug);
    if ('error' in stamped) {
      return rcfError({ kind: 'validation', message: `--incoming ${incomingSource}: ${stamped.error}` });
    }
    const incomingPair = { slug: loaded.slug, adrId: stamped.id, path: `rcf/adrs/${stamped.id.toLowerCase()}.json` };
    // Dedupe against the applied side: an incoming blueprint that is
    // also currently applied (unusual — refused-add state means it is
    // NOT applied) would otherwise be double-listed.
    const alreadyListed = supersedes.some((s) => s.slug === incomingPair.slug && s.adrId === incomingPair.adrId);
    if (!alreadyListed) supersedes.push(incomingPair);
  }

  if (supersedes.length < 2) {
    return rcfError({
      kind: 'usage',
      message: `topic '${topic}' has ${supersedes.length} scope:global ADR(s) across applied+incoming; at least two are required for a supersession record. If the incoming blueprint has not been named, add \`--incoming <source>\` (the same source you passed to \`rcf blueprint add\`).`,
    });
  }

  // Mint the project ADR id: numeric-only in the ADR-NNN-<topic> shape
  // (topic slug appended as the ADR grammar's optional suffix). Read
  // every ADR the walker already loaded and pick max(NNN) + 1 across
  // all ADR ids regardless of blueprint namespace. NNN is zero-padded
  // to three digits (adrId pattern requires \d{3,}).
  const projectAdrId = mintProjectAdrId(tree, topic);
  const projectAdrPath = `rcf/adrs/${projectAdrId.toLowerCase()}.json`;
  const absAdrPath = join(projectRoot, projectAdrPath);

  // Compose the project ADR body. Required fields on adr.schema.json:
  // adrId, prdId, tadId, version, status, title, context, decision,
  // consequences, createdAt, updatedAt. The prdId + tadId come from the
  // tree's roots; the rest carry prefilled operator-editable stubs
  // (minLength 1 satisfied, no <PLACEHOLDER> tokens the tree would
  // choke on later).
  const prdId = tree.manifest?.prd?.id;
  const tadId = tree.manifest?.tad?.id;
  if (typeof prdId !== 'string' || typeof tadId !== 'string') {
    return rcfError({ kind: 'usage', message: `manifest is missing prd or tad; cannot scaffold a project ADR without prdId / tadId.` });
  }

  const isoNow = now.toISOString();
  const relatedAdrs = supersedes.map((s) => s.adrId).filter((id) => /^ADR-\d{3,}(?:-[a-z0-9]+(?:-[a-z0-9]+)*)?$/.test(id));
  const superseededSlugs = supersedes.map((s) => `${s.adrId} (blueprint ${s.slug})`).join(', ');
  const adrBody = {
    adrId: projectAdrId,
    prdId,
    tadId,
    version: '1.0.0',
    status: 'accepted',
    title: `Project ruling on ${topic} (supersedes ${supersedes.length} blueprint ADR${supersedes.length === 1 ? '' : 's'})`,
    context: `Two or more applied blueprints each contributed a scope:global ADR on the '${topic}' topic: ${superseededSlugs}. Composition of these blueprints on one project needs a single project-level decision on ${topic}; the blueprint ADRs are retained on disk as superseded history.`,
    decision: `Adopt a project-level ruling on ${topic}. This ADR is the live decision; the blueprint ADRs listed under relatedAdrs are superseded and their content stands as historical context only.`,
    consequences: `The blueprint conflict on topic '${topic}' is honoured via manifest.resolutions[]. Any future blueprint added with a scope:global ADR on '${topic}' must be listed on the resolution (or a fresh resolution must be recorded) before rcf blueprint add proceeds.`,
    ...(relatedAdrs.length > 0 ? { relatedAdrs } : {}),
    createdAt: isoNow,
    updatedAt: isoNow,
  };

  const resolutionId = nextResolutionId(tree.manifest, now);
  const resolutionRecord = {
    id: resolutionId,
    createdAt: isoNow,
    kind: 'globalAdrTopic',
    topic,
    resolvedByAdrId: projectAdrId,
    supersedes: supersedes.map((s) => ({ slug: s.slug, adrId: s.adrId })),
    ...(typeof reason === 'string' && reason.length > 0 ? { reason } : {}),
  };

  if (!dryRun) {
    // Refuse to clobber an existing file at the scaffolded ADR path.
    const already = await stat(absAdrPath).catch(() => null);
    if (already) {
      return rcfError({
        kind: 'duplicateId',
        message: `refuse to overwrite existing file at ${projectAdrPath}. Re-run supersede after removing or renaming that file, or edit it directly if it is the intended supersession record.`,
        filePath: projectAdrPath,
      });
    }
    try {
      await mkdir(dirname(absAdrPath), { recursive: true });
      const tmp = `${absAdrPath}.tmp`;
      await writeFile(tmp, `${JSON.stringify(adrBody, null, 2)}\n`, 'utf8');
      try {
        await rename(tmp, absAdrPath);
      } catch (err) {
        await unlink(tmp).catch(() => {});
        throw err;
      }
    } catch (err) {
      return rcfError({ kind: 'ioFailure', message: `ADR write failed: ${err.message}`, filePath: projectAdrPath });
    }
  }

  const manifestResult = await updateManifest({
    projectRoot,
    manifest: tree.manifest,
    mutate: (next) => {
      const list = Array.isArray(next.resolutions) ? next.resolutions : [];
      list.push(resolutionRecord);
      next.resolutions = list;
    },
    dryRun,
  });
  if (manifestResult.kind) return manifestResult;

  return {
    superseded: true,
    topic,
    resolvedByAdrId: projectAdrId,
    resolvedByAdrPath: projectAdrPath,
    supersedes: supersedes.map((s) => ({ slug: s.slug, adrId: s.adrId, path: s.path })),
    resolutionId,
  };
}

function mintProjectAdrId(tree, topic) {
  let maxN = 0;
  const walk = (id) => {
    if (typeof id !== 'string') return;
    const m = id.match(/^ADR-(\d{3,})(?:-|$)/);
    if (!m) return;
    const n = Number.parseInt(m[1], 10);
    if (Number.isFinite(n) && n > maxN) maxN = n;
  };
  if (tree.byId instanceof Map) {
    for (const id of tree.byId.keys()) walk(id);
  }
  // Belt and braces: also scan applied blueprint contribution ids in
  // case an ADR sits recorded but the walker did not surface it under
  // byId (broken tree path, mid-migration state, etc.).
  for (const bp of tree.manifest?.blueprints ?? []) {
    for (const c of bp.contributions ?? []) walk(c.id);
  }
  const next = (maxN + 1).toString().padStart(3, '0');
  // adrId grammar requires lowercase kebab after the digits
  // (^ADR-\d{3,}(-[a-z0-9]+(?:-[a-z0-9]+)*)?$), so a camelCase topic
  // like 'authModel' becomes the slug tail 'auth-model'. Topic itself
  // remains stored verbatim on manifest.resolutions[].topic — it is a
  // lookup key, not a slug.
  return `ADR-${next}-${kebabise(topic)}`;
}

/**
 * Convert a topic string to a well-formed kebab slug suitable for use
 * as the adrId slug-tail (lowercase alnum segments joined by single
 * hyphens; leading letter enforced by the ADR grammar's optional-tail
 * regex when the tail is non-empty). Handles:
 *   - camelCase -> kebab-case (`authModel` -> `auth-model`)
 *   - snake / SCREAMING_SNAKE -> kebab (`error_envelope` -> `error-envelope`)
 *   - existing kebab (`auth-model`) -> unchanged
 *   - spaces / punctuation collapsed to single hyphens; leading/trailing
 *     hyphens trimmed
 *
 * Guaranteed to return a string that matches `[a-z0-9]+(?:-[a-z0-9]+)*`
 * or empty; the empty case is refused by the caller (topic non-empty
 * check runs first).
 */
export function kebabise(topic) {
  if (typeof topic !== 'string') return '';
  let s = topic;
  // camelCase -> insert hyphen before each uppercase letter that
  // follows a lowercase letter or digit (`authModel` -> `auth-Model`).
  s = s.replace(/([a-z0-9])([A-Z])/g, '$1-$2');
  // SCREAMING_CASE runs: `ABc` -> `A-Bc` so acronyms split cleanly.
  s = s.replace(/([A-Z])([A-Z][a-z])/g, '$1-$2');
  // Lowercase, collapse non-alnum runs to single hyphen, trim.
  s = s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s;
}
