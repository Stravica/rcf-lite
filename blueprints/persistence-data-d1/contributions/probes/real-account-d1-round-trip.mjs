// Real-account D1 round-trip probe for persistence-data-d1.
//
// Live branch: creates a scratch D1 database via the Cloudflare REST
// API, exercises CREATE TABLE + INSERT + SELECT + DELETE, then
// deletes the database and inventories to confirm absence. This
// observes vendor-side reachability and API contract but does NOT
// observe REQ-001's "facade module is the sole reader of the D1
// binding" property (the probe calls raw REST, not through a
// project facade). Per closure-3 §(2) each row is de-claimed
// (anchorAcId=null, conformanceOnly true) with the limitation naming
// REQ-001. The retained observation is the live create/insert/query/
// delete/inventory round-trip against real Cloudflare D1.
//
// Skip contract: CI_HAS_CLOUDFLARE_ACCOUNT unset -> one skip row;
// then CF_ACCOUNT_ID and CF_API_TOKEN checked one variable per row.
// Auth failure with credentials PRESENT is FAIL, never a passing skip.
export const anchorAcId = 'REQ-001-persistence-data-d1';
export const accountBound = true;
const OBS = 'observed a live scratch D1 database round-trip (limitation naming REQ-001)';
const REQ1_LIM = `REQ-001 requires the store facade module to be the SOLE reader of the D1 binding across the project's source modules. Raw Cloudflare REST CRUD is a vendor-reachability observation, not evidence of the facade module's sole-reader property.`;

const API = 'https://api.cloudflare.com/client/v4';
const NAME_PREFIX = 'qa-e-d1-';
function shortId() { return Math.random().toString(36).slice(2, 8); }
function skipRow(reason, detail) { return { anchorAcId: null, conformanceOnly: true, limitation: REQ1_LIM, verdict: 'pass', accountBoundSkipped: true, reason, detail }; }
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
    return { results: [skipRow('CI_HAS_CLOUDFLARE_ACCOUNT', `${OBS}  -  accountBoundSkipped: CI_HAS_CLOUDFLARE_ACCOUNT not set to true.`)], extra: commonExtra({ accountBoundSkipped: true, reason: 'CI_HAS_CLOUDFLARE_ACCOUNT' }) };
  }
  const skipRows = [];
  if (!process.env.CF_ACCOUNT_ID) skipRows.push(skipRow('CF_ACCOUNT_ID', `${OBS}  -  accountBoundSkipped: CF_ACCOUNT_ID unset.`));
  if (!process.env.CF_API_TOKEN) skipRows.push(skipRow('CF_API_TOKEN', `${OBS}  -  accountBoundSkipped: CF_API_TOKEN unset.`));
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
      anchorAcId: null,
      conformanceOnly: true,
      limitation: REQ1_LIM,
      verdict: 'fail',
      detail: `${OBS}  -  observed D1 create refused as auth failure with credentials PRESENT: status=${create.status} errors=${JSON.stringify(create.body?.errors)}. Gate CI_HAS_CLOUDFLARE_ACCOUNT is set; auth failure is not a legal skip.`,
      evidence: { createStatus: create.status, createRequestId: create.requestId, createErrors: create.body?.errors ?? null, bodyExcerpt: `authFail status=${create.status}` },
    });
    return { results, extra: commonExtra(evidence) };
  }
  if (!create.body?.success) {
    results.push({
      anchorAcId: null,
      conformanceOnly: true,
      limitation: REQ1_LIM,
      verdict: 'fail',
      detail: `${OBS}  -  observed D1 create failed status=${create.status} errors=${JSON.stringify(create.body?.errors)}.`,
      evidence: { createStatus: create.status, createRequestId: create.requestId, createErrors: create.body?.errors ?? null, bodyExcerpt: `createFail status=${create.status}` },
    });
    return { results, extra: commonExtra(evidence) };
  }
  const dbId = create.body.result.uuid;
  evidence.databaseUuid = dbId;
  results.push({
    anchorAcId: null,
    conformanceOnly: true,
    limitation: REQ1_LIM,
    verdict: 'pass',
    detail: `${OBS}  -  observed real D1 database created uuid=${dbId} name=${name} createStatus=${create.status} cfRay=${create.requestId} via POST /accounts/{id}/d1/database.`,
    evidence: { databaseUuid: dbId, createStatus: create.status, createRequestId: create.requestId, presentAfterDelete: false, bodyExcerpt: `create uuid=${dbId} status=${create.status}` },
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
      anchorAcId: null,
      conformanceOnly: true,
      limitation: REQ1_LIM,
      verdict: queryResp.status === 200 && count === 1 ? 'pass' : 'fail',
      detail: `${OBS}  -  observed CREATE TABLE + INSERT + SELECT round-trip on real D1 uuid=${dbId}; query status=${queryResp.status} cfRay=${queryResp.requestId} count=${count} via POST /accounts/{id}/d1/database/{uuid}/query.`,
      evidence: { databaseUuid: dbId, queryStatus: queryResp.status, requestId: queryResp.requestId, queryRequestId: queryResp.requestId, selectedCount: count, bodyExcerpt: JSON.stringify(queryResp.body).slice(0, 400), queryBodyExcerpt: JSON.stringify(queryResp.body).slice(0, 400), presentAfterDelete: true },
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
      anchorAcId: null,
      conformanceOnly: true,
      limitation: REQ1_LIM,
      verdict: del.status === 200 && list.status === 200 && !stillPresent ? 'pass' : 'fail',
      detail: `${OBS}  -  observed DELETE uuid=${dbId} -> ${del.status}; inventory GET -> ${list.status}; presentAfterDelete=${stillPresent} (absence-in-inventory diff shape confirms the create was real).`,
      evidence: { databaseUuid: dbId, deleteStatus: del.status, deleteRequestId: del.requestId, inventoryStatus: list.status, inventoryRequestId: list.requestId, inventoryCount: inventoryRows.length, presentAfterDelete: stillPresent, bodyExcerpt: `delete status=${del.status} inventory count=${inventoryRows.length} presentAfterDelete=${stillPresent}` },
    });
  }
  return { results, extra: commonExtra(evidence) };
}
