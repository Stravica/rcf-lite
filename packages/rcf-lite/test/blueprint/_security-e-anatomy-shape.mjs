// Shared shape asserter for the five security-family criterion-e
// anatomy tests. Enforces the four 7d evidence shapes by field
// COMBINATIONS, not single keys.
//
// Four accepted shapes:
//   1. httpRoundTrip   , requestId (truthy) AND status (truthy) AND
//                        at least one body-carrying key (bodyExcerpt,
//                        bodyKeys, bodyRedacted, adapterReturn,
//                        parserReturn, validatorReturn, verifierReturn,
//                        payload, calls) OR a resource id
//                        (createdUserId, createdThenRevokedTokenId,
//                        resourceId, providerMessageId, tokenId).
//   2. inventoryDiff   , a created-then-deleted resource id
//                        (createdUserId or createdThenRevokedTokenId
//                        or createdId or resourceId) AND a post-delete
//                        ABSENCE observation (listPostAbsence truthy).
//                        Pre-delete presence never satisfies this
//                        shape on its own.
//   3. deploy          , deployId or deploymentUrl (non-empty).
//   4. conformanceOnly , row carries `conformanceOnly: true` AND
//                        `anchorAcId === null` AND `limitation` is a
//                        non-empty string that begins with a shipped
//                        AC id of shape `<slug>-AC-<num>-<num>` (or
//                        bare `AC-<num>-<num>`). REQ-shaped anchors
//                        are refused. When the caller supplies a
//                        shippedAcIds set the id extracted from the
//                        limitation must appear in it, so a
//                        fabricated but syntactically valid id fails.
//   Skip               , row carries `accountBoundSkipped: true` AND
//                        `reason` names one env var (non-empty,
//                        no whitespace).
//
// Bare-diagnostic bodies fail on purpose:
//   {status: 0}, {reason: 'x'} (without accountBoundSkipped),
//   {skipped: 'x'} , none satisfy any shape above.

import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const HTTP_BODY_KEYS = [
  'bodyExcerpt', 'bodyKeys', 'bodyRedacted',
  'adapterReturn', 'parserReturn', 'validatorReturn', 'verifierReturn',
  'payload', 'calls', 'body', 'outcomeKeys',
];
const RESOURCE_ID_KEYS = [
  'createdUserId', 'createdThenRevokedTokenId', 'createdId', 'resourceId',
  'providerMessageId', 'tokenId',
];
const ABSENCE_KEYS = ['listPostAbsence'];
const DEPLOY_KEYS = ['deployId', 'deploymentUrl'];
// Limitation must open with a shipped AC id. `AC-<num>-<num>` bare, or
// prefixed by a slug segment. A `REQ-` prefix is rejected: REQ ids are
// not shipped acceptance criteria and cannot stand in as a limitation
// anchor.
const LIM_ANCHOR_RE = /^(?:([a-z][a-z0-9-]*)-)?(AC-\d+-\d+)/;

function truthy(v) {
  if (v === undefined || v === null) return false;
  if (typeof v === 'string') return v.length > 0;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'boolean') return v;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object') return Object.keys(v).length > 0;
  return Boolean(v);
}

function hasAnyKey(obj, keys) {
  for (const k of keys) if (k in obj && truthy(obj[k])) return true;
  return false;
}

// Load every shipped acceptance-criterion id from a blueprint's
// user-stories directory. Returns a Set carrying both the bare form
// `AC-<n>-<n>` and every slug-prefixed form `<slug>-AC-<n>-<n>` seen
// on any story file. The AC set is what the anatomy asserter checks
// conformance-only limitations against, so a limitation whose AC id
// does not name a real shipped AC on this blueprint is refused.
export async function loadShippedAcIds(blueprintRoot) {
  const dir = join(blueprintRoot, 'contributions', 'user-stories');
  const ids = new Set();
  if (!existsSync(dir)) return ids;
  const entries = await readdir(dir);
  for (const name of entries) {
    if (!name.endsWith('.json')) continue;
    let story;
    try { story = JSON.parse(await readFile(join(dir, name), 'utf8')); }
    catch { continue; }
    const usId = typeof story.usId === 'string' ? story.usId : '';
    // Slug is the story-id text before the final `-US-<n>` segment.
    const slugMatch = /^(.+)-US-\d+$/.exec(usId);
    const slug = slugMatch ? slugMatch[1] : null;
    const acs = Array.isArray(story.acceptanceCriteria) ? story.acceptanceCriteria : [];
    for (const ac of acs) {
      const bare = ac && typeof ac.id === 'string' ? ac.id : '';
      if (!/^AC-\d+-\d+$/.test(bare)) continue;
      ids.add(bare);
      if (slug) ids.add(`${slug}-${bare}`);
    }
  }
  return ids;
}

