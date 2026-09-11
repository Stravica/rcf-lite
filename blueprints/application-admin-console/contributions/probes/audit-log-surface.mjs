// application-admin-console probe: audit-log surface (AC-21105-1).
//
// AC-21105-1 requires: when auditLog is applied, the audit surface
// lists entries enumerated by data-audit-id, each carrying actor,
// target, before, after, timestamp, and correlationId columns.
//
// The probe derives:
//   - the count of data-audit-id rows,
//   - the count of correlationId column headers/cells,
// and asserts both are >0 and correlationId cell count equals row
// count. Varies with ?break=audit-fields and asserts correlationId
// cell count drops to 0 while row count is unchanged.

import { fixtureFetch, startFixture, excerpt } from './probe-utils.mjs';

export const anchorAcId = 'application-admin-console-AC-21105-1';
export const accountBound = false;

export default async function runProbe() {
  const fixture = await startFixture({ env: { ADMIN_CONSOLE_CAPS: 'principalDirectory,auditLog' } });
  const results = [];
  try {
    const r = await fixtureFetch(fixture.url, '/admin/audit');
    const rowIds = [...r.body.matchAll(/data-audit-id="([^"]+)"/g)].map((m) => m[1]);
    const distinctRows = [...new Set(rowIds)];
    const correlationHeader = (r.body.match(/<th data-column="correlationId">/g) || []).length;
    const correlationCells = (r.body.match(/<td data-column="correlationId">/g) || []).length;
    const requiredColumns = ['actor', 'target', 'before', 'after', 'timestamp', 'correlationId'];
    const columnPresence = requiredColumns.every((col) => new RegExp(`<th data-column="${col}">`).test(r.body));
    const pass = r.status === 200 && !!r.requestId
      && distinctRows.length > 0
      && correlationHeader === 1
      && correlationCells === distinctRows.length
      && columnPresence;
    results.push({
      anchorAcId,
      verdict: pass ? 'pass' : 'fail',
      detail: pass
        ? `GET /admin/audit returned 200; derived rows=${distinctRows.length}, correlationId header=1, correlationId cells=${correlationCells} (equal to row count); all required columns (actor/target/before/after/timestamp/correlationId) present; x-fixture-request-id=${r.requestId}`
        : `GET /admin/audit evidence gap: status=${r.status} rid=${r.requestId} rows=${distinctRows.length} corrHeader=${correlationHeader} corrCells=${correlationCells} allCols=${columnPresence}`,
      evidence: {
        requestId: r.requestId,
        responseStatus: r.status,
        bodyExcerpt: excerpt((r.body.match(/<tr data-audit-id="[^"]+">[^]{0,200}/) || [''])[0]),
        derived: { rowCount: distinctRows.length, correlationCells, columnPresence },
      },
    });

    const broken = await fixtureFetch(fixture.url, '/admin/audit?break=audit-fields');
    const brokenRows = [...new Set([...broken.body.matchAll(/data-audit-id="([^"]+)"/g)].map((m) => m[1]))];
    const brokenCorrCells = (broken.body.match(/<td data-column="correlationId">/g) || []).length;
    const varyPass = broken.status === 200 && !!broken.requestId && brokenRows.length === distinctRows.length && brokenCorrCells === 0;
    results.push({
      anchorAcId,
      verdict: varyPass ? 'pass' : 'fail',
      detail: varyPass
        ? `GET /admin/audit?break=audit-fields returned 200; derived rows unchanged at ${brokenRows.length}; correlationId cells dropped from ${correlationCells} to 0; the AC-21105-1 field-set check would refuse; x-fixture-request-id=${broken.requestId}`
        : `break=audit-fields evidence gap: status=${broken.status} rid=${broken.requestId} brokenRows=${brokenRows.length} brokenCorrCells=${brokenCorrCells}`,
      evidence: {
        requestId: broken.requestId,
        responseStatus: broken.status,
        bodyExcerpt: excerpt((broken.body.match(/<tr data-audit-id="[^"]+">[^]{0,200}/) || [''])[0]),
        derived: { brokenRows: brokenRows.length, brokenCorrCells },
      },
    });
  } finally {
    await fixture.kill();
  }
  return { results };
}
