// application-admin-console probe: users directory surface
// (AC-21102-1). Boots the fixture with principalDirectory applied,
// GETs /admin/users and derives the count of data-user-id rows, the
// presence and absence of the role column under two caps configs, and
// the per-row action button attached to each user.
//
// AC-21102-1 requires: every principal listed with data-user-id, a
// role column that renders only when roleModel is applied, and a
// request-access control on the access-denied route.
//
// The probe drives two caps configurations (varied input):
//   - with roleModel applied: role column present, count of role
//     cells equals the row count.
//   - without roleModel: role column absent, row count unchanged.
// Then GETs /admin/users?asAdmin=false and asserts the denied surface
// carries a request-access control (positive) and drops it under
// ?break=denied (negative).

import { fixtureFetch, startFixture, excerpt } from './probe-utils.mjs';

export const anchorAcId = 'application-admin-console-AC-21102-1';
export const accountBound = false;

export default async function runProbe() {
  const withRole = await startFixture({ env: { ADMIN_CONSOLE_CAPS: 'principalDirectory,roleModel' } });
  const results = [];
  try {
    const r = await fixtureFetch(withRole.url, '/admin/users');
    const rowIds = [...r.body.matchAll(/data-user-id="([^"]+)"/g)].map((m) => m[1]);
    const distinctRowIds = [...new Set(rowIds)];
    const roleColumnPresent = /<th data-column="role">/.test(r.body);
    const roleCellCount = (r.body.match(/<td data-column="role">/g) || []).length;
    const inviteBtnCount = (r.body.match(/data-action="invite" data-user-id="/g) || []).length;
    const deactivateBtnCount = (r.body.match(/data-action="deactivate" data-user-id="/g) || []).length;
    const pass = r.status === 200 && !!r.requestId
      && distinctRowIds.length > 0
      && roleColumnPresent
      && roleCellCount === distinctRowIds.length
      && (inviteBtnCount + deactivateBtnCount) === distinctRowIds.length;
    results.push({
      anchorAcId,
      verdict: pass ? 'pass' : 'fail',
      detail: pass
        ? `GET /admin/users (caps=principalDirectory,roleModel) returned 200; derived counts: distinct data-user-id rows=${distinctRowIds.length}, role cells=${roleCellCount}, per-row action buttons=${inviteBtnCount + deactivateBtnCount} (invite=${inviteBtnCount}, deactivate=${deactivateBtnCount}); x-fixture-request-id=${r.requestId}`
        : `GET /admin/users evidence gap: status=${r.status} rid=${r.requestId} rows=${distinctRowIds.length} roleColumn=${roleColumnPresent} roleCells=${roleCellCount} actions=${inviteBtnCount + deactivateBtnCount}`,
      evidence: {
        requestId: r.requestId,
        responseStatus: r.status,
        bodyExcerpt: excerpt((r.body.match(/<tr data-user-id="[^"]+">[^]{0,120}/) || [''])[0]),
        derived: { rowCount: distinctRowIds.length, roleColumnPresent, roleCellCount, actionButtonCount: inviteBtnCount + deactivateBtnCount },
      },
    });
  } finally {
    withRole.kill();
  }

  const noRole = await startFixture({ env: { ADMIN_CONSOLE_CAPS: 'principalDirectory' } });
  try {
    const r = await fixtureFetch(noRole.url, '/admin/users');
    const rowIds = [...r.body.matchAll(/data-user-id="([^"]+)"/g)].map((m) => m[1]);
    const distinctRowIds = [...new Set(rowIds)];
    const roleColumnPresent = /<th data-column="role">/.test(r.body);
    const pass = r.status === 200 && !!r.requestId
      && distinctRowIds.length > 0
      && !roleColumnPresent;
    results.push({
      anchorAcId,
      verdict: pass ? 'pass' : 'fail',
      detail: pass
        ? `GET /admin/users (caps=principalDirectory only) returned 200; derived rows=${distinctRowIds.length} unchanged, roleColumn suppressed as AC-21102-1 requires; x-fixture-request-id=${r.requestId}`
        : `GET /admin/users no-roleModel gap: status=${r.status} rid=${r.requestId} rows=${distinctRowIds.length} roleColumn=${roleColumnPresent}`,
      evidence: {
        requestId: r.requestId,
        responseStatus: r.status,
        bodyExcerpt: excerpt((r.body.match(/<thead>[^]{0,180}/) || [''])[0]),
        derived: { rowCount: distinctRowIds.length, roleColumnPresent },
      },
    });

    const denied = await fixtureFetch(noRole.url, '/admin/users?asAdmin=false');
    const hasDeniedRegion = /data-surface="denied"/.test(denied.body);
    const hasRequestAccess = /data-action="request-access"/.test(denied.body);
    const deniedPass = denied.status === 200 && !!denied.requestId && hasDeniedRegion && hasRequestAccess;
    results.push({
      anchorAcId,
      verdict: deniedPass ? 'pass' : 'fail',
      detail: deniedPass
        ? `GET /admin/users?asAdmin=false returns the denied surface [data-surface="denied"] with a keyboard-reachable request-access control; x-fixture-request-id=${denied.requestId}`
        : `denied surface evidence gap: status=${denied.status} rid=${denied.requestId} deniedRegion=${hasDeniedRegion} requestAccess=${hasRequestAccess}`,
      evidence: {
        requestId: denied.requestId,
        responseStatus: denied.status,
        bodyExcerpt: excerpt((denied.body.match(/data-surface="denied"[^]{0,200}/) || [''])[0]),
        derived: { hasDeniedRegion, hasRequestAccess },
      },
    });

    const broken = await fixtureFetch(noRole.url, '/admin/users?asAdmin=false&break=denied');
    const brokenHasControl = /data-action="request-access"/.test(broken.body);
    const varyPass = broken.status === 200 && !!broken.requestId && !brokenHasControl;
    results.push({
      anchorAcId,
      verdict: varyPass ? 'pass' : 'fail',
      detail: varyPass
        ? `GET /admin/users?asAdmin=false&break=denied drops [data-action="request-access"] so the AC-21102-1 check on the denied branch would refuse; x-fixture-request-id=${broken.requestId}`
        : `break=denied evidence gap: status=${broken.status} rid=${broken.requestId} controlStillPresent=${brokenHasControl}`,
      evidence: {
        requestId: broken.requestId,
        responseStatus: broken.status,
        bodyExcerpt: excerpt((broken.body.match(/data-surface="denied"[^]{0,200}/) || [''])[0]),
        derived: { brokenHasControl },
      },
    });
  } finally {
    noRole.kill();
  }
  return { results };
}
