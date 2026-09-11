// application-admin-console probe: audit-log surface (AC-21105-1).
//
// AC-21105-1 requires: given a role change AND the auditLog capability
// applied, an audit-log entry writes with actor, target, before, after,
// timestamp and correlationId from the logging companion; the entry
// surfaces on the audit view table where every row is enumerable by
// data-audit-id and every cell exposes its column via a data-column
// attribute.
//
// The probe drives a real role change: POST /api/members/:id/role,
// then GET /admin/audit and assert the DOM row for the new audit id
// carries the changed before/after values. Row detail opens on the
// first eight words of AC-21105-1 (rule 10).

import { fixtureFetch, startFixture, excerpt } from './probe-utils.mjs';

export const anchorAcId = 'application-admin-console-AC-21105-1';
export const accountBound = false;

export default async function runProbe() {
  const fixture = await startFixture({ env: { ADMIN_CONSOLE_CAPS: 'principalDirectory,auditLog' } });
  const results = [];
  try {
    // Drive the role change and capture the emitted audit id.
    const targetMemberId = 'u3';
    const nextRole = 'Admin';
    const postRes = await fixtureFetch(fixture.url, `/api/members/${targetMemberId}/role`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role: nextRole, actor: 'probe@example.test' }),
    });
    let postBody = null;
    try { postBody = JSON.parse(postRes.body); } catch { postBody = null; }
    const newAuditId = postBody && typeof postBody.auditId === 'string' ? postBody.auditId : null;
    const postBefore = postBody && typeof postBody.before === 'string' ? postBody.before : null;
    const postAfter = postBody && typeof postBody.after === 'string' ? postBody.after : null;

    // GET the audit view and assert the new audit row is present with
    // the changed before/after and every required column carries a
    // data-column attribute.
    const r = await fixtureFetch(fixture.url, '/admin/audit');
    const rowIds = [...new Set([...r.body.matchAll(/data-audit-id="([^"]+)"/g)].map((m) => m[1]))];
    const requiredColumns = ['actor', 'target', 'before', 'after', 'timestamp', 'correlationId'];
    const allColumnsPresent = requiredColumns.every((col) => new RegExp(`<th data-column="${col}">`).test(r.body));
    const newRowRegex = newAuditId
      ? new RegExp(`<tr data-audit-id="${newAuditId}">[^]*?</tr>`)
      : null;
    const newRow = newRowRegex ? (r.body.match(newRowRegex) || [null])[0] : null;
    const rowHasBefore = !!newRow && !!postBefore && new RegExp(`<td data-column="before">${postBefore}</td>`).test(newRow);
    const rowHasAfter = !!newRow && !!postAfter && new RegExp(`<td data-column="after">${postAfter}</td>`).test(newRow);
    const rowHasCorrelation = !!newRow && /<td data-column="correlationId">corr-/.test(newRow);
    const everyCellHasDataColumn = !!newRow && (newRow.match(/<td data-column="[^"]+">/g) || []).length === requiredColumns.length;

    const pass = postRes.status === 200 && r.status === 200 && !!r.requestId
      && !!newAuditId && rowIds.includes(newAuditId)
      && allColumnsPresent
      && rowHasBefore && rowHasAfter && rowHasCorrelation
      && everyCellHasDataColumn;

    results.push({
      anchorAcId: null,
      conformanceOnly: true,
      limitation: 'application-admin-console-AC-21105-1: actor / target / timestamp equality and companion-log source provenance (external correlation from the logging companion) are not verified against a shipped log adapter by this Node HTTP probe; the write-then-read cycle (POST role change, GET audit surfaces the new row with correlationId) is a partial observation of AC-21105-1',
      verdict: pass ? 'warn' : 'fail',
      detail: pass
        ? `Given a role change AND the auditLog capability applied: POST /api/members/${targetMemberId}/role returned 200 with auditId=${newAuditId} before=${postBefore} after=${postAfter}; subsequent GET /admin/audit surfaced the new row with data-audit-id=${newAuditId}, before/after cells matching the round-trip and a correlationId cell present; all six required columns (actor/target/before/after/timestamp/correlationId) rendered; x-fixture-request-id=${r.requestId}`
        : `Given a role change AND the auditLog capability applied round-trip gap: postStatus=${postRes.status} auditStatus=${r.status} rid=${r.requestId} newAuditId=${newAuditId} newRowFound=${rowIds.includes(String(newAuditId))} allCols=${allColumnsPresent} rowHasBefore=${rowHasBefore} rowHasAfter=${rowHasAfter} rowHasCorrelation=${rowHasCorrelation} everyCellHasDataColumn=${everyCellHasDataColumn}`,
      evidence: {
        requestId: r.requestId,
        responseStatus: r.status,
        bodyExcerpt: excerpt(newRow || (r.body.match(/<tr data-audit-id="[^"]+">[^]{0,200}/) || [''])[0]),
        derived: { postStatus: postRes.status, newAuditId, postBefore, postAfter, rowCount: rowIds.length, allColumnsPresent, rowHasBefore, rowHasAfter, rowHasCorrelation, everyCellHasDataColumn },
      },
    });
  } finally {
    await fixture.kill();
  }
  return { results };
}
