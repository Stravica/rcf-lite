// Blueprint chain-consistency lint (spec section 5 of the integration
// and contradiction protocol, 2026-09-09).
//
// Two passes over ONE blueprint's own JSON and markdown. Pure functions;
// the CLI seam loads the blueprint from disk and hands the model in.
//
// PASS 1: single-definition ownership, MECHANICAL ONLY.
//   The check is intentionally conservative. Pass 1 fires when the
//   same identifier-shaped literal appears on more than one artefact
//   and one of the appearances is case-INCONSISTENT with the owning
//   TAC on a case-sensitive axis (HTTP header, env-var, camelCase
//   JSON field name in a strict-parse context). A byte-identical
//   restatement is only flagged when the owning TAC declares the
//   token on its `interfaces[]` (the strict interface surface) and
//   the restating AC carries no `ownerRef` back to that TAC. Every
//   other kind of appearance is treated as a reference, not a
//   restatement (the mechanical detector cannot reliably tell a
//   duplicate literal from a legitimate mention without domain
//   knowledge, and the spec explicitly names four human-read shapes
//   the lint does not catch, per section 5.7).
//
// PASS 2: REQ delivery, MECHANICAL.
//   A REQ whose description carries a promise phrase (must / requires
//   / guarantees / ceiling / never / invariant / on boot / at boot /
//   event / boundary) must carry a `deliveredBy` link into a TAC or
//   ADR. When the link points at a TAC in the same blueprint, the
//   TAC's responsibilities and interfaces must reference the field
//   (or the REQ's subject, when no `field` sub-path is given).
//
// Every finding carries a stable `id` the operator can quote in the
// blueprint README under "Known chain-consistency-lint suppressions"
// (pass 1 only; pass 2 findings are not suppressible per spec 5.8).

import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * @typedef {object} ConsistencyFinding
 * @property {string} id
 * @property {'pass1'|'pass2'} pass
 * @property {'contractDrift'|'undeclaredRestatement'|'reqNoDelivery'|'reqDeliveryNotCarried'} kind
 * @property {string} subject
 * @property {string[]} refs
 * @property {string} message
 * @property {boolean} [suppressed]
 * @property {string}  [suppressionReason]
 */

const HTTP_HEADER_RE = /^[A-Z][A-Za-z0-9]*(-[A-Z][A-Za-z0-9]*)+$/;
const HTTP_HEADER_LOWER_RE = /^[a-z][a-z0-9]*(-[a-z][a-z0-9]*)+$/;
const ENV_VAR_RE = /^[A-Z][A-Z0-9]*(_[A-Z0-9]+)+$/;
const CAMEL_JSON_FIELD_RE = /^[a-z][a-zA-Z0-9]*$/;

/**
 * Extract identifier-shaped tokens from a body of text: dashed
 * identifiers (Cf-Turnstile-Response, run_worker_first),
 * ALL_CAPS_ENV_VARS, and camelCase / PascalCase runs. Duplicates are
 * preserved so callers can index by occurrence.
 *
 * @param {string} text
 */
function extractTokens(text) {
  if (typeof text !== 'string' || text.length === 0) return [];
  const out = [];
  const re = /[A-Za-z][A-Za-z0-9]*(?:[-_][A-Za-z0-9]+)+|[A-Z][a-z]+(?:[A-Z][a-z]*)+|[a-z]+(?:[A-Z][a-z]*){1,}/g;
  for (const m of text.matchAll(re)) out.push(m[0]);
  return out;
}

/**
 * Classify a token for case-sensitivity purposes.
 *
 * @param {string} token
 * @returns {'header'|'headerLower'|'envVar'|'jsonField'|'identifier'}
 */
function tokenClass(token) {
  if (ENV_VAR_RE.test(token)) return 'envVar';
  if (HTTP_HEADER_RE.test(token)) return 'header';
  if (HTTP_HEADER_LOWER_RE.test(token)) return 'headerLower';
  if (CAMEL_JSON_FIELD_RE.test(token)) return 'jsonField';
  return 'identifier';
}

