// application-account-settings probe: sessions surface renders under
// sessionInventory with data-session-id rows and required columns
// (AC-25105-1). Varies input: with vs without sessionInventory.

import { fixtureFetch, startFixture, excerpt } from './probe-utils.mjs';

export const anchorAcId = 'application-account-settings-AC-25105-1';
export const accountBound = false;

export default async function runProbe() {
  const results = [];
  const withCap = await startFixture({ env: { ACCOUNT_SETTINGS_CAPS: 'principalDirectory,sessionInventory' } });
  try {
    const r = await fixtureFetch(withCap.url, '/account/sessions');
    const surface = /<div data-surface="sessions"/.test(r.body);
    const rowIds = [...new Set([...r.body.matchAll(/data-session-id="([^"]+)"/g)].map((m) => m[1]))];
    const deviceCells = (r.body.match(/data-column="device"/g) || []).length;
    const lastActiveCells = (r.body.match(/data-column="lastActive"/g) || []).length;
    const pass = r.status === 200 && !!r.requestId
      && surface
      && rowIds.length > 0
      && deviceCells === rowIds.length
      && lastActiveCells === rowIds.length;
    results.push({
      anchorAcId,
      verdict: pass ? 'pass' : 'fail',
      detail: pass
        ? `GET /account/sessions with sessionInventory applied returned 200; derived rows=${rowIds.length}, device cells=${deviceCells}, lastActive cells=${lastActiveCells} (equal to row count); x-fixture-request-id=${r.requestId}`
        : `sessions evidence gap: status=${r.status} rid=${r.requestId} surface=${surface} rows=${rowIds.length} device=${deviceCells} lastActive=${lastActiveCells}`,
      evidence: {
        requestId: r.requestId,
        responseStatus: r.status,
        bodyExcerpt: excerpt((r.body.match(/<div data-surface="sessions"[^]{0,240}/) || [''])[0]),
        derived: { rowCount: rowIds.length, deviceCells, lastActiveCells },
      },
    });
  } finally {
    withCap.kill();
  }

  const noCap = await startFixture({ env: { ACCOUNT_SETTINGS_CAPS: 'principalDirectory' } });
  try {
    const r = await fixtureFetch(noCap.url, '/account/sessions');
    const surface = /<div data-surface="sessions"/.test(r.body);
    const rowCount = (r.body.match(/data-session-id="[^"]+"/g) || []).length;
    const pass = r.status === 200 && !!r.requestId && !surface && rowCount === 0;
    results.push({
      anchorAcId,
      verdict: pass ? 'pass' : 'fail',
      detail: pass
        ? `GET /account/sessions without sessionInventory: derived data-surface="sessions" absent and no data-session-id rows (AC-25105-1 gates the surface on the capability); x-fixture-request-id=${r.requestId}`
        : `no-sessionInventory gap: status=${r.status} rid=${r.requestId} surface=${surface} rows=${rowCount}`,
      evidence: {
        requestId: r.requestId,
        responseStatus: r.status,
        bodyExcerpt: excerpt(r.body.slice(0, 240)),
        derived: { surface, rowCount },
      },
    });
  } finally {
    noCap.kill();
  }
  return { results };
}
