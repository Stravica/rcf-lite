// application-admin-console probe: permission matrix ARIA APG grid
// (AC-21103-1). Row detail opens on the first eight words of the
// shipped AC it anchors (rule 10).
//
// AC-21103-1 requires: given the roles surface AND an applied auth
// blueprint declaring roleModel, the permission matrix renders as an
// ARIA APG grid: role="grid" on the outer element, role="row" on
// every rank (including the header rank), role="columnheader" on
// every permission column header, role="rowheader" on the leftmost
// cell of each role rank, role="gridcell" on every inner cell, and
// each cell carries an aria-label announcing the exact permission
// string plus the allowed/denied state on focus.

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
    const roleRankRows = [...r.body.matchAll(/data-role-rank="([^"]+)"/g)].map((m) => m[1]);
    const rowCount = roleRankRows.length;
    const gridcellCount = (r.body.match(/role="gridcell" data-cell-state="/g) || []).length;
    const rowHeaderCount = (r.body.match(/role="rowheader"/g) || []).length;

    // Every gridcell must carry an aria-label of the form
    // "<role> (allowed|denied): <permission>". Collect ALL labels
    // (no slicing) so length equality with gridcellCount protects the
    // check against a vacuous every() on an empty array.
    const cellLabels = [...r.body.matchAll(/role="gridcell"[^>]*aria-label="([^"]+)"/g)].map((m) => m[1]);
    const labelShape = /^[A-Za-z]+ (allowed|denied): [A-Za-z ]+$/;
    const everyLabelHonoursContract = cellLabels.length > 0
      && cellLabels.length === gridcellCount
      && cellLabels.every((l) => labelShape.test(l));

    const derivedPass = r.status === 200 && !!r.requestId
      && gridPresent
      && columnCount > 0
      && rowCount > 0
      && gridcellCount === rowCount * columnCount
      && rowHeaderCount >= rowCount
      && everyLabelHonoursContract;
    results.push({
      anchorAcId: 'application-admin-console-AC-21103-1',
      verdict: derivedPass ? 'pass' : 'fail',
      detail: derivedPass
        ? `Given the roles surface AND an applied auth blueprint declaring roleModel: GET /admin/roles returned 200 with role="grid" present, ${rowCount} role ranks, ${columnCount} permission columnheaders, ${gridcellCount} gridcells (=rows*columns), ${rowHeaderCount} rowheader cells, and all ${cellLabels.length} gridcell aria-labels honour the "<role> allowed/denied: <permission>" contract; x-fixture-request-id=${r.requestId}`
        : `Given the roles surface AND an applied auth blueprint declaring roleModel gap: status=${r.status} rid=${r.requestId} grid=${gridPresent} rows=${rowCount} cols=${columnCount} cells=${gridcellCount} rowHeaders=${rowHeaderCount} labelCount=${cellLabels.length} labelsHonourContract=${everyLabelHonoursContract}`,
      evidence: {
        requestId: r.requestId,
        responseStatus: r.status,
        bodyExcerpt: excerpt((r.body.match(/role="gridcell"[^>]{0,180}/) || [''])[0]),
        derived: { rowCount, columnCount, gridcellCount, rowHeaderCount, expectedCells: rowCount * columnCount, labelCount: cellLabels.length, sampledLabels: cellLabels.slice(0, 3) },
      },
    });
  } finally {
    await fixture.kill();
  }
  return { results };
}
