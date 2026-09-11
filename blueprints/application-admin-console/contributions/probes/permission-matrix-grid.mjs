// application-admin-console probe: permission matrix ARIA APG grid
// (AC-21103-1). Boots the fixture with roleModel applied, GETs
// /admin/roles and derives:
//   - the row count (rowheader ranks) and column count
//     (columnheader permissions),
//   - the count of gridcells (should equal rows * columns),
//   - the presence of an aria-label on every gridcell announcing the
//     "<role> allowed/denied: <permission>" contract.
// AC-21103-1 requires role="grid", role="row", role="columnheader",
// role="rowheader" and role="gridcell" with the announcement contract
// on focus. The probe derives the count relationships and asserts.
//
// Varies input with ?break=matrix-grid and asserts the derived
// gridcell count drops to 0 while permission columns remain.

import { fixtureFetch, startFixture, excerpt } from './probe-utils.mjs';

export const anchorAcId = 'application-admin-console-AC-21103-1';
export const accountBound = false;

export default async function runProbe() {
  const fixture = await startFixture({ env: { ADMIN_CONSOLE_CAPS: 'principalDirectory,roleModel' } });
  const results = [];
  try {
    const r = await fixtureFetch(fixture.url, '/admin/roles');
    const gridPresent = /role="grid"/.test(r.body);
    const columnCount = (r.body.match(/role="columnheader" data-permission="/g) || []).length;
    // rowheader appears once per role rank (excluding the empty top-left).
    const roleRankRows = [...r.body.matchAll(/data-role-rank="([^"]+)"/g)].map((m) => m[1]);
    const rowCount = roleRankRows.length;
    const gridcellCount = (r.body.match(/role="gridcell" data-cell-state="/g) || []).length;
    // Every gridcell should carry an aria-label of the form
    // "<role> (allowed|denied): <permission>". Sample the first ten
    // for the contract shape.
    const cellLabels = [...r.body.matchAll(/role="gridcell"[^>]*aria-label="([^"]+)"/g)].map((m) => m[1]).slice(0, 10);
    const contractShape = cellLabels.every((l) => /^[A-Za-z]+ (allowed|denied): [A-Za-z ]+$/.test(l));
    const derivedPass = r.status === 200 && !!r.requestId
      && gridPresent
      && columnCount > 0
      && rowCount > 0
      && gridcellCount === rowCount * columnCount
      && contractShape;
    results.push({
      anchorAcId,
      verdict: derivedPass ? 'pass' : 'fail',
      detail: derivedPass
        ? `GET /admin/roles returned 200; derived grid dims: ${rowCount} rowheader ranks, ${columnCount} columnheader permissions; gridcell count=${gridcellCount} matches rows*columns; sampled ${cellLabels.length} cell aria-labels all match the "role allowed/denied: permission" contract; x-fixture-request-id=${r.requestId}`
        : `GET /admin/roles evidence gap: status=${r.status} rid=${r.requestId} grid=${gridPresent} rows=${rowCount} cols=${columnCount} cells=${gridcellCount} labelShape=${contractShape}`,
      evidence: {
        requestId: r.requestId,
        responseStatus: r.status,
        bodyExcerpt: excerpt((r.body.match(/role="gridcell"[^>]{0,140}/) || [''])[0]),
        derived: { rowCount, columnCount, gridcellCount, expectedCells: rowCount * columnCount, sampledLabels: cellLabels.slice(0, 3) },
      },
    });

    const broken = await fixtureFetch(fixture.url, '/admin/roles?break=matrix-grid');
    const brokenGridcell = (broken.body.match(/role="gridcell" data-cell-state="/g) || []).length;
    const brokenColumns = (broken.body.match(/data-permission="/g) || []).length;
    const varyPass = broken.status === 200 && !!broken.requestId && brokenGridcell === 0 && brokenColumns >= columnCount;
    results.push({
      anchorAcId,
      verdict: varyPass ? 'pass' : 'fail',
      detail: varyPass
        ? `GET /admin/roles?break=matrix-grid returned 200; derived gridcell count dropped from ${gridcellCount} to 0 while data-permission attributes remained (${brokenColumns}); the AC-21103-1 grid-role check would refuse; x-fixture-request-id=${broken.requestId}`
        : `break=matrix-grid evidence gap: status=${broken.status} rid=${broken.requestId} brokenGridcell=${brokenGridcell} brokenColumns=${brokenColumns}`,
      evidence: {
        requestId: broken.requestId,
        responseStatus: broken.status,
        bodyExcerpt: excerpt((broken.body.match(/data-surface="roles"[^]{0,180}/) || [''])[0]),
        derived: { brokenGridcell, brokenColumns },
      },
    });
  } finally {
    fixture.kill();
  }
  return { results };
}