// TAC / ADR / REQ / US / PRD / TAD / BS / FBS id prefixes: these read
// as identifier-shaped but they are meta references, not contract
// literals. Skip them in both directions of the drift check.
const ID_TOKEN_RE = /^(?:TAC|ADR|REQ|US|PRD|TAD|BS|FBS|TS|CN|AC)[-_A-Z0-9-]*$/;

// Small stop-list of ordinary English hyphenated / camel-cased words
// that appear as identifier-shape but are prose, not contracts.
const PROSE_TOKENS = new Set([
  'stable-coded', 'per-environment', 'wall-clock', 'operator-authored',
  'project-authored', 'vendor-resolved', 'required-absent',
  'deployable-to-slice', 'rotation-days', 'admin-UI',
  'read-through', 'write-through', 'follow-up',
]);

function isNoise(token) {
  if (token.length < 4) return true;
  if (ID_TOKEN_RE.test(token)) return true;
  if (PROSE_TOKENS.has(token)) return true;
  return false;
}

/**
 * Owned-token dictionary. Keyed by lower-case token; the value is the
 * canonical spelling on the owning TAC's interface surface, plus the
 * TAC id and field where it lives.
 *
 * Only `interfaces[].name` and `interfaces[].summary` (backtick-quoted
 * spans only) plus `internalStructure` (backtick-quoted spans only)
 * count as owning surfaces. `responsibilities[]` and `purpose` are
 * prose narrative where a mention is a reference, not a declaration.
 */