export function classifyShape(row, opts = {}) {
  const shippedAcIds = opts && opts.shippedAcIds instanceof Set ? opts.shippedAcIds : null;
  const ev = (row && row.evidence && typeof row.evidence === 'object' && !Array.isArray(row.evidence)) ? row.evidence : null;

  if (row.accountBoundSkipped === true) {
    const reason = row.reason;
    if (typeof reason === 'string' && reason.length > 0 && !/\s/.test(reason)) {
      return { shape: 'skip', ok: true };
    }
    return { shape: 'skip', ok: false, why: 'accountBoundSkipped requires a non-empty single-token reason naming one env var' };
  }

  if (row.conformanceOnly === true) {
    if (row.anchorAcId !== null) {
      return { shape: 'conformanceOnly', ok: false, why: 'conformanceOnly requires anchorAcId to be exactly null' };
    }
    const lim = row.limitation;
    if (typeof lim !== 'string' || lim.length === 0) {
      return { shape: 'conformanceOnly', ok: false, why: 'conformanceOnly requires a non-empty limitation' };
    }
    const m = LIM_ANCHOR_RE.exec(lim);
    if (!m) {
      return { shape: 'conformanceOnly', ok: false, why: `conformanceOnly limitation must open with a shipped AC id of shape AC-<n>-<n> (REQ-prefixed anchors are refused); got ${JSON.stringify(lim.slice(0, 60))}` };
    }
    if (shippedAcIds) {
      const slugPrefix = m[1] || null;
      const bare = m[2];
      const full = slugPrefix ? `${slugPrefix}-${bare}` : null;
      const hitBare = shippedAcIds.has(bare);
      const hitFull = full ? shippedAcIds.has(full) : false;
      if (!hitBare && !hitFull) {
        return { shape: 'conformanceOnly', ok: false, why: `conformanceOnly limitation opens with ${full || bare} which does not name a shipped acceptance criterion on this blueprint's user stories` };
      }
    }
    return { shape: 'conformanceOnly', ok: true };
  }

  if (!ev) {
    return { shape: 'unknown', ok: false, why: 'evidence must be an object' };
  }

  if (hasAnyKey(ev, DEPLOY_KEYS)) return { shape: 'deploy', ok: true };

  const rid = truthy(ev.requestId);
  const st = truthy(ev.status);
  const hasBody = hasAnyKey(ev, HTTP_BODY_KEYS) || hasAnyKey(ev, RESOURCE_ID_KEYS);
  if (rid && st && hasBody) return { shape: 'httpRoundTrip', ok: true };

  const hasCreated = hasAnyKey(ev, RESOURCE_ID_KEYS);
  const hasAbsence = hasAnyKey(ev, ABSENCE_KEYS);
  if (hasCreated && hasAbsence) return { shape: 'inventoryDiff', ok: true };

  return { shape: 'unknown', ok: false, why: `no 7d shape matched; evidence keys=${JSON.stringify(Object.keys(ev))}` };
}

export function assertShape(row, ctx = '', opts = {}) {
  // Backwards-compatible signature: callers may pass opts positionally
  // as the second arg, or as the third arg alongside a ctx label.
  let ctxLabel = '';
  let options = {};
  if (typeof ctx === 'string') {
    ctxLabel = ctx;
    options = opts && typeof opts === 'object' ? opts : {};
  } else if (ctx && typeof ctx === 'object') {
    options = ctx;
  }
  const anchor = row.anchorAcId ?? row.anchorReqId ?? '(no anchor)';
  const label = row.limitation ? `${anchor} :: ${row.limitation.slice(0, 60)}` : anchor;
  const c = classifyShape(row, options);
  assert.ok(c.ok, `${ctxLabel} row [${label}] fails anatomy shape check: ${c.why || ''}; detail=${(row.detail || '').slice(0, 200)}`);
  return c;
}
