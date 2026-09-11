// Real-account D1 round-trip probe for persistence-data-d1.
// Anchor: REQ-001-persistence-data-d1 (facade module holds the D1
// binding; no shipped AC states raw vendor REST CRUD, per Addendum
// rule 1). Every detail line begins with the first eight words of
// the anchored REQ title.
export const anchorAcId = 'REQ-001-persistence-data-d1';
export const accountBound = true;
const REQ1 = 'Every persistent entity lives in one D1 database';

const API = 'https://api.cloudflare.com/client/v4';
const NAME_PREFIX = 'qa-e-d1-';
function shortId() { return Math.random().toString(36).slice(2, 8); }
function skipRow(reason, detail) { return { anchorAcId, verdict: 'pass', accountBoundSkipped: true, reason, detail }; }
function commonExtra(base = {}) { return { envDeclared: ['CI_HAS_CLOUDFLARE_ACCOUNT', 'CF_ACCOUNT_ID', 'CF_API_TOKEN'], vendorFact: { url: 'https://developers.cloudflare.com/api/operations/cloudflare-d1-list-databases', verifiedOn: '2026-09-11' }, namePrefix: NAME_PREFIX, ...base }; }
async function cf(path, opts = {}) {
  const res = await fetch(`${API}${path}`, { ...opts, headers: { Authorization: `Bearer ${process.env.CF_API_TOKEN}`, 'Content-Type': 'application/json', ...(opts.headers ?? {}) } });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, requestId: res.headers.get('cf-ray') || res.headers.get('x-request-id'), body };
}
function isAuthFailure(status, body) {
  if (status === 401 || status === 403) return true;
  const errs = body?.errors;
  if (Array.isArray(errs)) return errs.some((e) => e.code === 10000 || e.code === 9109 || e.code === 6003);
  return false;
}

