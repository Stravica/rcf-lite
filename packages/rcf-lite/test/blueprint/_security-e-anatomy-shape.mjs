// Shared shape asserter for the five security-family criterion-e
// anatomy tests. Enforces the four 7d evidence shapes per _closure3.md
// addendum: field COMBINATIONS, not single keys.
//
// Four accepted shapes:
//   1. httpRoundTrip    — requestId (truthy) AND status (truthy) AND
//                         at least one body-carrying key (bodyExcerpt,
//                         bodyKeys, bodyRedacted, adapterReturn,
//                         parserReturn, validatorReturn, verifierReturn,
//                         payload, calls) OR a resource id
//                         (createdUserId, createdThenRevokedTokenId,
//                         resourceId, providerMessageId, tokenId).
//   2. inventoryDiff    — a created-then-deleted resource id
//                         (createdUserId or createdThenRevokedTokenId
//                         or createdId or resourceId) AND an absence
//                         observation (listPostAbsence truthy or
//                         listPreContainsCreated truthy).
//   3. deploy           — deployId or deploymentUrl (non-empty).
//   4. conformanceOnly  — row carries `conformanceOnly: true` AND
//                         `limitation` is a non-empty string whose
//                         first token names an AC or REQ (matches
//                         /^security-auth-[a-z]+-(AC|REQ)-\d+/ or a
//                         bare AC-\d+ / REQ-\d+).
//   Skip                — row carries `accountBoundSkipped: true`
//                         AND `reason` names one env var
//                         (non-empty string, no whitespace).
//
// Bare-diagnostic bodies fail on purpose:
//   {status: 0}, {reason: 'x'} (without accountBoundSkipped),
//   {skipped: 'x'} — none satisfy any shape above.

import assert from 'node:assert/strict';

const HTTP_BODY_KEYS = [
  'bodyExcerpt', 'bodyKeys', 'bodyRedacted',
  'adapterReturn', 'parserReturn', 'validatorReturn', 'verifierReturn',
  'payload', 'calls', 'body', 'outcomeKeys',
];
const RESOURCE_ID_KEYS = [
  'createdUserId', 'createdThenRevokedTokenId', 'createdId', 'resourceId',
  'providerMessageId', 'tokenId',
];
const ABSENCE_KEYS = ['listPostAbsence', 'listPreContainsCreated'];
const DEPLOY_KEYS = ['deployId', 'deploymentUrl'];
const LIM_ANCHOR_RE = /^(security-[a-z0-9-]+-)?(AC|REQ)-\d+/;

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

export function classifyShape(row) {
  const ev = (row && row.evidence && typeof row.evidence === 'object' && !Array.isArray(row.evidence)) ? row.evidence : null;

  if (row.accountBoundSkipped === true) {
    const reason = row.reason;
    if (typeof reason === 'string' && reason.length > 0 && !/\s/.test(reason)) {
      return { shape: 'skip', ok: true };
    }
    return { shape: 'skip', ok: false, why: 'accountBoundSkipped requires a non-empty single-token reason naming one env var' };
  }

  if (row.conformanceOnly === true) {
    const lim = row.limitation;
    if (typeof lim === 'string' && lim.length > 0 && LIM_ANCHOR_RE.test(lim)) {
      return { shape: 'conformanceOnly', ok: true };
    }
    return { shape: 'conformanceOnly', ok: false, why: 'conformanceOnly requires a non-empty limitation naming an AC or REQ id' };
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

export function assertShape(row, ctx = '') {
  const anchor = row.anchorAcId ?? row.anchorReqId ?? '(no anchor)';
  const label = row.limitation ? `${anchor} :: ${row.limitation.slice(0, 60)}` : anchor;
  const c = classifyShape(row);
  assert.ok(c.ok, `${ctx} row [${label}] fails anatomy shape check: ${c.why || ''}; detail=${(row.detail || '').slice(0, 200)}`);
  return c;
}