function collectOwnedTokens(tacs) {
  /** @type {Map<string, { canonical: string, tacId: string, field: string, klass: string }>} */
  const owned = new Map();
  // record() takes an `onlySensitive` flag. For strict interface
  // surfaces (`interfaces[].name`, `internalStructure` backtick spans,
  // `responsibilities[]` backtick spans) we record every non-prose
  // token including camelCase field names. For less-strict prose
  // surfaces (interface summaries, purpose, responsibilities prose)
  // we only record tokens classified as `header` / `headerLower` /
  // `envVar`, because a prose mention of a camelCase word is usually
  // a reference and only case-sensitive axes reliably indicate a
  // literal declaration.
  const record = (token, tacId, field, onlySensitive) => {
    if (isNoise(token)) return;
    const klass = tokenClass(token);
    if (klass === 'identifier') return;
    if (onlySensitive && klass === 'jsonField') return;
    const key = token.toLowerCase();
    if (!owned.has(key)) owned.set(key, { canonical: token, tacId, field, klass });
  };
  for (const tac of tacs) {
    const tacId = tac.tacId || tac.id || '(unknown-tac)';
    // Strict interface surfaces first so their spellings win the
    // Map's first-write-wins semantics over any weaker prose mention.
    if (Array.isArray(tac.interfaces)) {
      for (let i = 0; i < tac.interfaces.length; i += 1) {
        const iface = tac.interfaces[i];
        if (iface && typeof iface.name === 'string') {
          for (const t of extractTokens(iface.name)) record(t, tacId, `interfaces[${i}].name`, false);
        }
        if (iface && typeof iface.summary === 'string') {
          for (const m of iface.summary.matchAll(/`+([^`]+)`+/g)) {
            for (const t of extractTokens(m[1])) record(t, tacId, `interfaces[${i}].summary`, false);
          }
          // Plain-text summary: case-sensitive axes only. This is what
          // catches `Cf-Turnstile-Response` on TAC-3602's guard summary.
          for (const t of extractTokens(iface.summary)) record(t, tacId, `interfaces[${i}].summary`, true);
        }
      }
    }
    if (typeof tac.internalStructure === 'string') {
      for (const m of tac.internalStructure.matchAll(/`+([^`]+)`+/g)) {
        for (const t of extractTokens(m[1])) record(t, tacId, 'internalStructure', false);
      }
      for (const t of extractTokens(tac.internalStructure)) record(t, tacId, 'internalStructure', true);
    }
    if (Array.isArray(tac.responsibilities)) {
      for (let i = 0; i < tac.responsibilities.length; i += 1) {
        const s = tac.responsibilities[i];
        if (typeof s !== 'string') continue;
        for (const m of s.matchAll(/`+([^`]+)`+/g)) {
          for (const t of extractTokens(m[1])) record(t, tacId, `responsibilities[${i}]`, false);
        }
        for (const t of extractTokens(s)) record(t, tacId, `responsibilities[${i}]`, true);
      }
    }
    if (typeof tac.purpose === 'string') {
      // Purpose prose: header / envVar only (never fires on ordinary
      // English or camelCase identifiers).
      for (const t of extractTokens(tac.purpose)) record(t, tacId, 'purpose', true);
    }
  }
  return owned;
}

/**
 * Collect artefact surfaces (holderId, holderKind, field, text,
 * optional ownerRef on ACs). Used by pass 1's cross-surface walk.
 */
function collectArtefactSurfaces(input) {
  const surfaces = [];
  for (const req of input.reqs) {
    const rid = req.reqId || req.id || '(unknown-req)';
    if (typeof req.description === 'string') surfaces.push({ holderId: rid, holderKind: 'req', field: 'description', text: req.description });
  }
  for (const us of input.userStories) {
    const usid = us.usId || us.id || '(unknown-us)';
    if (typeof us.iWant === 'string') surfaces.push({ holderId: usid, holderKind: 'us', field: 'iWant', text: us.iWant });
    if (Array.isArray(us.acceptanceCriteria)) {
      for (const ac of us.acceptanceCriteria) {
        const acid = ac.id || `${usid}-AC?`;
        const ownerRef = ac.ownerRef && typeof ac.ownerRef === 'object' ? ac.ownerRef : null;
        for (const f of ['description', 'given', 'when', 'then']) {
          if (typeof ac[f] === 'string') surfaces.push({ holderId: acid, holderKind: 'ac', field: f, text: ac[f], parentUsId: usid, ownerRef });
        }
      }
    }
  }
  for (const adr of input.adrs) {
    const aid = adr.adrId || adr.id || '(unknown-adr)';
    for (const f of ['context', 'decision', 'consequences']) {
      if (typeof adr[f] === 'string') surfaces.push({ holderId: aid, holderKind: 'adr', field: f, text: adr[f] });
    }
  }
  if (typeof input.guideMarkdown === 'string' && input.guideMarkdown.length > 0) {
    surfaces.push({ holderId: 'guide', holderKind: 'guide', field: 'body', text: input.guideMarkdown });
  }
  return surfaces;
}

/**
 * @param {{ slug: string, sourcePath: string, tacs: object[], reqs: object[], userStories: object[], adrs: object[], guideMarkdown?: string }} input
 * @returns {ConsistencyFinding[]}
 */
export function runPass1(input) {
  const owned = collectOwnedTokens(input.tacs);
  if (owned.size === 0) return [];
  const surfaces = collectArtefactSurfaces(input);
  /** @type {ConsistencyFinding[]} */
  const findings = [];
  const seen = new Set();

  for (const surface of surfaces) {
    for (const raw of extractTokens(surface.text)) {
      if (isNoise(raw)) continue;
      const key = raw.toLowerCase();
      const owner = owned.get(key);
      if (!owner) continue;
      const isSensitive = owner.klass === 'header' || owner.klass === 'envVar' || owner.klass === 'headerLower';
      // Contract drift: the same lower-cased token, spelled
      // differently, on a case-sensitive axis (HTTP header or
      // env-var). This is the primary mechanical catch and includes
      // the `Cf-Turnstile-Response` / `cf-turnstile-response`
      // specimen shape.
      if (isSensitive && owner.canonical !== raw) {
        // Sentence-start capitalisation is not contract drift.
        // Skip when the two tokens differ ONLY in the case of the
        // very first character (rest of the token is byte-identical).
        if (owner.canonical.length === raw.length
          && owner.canonical.slice(1) === raw.slice(1)
          && owner.canonical[0].toLowerCase() === raw[0].toLowerCase()) continue;
        const id = `pass1-drift-${owner.tacId}-${owner.canonical}`;
        const dedupe = `${id}::${surface.holderId}::${raw}`;
        if (!seen.has(dedupe)) {
          seen.add(dedupe);
          findings.push({
            id, pass: 'pass1', kind: 'contractDrift',
            subject: owner.canonical,
            refs: [owner.tacId, surface.holderId],
            message: `${surface.holderId}.${surface.field} spells '${owner.canonical}' as '${raw}'; owner ${owner.tacId}.${owner.field} declares '${owner.canonical}'.`,
          });
        }
        continue;
      }
      // Undeclared restatement: only fires for AC surfaces (the
      // schema field `ownerRef` lives on AC records), only when the
      // owning surface is an `interfaces[].name` (the strict
      // interface surface), and only when the AC does not name an
      // `ownerRef.tacId` matching the owning TAC. Every other cross
      // surface mention is read as a reference, not a restatement.
      if (surface.holderKind !== 'ac') continue;
      if (!owner.field.startsWith('interfaces[') || !owner.field.endsWith('].name')) continue;
      const ownerRef = surface.ownerRef;
      const declared = ownerRef && typeof ownerRef.tacId === 'string' && ownerRef.tacId === owner.tacId;
      if (declared) continue;
      const id = `pass1-restated-${owner.tacId}-${owner.canonical}`;
      const dedupe = `${id}::${surface.holderId}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      findings.push({
        id, pass: 'pass1', kind: 'undeclaredRestatement',
        subject: owner.canonical,
        refs: [owner.tacId, surface.holderId],
        message: `${surface.holderId}.${surface.field} restates '${owner.canonical}' owned by ${owner.tacId}.${owner.field}; declare ownerRef or turn the mention into a reference.`,
      });
    }
  }
  return findings;
}

// REQ description phrases that read as an externally observable
// promise the lint asks a TAC or ADR to deliver.
const PROMISE_TERMS = [
  'must', 'requires', 'required', 'guarantee', 'guarantees', 'guaranteed',
  'ceiling', 'never', 'invariant', 'on boot', 'at boot', 'boot event',
  'always', 'ensures', 'refuse', 'refuses', 'forbid', 'forbidden',
];

export function runPass2(input) {
  const findings = [];
  const tacsById = new Map();
  for (const t of input.tacs) tacsById.set(t.tacId || t.id, t);
  for (const req of input.reqs) {
    const rid = req.reqId || req.id || '(unknown-req)';
    const desc = typeof req.description === 'string' ? req.description : '';
    const promises = PROMISE_TERMS.some((term) => new RegExp(`(^|[^A-Za-z])${term}([^A-Za-z]|$)`, 'i').test(desc));
    if (!promises) continue;
    const delivery = req.deliveredBy && typeof req.deliveredBy === 'object' ? req.deliveredBy : null;
    if (!delivery || (!delivery.tacId && !delivery.adrId)) {
      findings.push({
        id: `pass2-no-delivery-${rid}`, pass: 'pass2', kind: 'reqNoDelivery',
        subject: rid, refs: [rid],
        message: `${rid}.description promises an externally observable property but declares no deliveredBy link into a TAC or ADR.`,
      });
      continue;
    }
    if (delivery.tacId) {
      const target = tacsById.get(delivery.tacId);
      if (!target) {
        findings.push({
          id: `pass2-delivery-missing-tac-${rid}-${delivery.tacId}`, pass: 'pass2', kind: 'reqDeliveryNotCarried',
          subject: rid, refs: [rid, delivery.tacId],
          message: `${rid}.deliveredBy names TAC ${delivery.tacId} which is not present in the blueprint.`,
        });
        continue;
      }
      const carried = collectTacSurfaceText(target).toLowerCase();
      const field = typeof delivery.field === 'string' ? delivery.field.toLowerCase() : '';
      const fieldTail = field ? field.split('.').pop() : '';
      if (fieldTail && !carried.includes(fieldTail)) {
        findings.push({
          id: `pass2-delivery-field-missing-${rid}-${delivery.tacId}`, pass: 'pass2', kind: 'reqDeliveryNotCarried',
          subject: rid, refs: [rid, delivery.tacId, fieldTail],
          message: `${rid}.deliveredBy points at ${delivery.tacId}.${delivery.field} but that field is not present on the TAC's responsibilities or interfaces.`,
        });
      }
    }
  }
  return findings;
}

function collectTacSurfaceText(tac) {
  const parts = [];
  if (typeof tac.purpose === 'string') parts.push(tac.purpose);
  if (typeof tac.internalStructure === 'string') parts.push(tac.internalStructure);
  if (Array.isArray(tac.responsibilities)) parts.push(tac.responsibilities.filter((s) => typeof s === 'string').join(' '));
  if (Array.isArray(tac.interfaces)) {
    for (const iface of tac.interfaces) {
      if (iface && typeof iface.name === 'string') parts.push(iface.name);
      if (iface && typeof iface.summary === 'string') parts.push(iface.summary);
    }
  }
  return parts.join(' ');
}

/**
 * Load a blueprint from disk into the shape the passes consume.
 *
 * @param {string} sourcePath
 * @returns {Promise<{ slug: string, sourcePath: string, tacs: object[], reqs: object[], userStories: object[], adrs: object[], guideMarkdown: string } | { error: string }>}
 */
export async function loadForLint(sourcePath) {
  let meta;
  try {
    const raw = await readFile(join(sourcePath, 'blueprint.json'), 'utf8');
    meta = JSON.parse(raw);
  } catch (err) {
    return { error: `cannot read blueprint.json under ${sourcePath}: ${err.message}` };
  }
  const slug = meta.slug || '(unknown-slug)';
  const contributions = Array.isArray(meta.contributions) ? meta.contributions : [];
  const tacs = []; const reqs = []; const userStories = []; const adrs = [];
  for (const c of contributions) {
    if (!c || typeof c.path !== 'string') continue;
    const abs = join(sourcePath, 'contributions', c.path);
    let doc;
    try { doc = JSON.parse(await readFile(abs, 'utf8')); } catch { continue; }
    switch (c.kind) {
      case 'tac': tacs.push(doc); break;
      case 'req': reqs.push(doc); break;
      case 'us': userStories.push(doc); break;
      case 'adr': adrs.push(doc); break;
      default: break;
    }
  }
  let guideMarkdown = '';
  try {
    const entries = await readdir(join(sourcePath, 'guide'));
    for (const name of entries) {
      if (!name.endsWith('.md')) continue;
      guideMarkdown += `${await readFile(join(sourcePath, 'guide', name), 'utf8')}\n`;
    }
  } catch { /* no guide directory is fine */ }
  return { slug, sourcePath, tacs, reqs, userStories, adrs, guideMarkdown };
}

/**
 * Extract "Known chain-consistency-lint suppressions" entries from a
 * blueprint's README.md. Returns a Map from finding id to reason.
 */
export async function loadSuppressions(sourcePath) {
  const out = new Map();
  let readme;
  try { readme = await readFile(join(sourcePath, 'README.md'), 'utf8'); } catch { return out; }
  const m = readme.match(/##\s+Known chain-consistency-lint suppressions([\s\S]*?)(\n##\s+|$)/);
  if (!m) return out;
  for (const line of m[1].split('\n')) {
    const rm = line.match(/^\s*[-*]\s+([A-Za-z0-9][A-Za-z0-9._:-]*)\s*:\s*(.+?)\s*$/);
    if (rm) out.set(rm[1], rm[2]);
  }
  return out;
}

/**
 * Run both passes and shape the result envelope. Pass 1 findings that
 * appear in `suppressions` are marked `suppressed: true`; pass 2
 * findings are never suppressible.
 */
export function runLint(input, suppressions = new Map()) {
  const pass1 = runPass1(input);
  const pass2 = runPass2(input);
  let suppressedCount = 0;
  for (const f of pass1) {
    if (suppressions.has(f.id)) {
      f.suppressed = true;
      f.suppressionReason = suppressions.get(f.id);
      suppressedCount += 1;
    }
  }
  const findings = [...pass1, ...pass2];
  const unsuppressed = findings.filter((f) => !f.suppressed);
  return {
    blueprint: input.slug,
    findings,
    verdict: unsuppressed.length === 0 ? 'pass' : 'fail',
    passCounts: { pass1: pass1.length, pass2: pass2.length, suppressed: suppressedCount },
  };
}
