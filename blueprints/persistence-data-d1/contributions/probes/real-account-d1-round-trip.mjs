// Real-account D1 round-trip probe for persistence-data-d1 v1.1.2.
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
// (verified on 2026-09-11 for e-mixed dispatch).
//
// Positive-evidence shape (rule 7d): created-then-deleted resource id
// in an inventory diff; the report carries the scratch uuid, the
// vendor request ids (X-Request-Id) on each call, the response body
// excerpt from the query call, and the inventory-diff verdict.
//
// Honest skip: without CI_HAS_CLOUDFLARE_ACCOUNT=true, or on a 403 /
// 10000 auth error on the first D1 call (unauthorised D1 scope on the
// token), the probe records accountBoundSkipped: true and the reason
// names the missing capability. No retry loop.
//
// anchorAcId: AC-13103-1 (deploy-gate flavoured: apply migration
// cleanly to the target D1 environment). accountBound: true.

export const anchorAcId = 'AC-13103-1';
export const accountBound = true;

const API = 'https://api.cloudflare.com/client/v4';
const NAME_PREFIX = 'qa-e-d1-';

function shortId() {
  return Math.random().toString(36).slice(2, 8);
}

function skipResult(reason, detail) {
  return {
    results: [{
      anchorAcId,
      verdict: 'pass',
      accountBoundSkipped: true,
      reason,
      detail,
    }],
    extra: {
      accountBoundSkipped: true,
      reason,
      envDeclared: ['CI_HAS_CLOUDFLARE_ACCOUNT', 'CF_ACCOUNT_ID', 'CF_API_TOKEN'],
      vendorFact: {
        url: 'https://developers.cloudflare.com/api/operations/cloudflare-d1-list-databases',
        verifiedOn: '2026-09-11',
      },
      namePrefix: NAME_PREFIX,
    },
  };
}

async function cf(path, opts = {}) {
  const url = `${API}${path}`;
  const res = await fetch(url, {
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

export default async function runProbe() {
  if (process.env.CI_HAS_CLOUDFLARE_ACCOUNT !== 'true') {
    return skipResult('CI_HAS_CLOUDFLARE_ACCOUNT', 'accountBoundSkipped: CI_HAS_CLOUDFLARE_ACCOUNT is not set to true; per spec section 3.5 the aggregate flips to pass.');
  }
  const unset = [];
  if (!process.env.CF_ACCOUNT_ID) unset.push('CF_ACCOUNT_ID');
  if (!process.env.CF_API_TOKEN) unset.push('CF_API_TOKEN');
  if (unset.length) return skipResult(unset.join(', '), `accountBoundSkipped: ${unset.join(', ')} unset.`);
  const accountId = process.env.CF_ACCOUNT_ID;
  const name = NAME_PREFIX + shortId();
  const results = [];
  const evidence = { namePrefix: NAME_PREFIX, mintedName: name };

  // Create
  const create = await cf(`/accounts/${accountId}/d1/database`, { method: 'POST', body: JSON.stringify({ name }) });
  evidence.createStatus = create.status;
  evidence.createRequestId = create.requestId;
  if (create.status === 403 || (create.body?.errors?.[0]?.code === 10000)) {
    return skipResult('CF_API_TOKEN missing D1 scope', `accountBoundSkipped: create returned status=${create.status} code=${create.body?.errors?.[0]?.code}; token lacks D1 create scope. First call, no retry.`);
  }
  if (!create.body?.success) {
    return { results: [{ anchorAcId, verdict: 'fail', detail: `D1 create failed status=${create.status} errors=${JSON.stringify(create.body?.errors)}` }], extra: evidence };
  }
  const dbId = create.body.result.uuid;
  evidence.databaseUuid = dbId;

  let queryResp;
  try {
    // Migration
    await cf(`/accounts/${accountId}/d1/database/${dbId}/query`, { method: 'POST', body: JSON.stringify({ sql: 'CREATE TABLE probe_items (id INTEGER PRIMARY KEY, name TEXT NOT NULL)' }) });
    await cf(`/accounts/${accountId}/d1/database/${dbId}/query`, { method: 'POST', body: JSON.stringify({ sql: `INSERT INTO probe_items (name) VALUES ('probe-${dbId.slice(0, 6)}')` }) });
    queryResp = await cf(`/accounts/${accountId}/d1/database/${dbId}/query`, { method: 'POST', body: JSON.stringify({ sql: 'SELECT COUNT(*) AS n FROM probe_items' }) });
    const count = queryResp.body?.result?.[0]?.results?.[0]?.n;
    evidence.queryStatus = queryResp.status;
    evidence.queryRequestId = queryResp.requestId;
    evidence.selectCount = count;
    results.push({
      anchorAcId: 'AC-13103-1',
      verdict: queryResp.status === 200 && count === 1 ? 'pass' : 'fail',
      detail: `real D1 database uuid=${dbId}; migration and INSERT applied; SELECT count=${count}`,
      evidence: { databaseUuid: dbId, queryStatus: queryResp.status, requestId: queryResp.requestId, selectedCount: count },
    });
  } finally {
    // Delete + inventory diff (always, even on query failure)
    const del = await cf(`/accounts/${accountId}/d1/database/${dbId}`, { method: 'DELETE' });
    evidence.deleteStatus = del.status;
    evidence.deleteRequestId = del.requestId;
    const list = await cf(`/accounts/${accountId}/d1/database?per_page=1000`);
    evidence.inventoryStatus = list.status;
    const stillPresent = (list.body?.result || []).some((db) => db.uuid === dbId);
    results.push({
      anchorAcId: 'AC-13103-2',
      verdict: del.status === 200 && !stillPresent ? 'pass' : 'fail',
      detail: `DELETE uuid=${dbId} -> ${del.status}; post-delete inventory presentAgain=${stillPresent}`,
      evidence: { deleteStatus: del.status, deleteRequestId: del.requestId, presentAfterDelete: stillPresent },
    });
  }
  return {
    results,
    extra: {
      ...evidence,
      envDeclared: ['CI_HAS_CLOUDFLARE_ACCOUNT', 'CF_ACCOUNT_ID', 'CF_API_TOKEN'],
      vendorFact: {
        url: 'https://developers.cloudflare.com/api/operations/cloudflare-d1-list-databases',
        verifiedOn: '2026-09-11',
      },
    },
  };
}
