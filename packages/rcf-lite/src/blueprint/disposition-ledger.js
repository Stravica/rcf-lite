// Per-slug disposition ledger for applied blueprints. Sits alongside
// the existing `<slug>.applied.json` sidecar (see capabilities.js) and
// records one entry per AC contributed by the blueprint, plus the
// disposition the applying agent (or the operator) recorded.
//
// Schema follow-up: a `$defs/blueprintDispositionLedger` shape lands
// on `@stravica-ai/rcf-schemas` alongside the four fields the 0.6.2
// bump already ships (deliveredBy, ownerRef, disposition,
// vendorCitation). Until it does, the ledger validates itself via the
// local `validateRecord` guard so a malformed write refuses before
// touching the file.
//
// Ledger location: `rcf/blueprints/<slug>.disposition.json`.

import { readFile, mkdir, writeFile, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';

const ACTIONS = new Set([
  'pending-disposition',
  'pending-operator',
  'accepted',
  'adjusted',
  'dropped',
  'escalated-as-defect',
]);

/**
 * @typedef {object} DispositionRecord
 * @property {string} acId
 * @property {string} storyId
 * @property {'fixed'|'template'} [sourceDisposition]
 * @property {'pending-disposition'|'pending-operator'|'accepted'|'adjusted'|'dropped'|'escalated-as-defect'} action
 * @property {string} [reason]
 * @property {string} [resolvedAt]
 * @property {string} [resolvedBy]
 * @property {string} [escalatedAt]
 * @property {boolean} [escalatedToOperator]
 * @property {string} [defectUrl]
 */

/**
 * Ledger file path (relative to project root).
 *
 * @param {string} slug
 */
export function ledgerRelPath(slug) {
  return join('rcf', 'blueprints', `${slug}.disposition.json`);
}

/**
 * Absolute path helper.
 */
export function ledgerAbsPath(projectRoot, slug) {
  return join(projectRoot, ledgerRelPath(slug));
}

/**
 * Best-effort shape check for a single ledger record. Returns null on
 * ok, an error string on any refusal.
 *
 * @param {any} rec
 * @returns {string | null}
 */
function validateRecord(rec) {
  if (!rec || typeof rec !== 'object') return 'record is not an object';
  if (typeof rec.acId !== 'string' || rec.acId.length === 0) return 'acId is missing';
  if (typeof rec.storyId !== 'string' || rec.storyId.length === 0) return 'storyId is missing';
  if (typeof rec.action !== 'string' || !ACTIONS.has(rec.action)) return `action must be one of ${[...ACTIONS].join(', ')}; got '${rec.action}'`;
  if (rec.sourceDisposition !== undefined && rec.sourceDisposition !== 'fixed' && rec.sourceDisposition !== 'template') {
    return `sourceDisposition must be 'fixed' or 'template' when set; got '${rec.sourceDisposition}'`;
  }
  return null;
}

/**
 * Read a slug's ledger from disk. Missing file returns null.
 *
 * @param {string} projectRoot
 * @param {string} slug
 * @returns {Promise<{ slug: string, schemaVersion: number, records: DispositionRecord[] } | null>}
 */
export async function readLedger(projectRoot, slug) {
  const abs = ledgerAbsPath(projectRoot, slug);
  try {
    const raw = await readFile(abs, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err && err.code === 'ENOENT') return null;
    throw err;
  }
}

/**
 * Presence check for the ledger file. Does not parse.
 *
 * @param {string} projectRoot
 * @param {string} slug
 * @returns {Promise<boolean>}
 */
export async function ledgerExists(projectRoot, slug) {
  try { await stat(ledgerAbsPath(projectRoot, slug)); return true; } catch { return false; }
}

/**
 * Write a whole ledger document (overwrites). Validates every record
 * before touching disk; a bad record returns { error: string } and
 * writes nothing.
 *
 * @param {object} args
 * @param {string} args.projectRoot
 * @param {string} args.slug
 * @param {DispositionRecord[]} args.records
 * @returns {Promise<{ path: string } | { error: string }>}
 */
export async function writeLedger({ projectRoot, slug, records }) {
  if (!Array.isArray(records)) return { error: 'records must be an array' };
  for (const r of records) {
    const err = validateRecord(r);
    if (err) return { error: `invalid ledger record for AC '${r?.acId ?? '?'}': ${err}` };
  }
  const abs = ledgerAbsPath(projectRoot, slug);
  await mkdir(dirname(abs), { recursive: true });
  const payload = { slug, schemaVersion: 1, records };
  await writeFile(abs, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return { path: ledgerRelPath(slug) };
}

/**
 * Initialise a ledger for a freshly-applied blueprint. One record
 * per AC contributed by the blueprint. Existing ledger (re-apply)
 * is left byte-identical so operator disposition edits are never
 * clobbered; the return value carries `alreadyExisted: true`.
 *
 * A `fixed` AC (per rcf-schemas 0.6.2 `$defs.acDisposition`) lands as
 * `accepted` with the sentinel reason `fixed-mechanism-inherited`,
 * per spec section 3.6.
 *
 * @param {object} args
 * @param {string} args.projectRoot
 * @param {string} args.slug
 * @param {Array<{ id: string, storyId: string, sourceDisposition?: 'fixed'|'template' }>} args.acDescriptors
 * @param {Date}   [args.now]
 * @returns {Promise<{ path: string, alreadyExisted: boolean, recordCount: number }>}
 */
export async function initialiseLedger({ projectRoot, slug, acDescriptors, now = new Date() }) {
  if (await ledgerExists(projectRoot, slug)) {
    const existing = await readLedger(projectRoot, slug);
    return { path: ledgerRelPath(slug), alreadyExisted: true, recordCount: existing?.records?.length ?? 0 };
  }
  const iso = now.toISOString().slice(0, 10);
  const records = acDescriptors.map((d) => {
    const base = { acId: d.id, storyId: d.storyId };
    if (d.sourceDisposition === 'fixed') {
      return { ...base, sourceDisposition: 'fixed', action: 'accepted', reason: 'fixed-mechanism-inherited', resolvedAt: iso, resolvedBy: 'blueprint-author' };
    }
    if (d.sourceDisposition === 'template') {
      return { ...base, sourceDisposition: 'template', action: 'pending-disposition' };
    }
    return { ...base, action: 'pending-disposition' };
  });
  const res = await writeLedger({ projectRoot, slug, records });
  if ('error' in res) throw new Error(`ledger init failed: ${res.error}`);
  return { path: res.path, alreadyExisted: false, recordCount: records.length };
}

/**
 * Update or append a single AC record. If the acId is present, its
 * fields are merged (later fields win); otherwise the record is
 * appended. Returns { updated: boolean, path } on success.
 */
export async function upsertLedgerRecord({ projectRoot, slug, record }) {
  const err = validateRecord(record);
  if (err) return { error: err };
  const doc = (await readLedger(projectRoot, slug)) ?? { slug, schemaVersion: 1, records: [] };
  let updated = false;
  const next = doc.records.map((r) => {
    if (r.acId === record.acId) { updated = true; return { ...r, ...record }; }
    return r;
  });
  if (!updated) next.push(record);
  const res = await writeLedger({ projectRoot, slug, records: next });
  if ('error' in res) return res;
  return { updated, path: res.path };
}

// The prompt the operator sees at apply time. Kept a canonical string
// so tests can assert against it and the dispatch spec can echo it
// verbatim. Contains no em-dashes and no internal identifiers so it
// reads cleanly in third-party output.
export const APPLY_DISPOSITION_PROMPT = (slug, version, count) => (
  `Blueprint '${slug}' v${version} contributed ${count} acceptance criteria. `
  + `For each, you or the applying agent must record a disposition (accept as authored, adjust with a stated reason, `
  + `drop with a stated reason, or escalate to the operator). `
  + `Run 'rcf define blueprint dispositions ${slug}' at any time to see the current state; `
  + `the applying agent will drive the walk unless you want to do it yourself.`
);

/**
 * Ledger schema documentation the follow-up rcf-schemas PR will land.
 * Kept close to the writer so the local guard and the eventual schema
 * definition stay in step.
 */
export const LEDGER_SCHEMA_NOTE = `
The per-slug disposition ledger is a JSON object with:
  { slug: string,
    schemaVersion: 1,
    records: [
      { acId: string,
        storyId: string,
        sourceDisposition?: 'fixed' | 'template',
        action: 'pending-disposition' | 'pending-operator' | 'accepted' | 'adjusted' | 'dropped' | 'escalated-as-defect',
        reason?: string,
        resolvedAt?: string (ISO date),
        resolvedBy?: string,
        escalatedAt?: string (ISO date),
        escalatedToOperator?: boolean,
        defectUrl?: string
      }, ...
    ]
  }
Follow-up: a $defs/blueprintDispositionLedger schema on @stravica-ai/rcf-schemas
will make the shape validator-checkable; today the ledger writer guards it
inline (see validateRecord).
`.trim();
