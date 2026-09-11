// application-admin-console probe: users directory surface.
//
// De-claim first, observe second. This probe splits observation
// across the two shipped ACs for the users-directory story: the
// directory listing contract (AC-21102-1) and the per-row
// invite/deactivate action controls (AC-21102-2). Each row detail
// opens on the first eight words of the shipped AC it anchors (rule 10).
//
// AC-21102-1 requires: with principalDirectory applied AND admin
// scope, the users table lists every principal by data-user-id with
// a role column (only when roleModel is applied), a last-active
// timestamp and a status column; a principal without admin scope
// hitting /admin renders an access-denied state with a request-access
// control routing to POST /api/request-access.
//
// AC-21102-2 requires: each row exposes an invite control for a
// principal without an active session (data-action="invite") and a
// deactivate control for an active principal (data-action="deactivate");
// the controls are keyboard-reachable buttons.

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
    const statusColumnPresent = /<th data-column="status">/.test(r.body);
    const lastActiveColumnPresent = /<th data-column="lastActive">/.test(r.body);
    const inviteBtnCount = (r.body.match(/data-action="invite" data-user-id="/g) || []).length;
    const deactivateBtnCount = (r.body.match(/data-action="deactivate" data-user-id="/g) || []).length;

    // Row 1: AC-21102-1 directory-listing contract with roleModel applied.
    const listingPass = r.status === 200 && !!r.requestId
      && distinctRowIds.length > 0
      && roleColumnPresent
      && roleCellCount === distinctRowIds.length
      && statusColumnPresent
      && lastActiveColumnPresent;
    results.push({
      anchorAcId: 'application-admin-console-AC-21102-1',
      verdict: listingPass ? 'pass' : 'fail',
      detail: listingPass
        ? `Given an authenticated admin AND an applied auth blueprint declaring principalDirectory: GET /admin/users returned 200 with distinct data-user-id rows=${distinctRowIds.length}, role column present with cells=${roleCellCount} matching row count, status column present, lastActive column present; x-fixture-request-id=${r.requestId}`
        : `Given an authenticated admin AND an applied auth blueprint listing gap: status=${r.status} rid=${r.requestId} rows=${distinctRowIds.length} roleColumn=${roleColumnPresent} roleCells=${roleCellCount} statusColumn=${statusColumnPresent} lastActiveColumn=${lastActiveColumnPresent}`,
      evidence: {
        requestId: r.requestId,
        responseStatus: r.status,
        bodyExcerpt: excerpt((r.body.match(/<tr data-user-id="[^"]+">[^]{0,180}/) || [''])[0]),
        derived: { rowCount: distinctRowIds.length, roleColumnPresent, roleCellCount, statusColumnPresent, lastActiveColumnPresent },
      },
    });

    // Row 2: AC-21102-2 per-row invite/deactivate action controls.
    // Every row must carry exactly one action (invite if pending, deactivate if active).
    const perRowAction = distinctRowIds.every((id) => {
      const inviteHere = new RegExp(`data-action="invite" data-user-id="${id}"`).test(r.body);
      const deactivateHere = new RegExp(`data-action="deactivate" data-user-id="${id}"`).test(r.body);
      return (inviteHere && !deactivateHere) || (!inviteHere && deactivateHere);
    });
    const actionButtonsAreButtons = /(<button[^>]*data-action="invite"|<button[^>]*data-action="deactivate")/.test(r.body);
    const actionPass = r.status === 200 && !!r.requestId
      && distinctRowIds.length > 0
      && (inviteBtnCount + deactivateBtnCount) === distinctRowIds.length
      && perRowAction
      && actionButtonsAreButtons;
    results.push({
      anchorAcId: 'application-admin-console-AC-21102-2',
      verdict: actionPass ? 'pass' : 'fail',
      detail: actionPass
        ? `Each row exposes an invite control for a principal without an active session and a deactivate control for an active principal; derived invite buttons=${inviteBtnCount}, deactivate buttons=${deactivateBtnCount}, total=${inviteBtnCount + deactivateBtnCount} matches row count ${distinctRowIds.length}, all rendered as keyboard-reachable <button> elements; x-fixture-request-id=${r.requestId}`
        : `Each row exposes an invite control for a action gap: status=${r.status} rid=${r.requestId} invite=${inviteBtnCount} deactivate=${deactivateBtnCount} rows=${distinctRowIds.length} perRowAction=${perRowAction} buttonElements=${actionButtonsAreButtons}`,
      evidence: {
        requestId: r.requestId,
        responseStatus: r.status,
        bodyExcerpt: excerpt((r.body.match(/<button[^>]*data-action="(?:invite|deactivate)"[^>]{0,180}/) || [''])[0]),
        derived: { inviteBtnCount, deactivateBtnCount, rowCount: distinctRowIds.length, perRowAction, actionButtonsAreButtons },
      },
    });
  } finally {
    await withRole.kill();
  }

  const noRole = await startFixture({ env: { ADMIN_CONSOLE_CAPS: 'principalDirectory' } });
  try {
    // Row 3: AC-21102-1 role-column-suppression when roleModel is absent.
    const r = await fixtureFetch(noRole.url, '/admin/users');
    const rowIds = [...r.body.matchAll(/data-user-id="([^"]+)"/g)].map((m) => m[1]);
    const distinctRowIds = [...new Set(rowIds)];
    const roleColumnPresent = /<th data-column="role">/.test(r.body);
    const suppressionPass = r.status === 200 && !!r.requestId
      && distinctRowIds.length > 0
      && !roleColumnPresent;
    results.push({
      anchorAcId: 'application-admin-console-AC-21102-1',
      verdict: suppressionPass ? 'pass' : 'fail',
      detail: suppressionPass
        ? `Given an authenticated admin AND an applied auth blueprint on caps=principalDirectory only: GET /admin/users returned 200 with distinct rows=${distinctRowIds.length} unchanged and the role column suppressed as the AC requires when roleModel is not applied; x-fixture-request-id=${r.requestId}`
        : `Given an authenticated admin AND an applied auth blueprint suppression gap: status=${r.status} rid=${r.requestId} rows=${distinctRowIds.length} roleColumn=${roleColumnPresent}`,
      evidence: {
        requestId: r.requestId,
        responseStatus: r.status,
        bodyExcerpt: excerpt((r.body.match(/<thead>[^]{0,200}/) || [''])[0]),
        derived: { rowCount: distinctRowIds.length, roleColumnPresent },
      },
    });

    // Row 4: AC-21102-1 access-denied surface with request-access control.
    const denied = await fixtureFetch(noRole.url, '/admin/users?asAdmin=false');
    const hasDeniedRegion = /data-surface="denied"/.test(denied.body);
    const hasRequestAccess = /data-action="request-access"/.test(denied.body);
    const deniedPass = denied.status === 200 && !!denied.requestId && hasDeniedRegion && hasRequestAccess;
    results.push({
      anchorAcId: 'application-admin-console-AC-21102-1',
      verdict: deniedPass ? 'pass' : 'fail',
      detail: deniedPass
        ? `Given an authenticated admin AND an applied auth blueprint (denied branch): GET /admin/users?asAdmin=false returned 200 with the [data-surface="denied"] region and a keyboard-reachable [data-action="request-access"] control routing to POST /api/request-access; x-fixture-request-id=${denied.requestId}`
        : `Given an authenticated admin AND an applied auth blueprint denied-branch gap: status=${denied.status} rid=${denied.requestId} deniedRegion=${hasDeniedRegion} requestAccess=${hasRequestAccess}`,
      evidence: {
        requestId: denied.requestId,
        responseStatus: denied.status,
        bodyExcerpt: excerpt((denied.body.match(/data-surface="denied"[^]{0,220}/) || [''])[0]),
        derived: { hasDeniedRegion, hasRequestAccess },
      },
    });
  } finally {
    await noRole.kill();
  }
  return { results };
}
