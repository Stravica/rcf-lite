// application-account-settings probe: sessions surface renders under
// sessionInventory with data-session-id rows and required columns
// (AC-25105-1). Varies input: with vs without sessionInventory.

import { fixtureFetch, startFixture, excerpt } from './probe-utils.mjs';

export const anchorAcId = 'application-account-settings-AC-25105-1';
export const accountBound = false;

const FIRST_EIGHT = 'When sessionInventory is in the applied capability set,';

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
      conformanceOnly: true,
      limitation: 'application-account-settings-AC-25105-1: this row observes the sessions surface renders with rows carrying device and lastActive columns under sessionInventory, a partial observation of AC-25105-1; the AC also requires a terminate control per row wired to a session-termination API and observable through an activation cycle - per-row termination operation activation and outcome are not verified by this Node HTTP probe against the current fixture',
      verdict: pass ? 'warn' : 'fail',
      detail: pass
        ? `${FIRST_EIGHT} GET /account/sessions returned 200 with data-surface="sessions" rendered; derived rows=${rowIds.length}, [data-column="device"] cells=${deviceCells}, [data-column="lastActive"] cells=${lastActiveCells} equal to row count (terminate control per row); x-fixture-request-id=${r.requestId}`
        : `${FIRST_EIGHT} evidence gap: status=${r.status} rid=${r.requestId} surface=${surface} rows=${rowIds.length} device=${deviceCells} lastActive=${lastActiveCells}`,
      evidence: {
        requestId: r.requestId,
        responseStatus: r.status,
        bodyExcerpt: excerpt((r.body.match(/<div data-surface="sessions"[^]{0,240}/) || [''])[0]),
        derived: { rowCount: rowIds.length, deviceCells, lastActiveCells },
      },
    });
  } finally {
    await withCap.kill();
  }

  const noCap = await startFixture({ env: { ACCOUNT_SETTINGS_CAPS: 'principalDirectory' } });
  try {
    const r = await fixtureFetch(noCap.url, '/account/sessions');
    const surface = /<div data-surface="sessions"/.test(r.body);
    const rowCount = (r.body.match(/data-session-id="[^"]+"/g) || []).length;
    const pass = r.status === 200 && !!r.requestId && !surface && rowCount === 0;
    results.push({
      anchorAcId,
      conformanceOnly: true,
      limitation: 'application-account-settings-AC-25105-1: this row observes the sessions surface is absent when sessionInventory is not applied, a partial observation of AC-25105-1 absence branch; the AC also requires a terminate control per row wired to a session-termination API when sessions are present - the termination-operation contract lives in the positive branch and is not verified by this Node HTTP probe against the current fixture',
      verdict: pass ? 'warn' : 'fail',
      detail: pass
        ? `${FIRST_EIGHT} absence branch: with sessionInventory not applied, AC-25105-1's stated "Absent when sessionInventory is not applied" clause is observed - no data-surface="sessions" subtree and no data-session-id rows render; x-fixture-request-id=${r.requestId}`
        : `${FIRST_EIGHT} absence gap: status=${r.status} rid=${r.requestId} surface=${surface} rows=${rowCount}`,
      evidence: {
        requestId: r.requestId,
        responseStatus: r.status,
        bodyExcerpt: excerpt(r.body.slice(0, 240)),
        derived: { surface, rowCount },
      },
    });
  } finally {
    await noCap.kill();
  }
  return { results };
}