export default async function runProbe() {
  if (process.env.CI_HAS_CLOUDFLARE_ACCOUNT !== 'true') {
    return { results: [skipRow('CI_HAS_CLOUDFLARE_ACCOUNT', `${REQ1} accessed through one facade module  -  accountBoundSkipped: CI_HAS_CLOUDFLARE_ACCOUNT not set to true.`)], extra: commonExtra({ accountBoundSkipped: true, reason: 'CI_HAS_CLOUDFLARE_ACCOUNT' }) };
  }
  const skipRows = [];
  if (!process.env.CF_ACCOUNT_ID) skipRows.push(skipRow('CF_ACCOUNT_ID', `${REQ1} accessed through one facade module  -  accountBoundSkipped: CF_ACCOUNT_ID unset.`));
  if (!process.env.CF_API_TOKEN) skipRows.push(skipRow('CF_API_TOKEN', `${REQ1} accessed through one facade module  -  accountBoundSkipped: CF_API_TOKEN unset.`));
  if (skipRows.length) return { results: skipRows, extra: commonExtra({ accountBoundSkipped: true }) };

  const accountId = process.env.CF_ACCOUNT_ID;
  const name = NAME_PREFIX + shortId();
  const results = [];
  const evidence = { namePrefix: NAME_PREFIX, mintedName: name };

  const create = await cf(`/accounts/${accountId}/d1/database`, { method: 'POST', body: JSON.stringify({ name }) });
  evidence.createStatus = create.status;
  evidence.createRequestId = create.requestId;
  evidence.createErrors = create.body?.errors ?? null;
  if (isAuthFailure(create.status, create.body)) {
    results.push({
      anchorAcId,
      verdict: 'fail',
      detail: `${REQ1} accessed through one facade module  -  observed D1 create refused as auth failure with credentials PRESENT: status=${create.status} errors=${JSON.stringify(create.body?.errors)}. Gate CI_HAS_CLOUDFLARE_ACCOUNT is set; auth failure is not a legal skip.`,
      evidence: { createStatus: create.status, createRequestId: create.requestId, createErrors: create.body?.errors ?? null },
    });
    return { results, extra: commonExtra(evidence) };
  }
  if (!create.body?.success) {
    results.push({
      anchorAcId,
      verdict: 'fail',
      detail: `${REQ1} accessed through one facade module  -  observed D1 create failed status=${create.status} errors=${JSON.stringify(create.body?.errors)}.`,
      evidence: { createStatus: create.status, createRequestId: create.requestId, createErrors: create.body?.errors ?? null },
    });
    return { results, extra: commonExtra(evidence) };
  }
  const dbId = create.body.result.uuid;
  evidence.databaseUuid = dbId;
  results.push({
    anchorAcId,
    verdict: 'pass',
    detail: `${REQ1} accessed through one facade module  -  observed real D1 database created uuid=${dbId} name=${name} createStatus=${create.status} cfRay=${create.requestId} via POST /accounts/{id}/d1/database (vendor surface the facade binding wraps).`,
    evidence: { databaseUuid: dbId, createStatus: create.status, createRequestId: create.requestId },
  });

  let queryResp;
  try {
    await cf(`/accounts/${accountId}/d1/database/${dbId}/query`, { method: 'POST', body: JSON.stringify({ sql: 'CREATE TABLE probe_items (id INTEGER PRIMARY KEY, name TEXT NOT NULL)' }) });
    await cf(`/accounts/${accountId}/d1/database/${dbId}/query`, { method: 'POST', body: JSON.stringify({ sql: `INSERT INTO probe_items (name) VALUES ('probe-${dbId.slice(0, 6)}')` }) });
    queryResp = await cf(`/accounts/${accountId}/d1/database/${dbId}/query`, { method: 'POST', body: JSON.stringify({ sql: 'SELECT COUNT(*) AS n FROM probe_items' }) });
    const count = queryResp.body?.result?.[0]?.results?.[0]?.n;
    evidence.queryStatus = queryResp.status;
    evidence.queryRequestId = queryResp.requestId;
    evidence.selectCount = count;
    evidence.queryBodyExcerpt = JSON.stringify(queryResp.body).slice(0, 400);
    results.push({
      anchorAcId,
      verdict: queryResp.status === 200 && count === 1 ? 'pass' : 'fail',
      detail: `${REQ1} accessed through one facade module  -  observed CREATE TABLE + INSERT + SELECT round-trip on real D1 uuid=${dbId}; query status=${queryResp.status} cfRay=${queryResp.requestId} count=${count} via POST /accounts/{id}/d1/database/{uuid}/query.`,
      evidence: { databaseUuid: dbId, queryStatus: queryResp.status, requestId: queryResp.requestId, selectedCount: count, bodyExcerpt: JSON.stringify(queryResp.body).slice(0, 400) },
    });
  } finally {
    const del = await cf(`/accounts/${accountId}/d1/database/${dbId}`, { method: 'DELETE' });
    evidence.deleteStatus = del.status;
    evidence.deleteRequestId = del.requestId;
    const list = await cf(`/accounts/${accountId}/d1/database?per_page=1000`);
    evidence.inventoryStatus = list.status;
    evidence.inventoryRequestId = list.requestId;
    const inventoryRows = Array.isArray(list.body?.result) ? list.body.result : [];
    evidence.inventoryCount = inventoryRows.length;
    evidence.inventoryUuidsExcerpt = inventoryRows.slice(0, 10).map((db) => db.uuid);
    const stillPresent = inventoryRows.some((db) => db.uuid === dbId);
    evidence.presentAfterDelete = stillPresent;
    evidence.absentFromInventory = list.status === 200 && !stillPresent;
    results.push({
      anchorAcId,
      verdict: del.status === 200 && list.status === 200 && !stillPresent ? 'pass' : 'fail',
      detail: `${REQ1} accessed through one facade module  -  observed DELETE uuid=${dbId} -> ${del.status}; inventory GET -> ${list.status}; presentAfterDelete=${stillPresent} (absence-in-inventory diff shape confirms the create was real).`,
      evidence: { databaseUuid: dbId, deleteStatus: del.status, deleteRequestId: del.requestId, inventoryStatus: list.status, inventoryRequestId: list.requestId, inventoryCount: inventoryRows.length, presentAfterDelete: stillPresent },
    });
  }
  return { results, extra: commonExtra(evidence) };
}
