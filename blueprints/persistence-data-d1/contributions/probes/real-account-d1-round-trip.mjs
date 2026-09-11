// Real-account D1 round-trip probe for persistence-data-d1.
//
// Live branch: creates a scratch D1 database via the Cloudflare REST
// API (POST /accounts/{id}/d1/database), runs a CREATE TABLE and a
// SELECT via the query endpoint (POST /accounts/{id}/d1/database/{uuid}/query),
// then deletes the database (DELETE /accounts/{id}/d1/database/{uuid})
// and confirms the uuid is absent from the account's D1 inventory
// (GET /accounts/{id}/d1/database).
//
// Vendor citation: Cloudflare D1 REST API,
// https://developers.cloudflare.com/api/operations/cloudflare-d1-list-databases
// (verified on 2026-09-11).
//
// Positive-evidence shape (rule 7d): created-then-deleted resource id
// in an inventory diff; the report carries the scratch uuid, the
// vendor request ids (cf-ray) on each call, the response body excerpt
// from the query call, the post-run inventory response and the
// inventory-diff verdict.
//
// Honest skip: without CI_HAS_CLOUDFLARE_ACCOUNT=true the probe
// records accountBoundSkipped: true and the reason names the unset
// var. If the gate variable is set but any credential var is unset
// there is one result row per unset var, each an honest skip.
// If the gate and credentials are all SET but the API returns 403
// / auth failure, that is a FAIL with the error excerpt: an auth
// failure is not a legal skip.
//
// anchorAcId: AC-13103-1 (deploy-gate flavoured: apply migration
// cleanly to the target D1 environment). accountBound: true.

export const anchorAcId = 'AC-13103-1';
export const accountBound = true;

const API = 'https://api.cloudflare.com/client/v4';
const NAME_PREFIX = 'qa-e-d1-';

function shortId() { return Math.random().toString(36).slice(2, 8); }

function skipRow(reason, detail) {
  return { anchorAcId, verdict: 'pass', accountBoundSkipped: true, reason, detail };
}

function commonExtra(base = {}) {
  return {
    envDeclared: ['CI_HAS_CLOUDFLARE_ACCOUNT', 'CF_ACCOUNT_ID', 'CF_API_TOKEN'],
    vendorFact: {
      url: 'https://developers.cloudflare.com/api/operations/cloudflare-d1-list-databases',
      verifiedOn: '2026-09-11',
    },
    namePrefix: NAME_PREFIX,
    ...base,
  };
}

async function cf(path, opts = {}) {
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${process.env.CF_API_TOKEN}`,
      'Content-Type': 'application/json',
      ...(opts.headers ?? {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, requestId: res.headers.get('cf-ray') || res.headers.get('x-request-id'), body };
}

function isAuthFailure(status, body) {
  if (status === 401 || status === 403) return true;
  const errs = body?.errors;
  if (Array.isArray(errs)) {
    return errs.some((e) => e.code === 10000 || e.code === 9109 || e.code === 6003);
  }
  return false;
}

export default async function runProbe() {
  if (process.env.CI_HAS_CLOUDFLARE_ACCOUNT !== 'true') {
    return {
      results: [skipRow('CI_HAS_CLOUDFLARE_ACCOUNT', 'accountBoundSkipped: CI_HAS_CLOUDFLARE_ACCOUNT is not set to true; per spec section 3.5 the aggregate flips to pass.')],
      extra: commonExtra({ accountBoundSkipped: true, reason: 'CI_HAS_CLOUDFLARE_ACCOUNT' }),
    };
  }
  const skipRows = [];
  if (!process.env.CF_ACCOUNT_ID) skipRows.push(skipRow('CF_ACCOUNT_ID', 'accountBoundSkipped: CF_ACCOUNT_ID unset.'));
  if (!process.env.CF_API_TOKEN) skipRows.push(skipRow('CF_API_TOKEN', 'accountBoundSkipped: CF_API_TOKEN unset.'));
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
    // Gate is on and credentials are set: an auth failure is a real
    // failure, never a skip. Report the FAIL with the error excerpt
    // so the reviewer sees what the vendor returned.
    results.push({
      anchorAcId,
      verdict: 'fail',
      detail: `D1 create refused as auth failure with credentials PRESENT: status=${create.status} errors=${JSON.stringify(create.body?.errors)}. The gate CI_HAS_CLOUDFLARE_ACCOUNT is set; an auth failure is not a legal skip.`,
      evidence: { createStatus: create.status, createRequestId: create.requestId, createErrors: create.body?.errors ?? null },
    });
    return { results, extra: commonExtra(evidence) };
  }
  if (!create.body?.success) {
    results.push({
      anchorAcId,
      verdict: 'fail',
      detail: `D1 create failed status=${create.status} errors=${JSON.stringify(create.body?.errors)}`,
      evidence: { createStatus: create.status, createRequestId: create.requestId, createErrors: create.body?.errors ?? null },
    });
    return { results, extra: commonExtra(evidence) };
  }
  const dbId = create.body.result.uuid;
  evidence.databaseUuid = dbId;

  let queryResp;
  let queryRow = null;
  try {
    await cf(`/accounts/${accountId}/d1/database/${dbId}/query`, { method: 'POST', body: JSON.stringify({ sql: 'CREATE TABLE probe_items (id INTEGER PRIMARY KEY, name TEXT NOT NULL)' }) });
    await cf(`/accounts/${accountId}/d1/database/${dbId}/query`, { method: 'POST', body: JSON.stringify({ sql: `INSERT INTO probe_items (name) VALUES ('probe-${dbId.slice(0, 6)}')` }) });
    queryResp = await cf(`/accounts/${accountId}/d1/database/${dbId}/query`, { method: 'POST', body: JSON.stringify({ sql: 'SELECT COUNT(*) AS n FROM probe_items' }) });
    const count = queryResp.body?.result?.[0]?.results?.[0]?.n;
    evidence.queryStatus = queryResp.status;
    evidence.queryRequestId = queryResp.requestId;
    evidence.selectCount = count;
    evidence.queryBodyExcerpt = JSON.stringify(queryResp.body).slice(0, 400);
    queryRow = {
      anchorAcId: 'AC-13103-1',
      verdict: queryResp.status === 200 && count === 1 ? 'pass' : 'fail',
      detail: `real D1 database uuid=${dbId}; migration and INSERT applied; SELECT count=${count}`,
      evidence: { databaseUuid: dbId, queryStatus: queryResp.status, requestId: queryResp.requestId, selectedCount: count, bodyExcerpt: JSON.stringify(queryResp.body).slice(0, 400) },
    };
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

    if (queryRow) results.push(queryRow);
    results.push({
      anchorAcId: 'AC-13103-2',
      verdict: del.status === 200 && list.status === 200 && !stillPresent ? 'pass' : 'fail',
      detail: `DELETE uuid=${dbId} -> ${del.status}; inventory GET -> ${list.status}; presentAfterDelete=${stillPresent}. The inventory GET must have returned 200 for the diff to be trusted (a non-200 listing is not evidence of absence).`,
      evidence: {
        deleteStatus: del.status,
        deleteRequestId: del.requestId,
        inventoryStatus: list.status,
        inventoryRequestId: list.requestId,
        inventoryCount: inventoryRows.length,
        presentAfterDelete: stillPresent,
      },
    });
  }
  return { results, extra: commonExtra(evidence) };
}
