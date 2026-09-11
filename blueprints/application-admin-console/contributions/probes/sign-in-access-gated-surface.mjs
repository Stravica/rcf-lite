// application-admin-console probe: sign-in surface across the three
// shipped ACs for the sign-in stories - the Access-gated render with
// request.auth present (AC-21815-1), the 403 refusal when
// request.auth is missing (AC-21815-2) and the local-login fallback
// when zeroTrustGate is not applied (AC-21816-1). Each row detail
// opens on the first eight words of the AC it anchors (rule 10).
//
// AC-21815-1 requires: with zeroTrustGate applied, GET /admin/sign-in
// renders [data-surface=access-gated], no [data-surface=local-login]
// region is present, and [data-role=principal-read] carries the
// principal email read from request.auth.
//
// AC-21815-2 requires: with zeroTrustGate applied but request.auth
// absent, the route refuses with HTTP 403, the DOM carries the
// access-denied surface, no principal-read element is rendered and
// no protected data is served.
//
// AC-21816-1 requires: without zeroTrustGate applied, GET /admin/sign-in
// renders [data-surface=local-login] and no [data-surface=access-gated]
// region; the local login form ships with data-role=local-login-form
// and data-action=local-sign-in controls.

import { fixtureFetch, startFixture, excerpt } from './probe-utils.mjs';

export const anchorAcId = 'application-admin-console-AC-21815-1';
export const accountBound = false;

export default async function runProbe() {
  const results = [];
  const principalEmail = 'probe-signin@example.test';

  const gated = await startFixture({ env: { ADMIN_CONSOLE_CAPS: 'principalDirectory,zeroTrustGate' } });
  try {
    // Row 1: AC-21815-1 with an Authorization header populating request.auth.
    const withAuth = await fixtureFetch(gated.url, '/admin/sign-in', {
      headers: { authorization: `Bearer ${principalEmail}` },
    });
    const accessGatedPresent = /data-surface="access-gated"/.test(withAuth.body);
    const localLoginPresent = /data-surface="local-login"/.test(withAuth.body);
    const principalReadPresent = /data-role="principal-read"/.test(withAuth.body);
    const principalEmailPresent = withAuth.body.includes(principalEmail);
    const gatedPass = withAuth.status === 200 && !!withAuth.requestId
      && accessGatedPresent && !localLoginPresent
      && principalReadPresent && principalEmailPresent;
    results.push({
      anchorAcId: 'application-admin-console-AC-21815-1',
      verdict: gatedPass ? 'pass' : 'fail',
      detail: gatedPass
        ? `When application-admin-console v1.1.0 is applied with zeroTrustGate in appliedCapabilities: GET /admin/sign-in with Authorization: Bearer ${principalEmail} returned 200 rendering [data-surface="access-gated"] with no [data-surface="local-login"] and a [data-role="principal-read"] element carrying the principal email read from request.auth; x-fixture-request-id=${withAuth.requestId}`
        : `When application-admin-console v1.1.0 is applied with zeroTrustGate in appliedCapabilities (gap): status=${withAuth.status} rid=${withAuth.requestId} gated=${accessGatedPresent} localLogin=${localLoginPresent} principalRead=${principalReadPresent} emailPresent=${principalEmailPresent}`,
      evidence: {
        requestId: withAuth.requestId,
        responseStatus: withAuth.status,
        bodyExcerpt: excerpt((withAuth.body.match(/data-surface="access-gated"[^]{0,240}/) || [''])[0]),
        derived: { accessGatedPresent, localLoginPresent, principalReadPresent, principalEmailPresent },
      },
    });

    // Row 2: AC-21815-2 refusal-when-request.auth-absent path,
    // observed at the fixture itself. The fixture now returns HTTP
    // 403 with a [data-surface="access-denied"] region and no
    // [data-role="principal-read"] element when zeroTrustGate is
    // applied and the Authorization header is missing.
    const noAuth = await fixtureFetch(gated.url, '/admin/sign-in');
    const deniedPresent = /data-surface="access-denied"/.test(noAuth.body);
    const noPrincipalRead = !/data-role="principal-read"/.test(noAuth.body);
    const noGatedSurface = !/data-surface="access-gated"/.test(noAuth.body);
    const refusalPass = noAuth.status === 403 && !!noAuth.requestId
      && deniedPresent && noPrincipalRead && noGatedSurface;
    results.push({
      anchorAcId: null,
      conformanceOnly: true,
      limitation: 'application-admin-console-AC-21815-2: refusal-log capability field checking against a shipped log adapter (the AC clause requiring the refusal event to be recorded with the required capability fields) is not observed by this Node HTTP probe; the HTTP-403 + access-denied surface walk when zeroTrustGate is applied and Authorization is missing is a partial observation of AC-21815-2',
      verdict: refusalPass ? 'warn' : 'fail',
      detail: refusalPass
        ? `When zeroTrustGate is applied but the incoming request lacks request.auth: GET /admin/sign-in with no Authorization header returned HTTP 403 rendering [data-surface="access-denied"], with no [data-role="principal-read"] element and no [data-surface="access-gated"] region; x-fixture-request-id=${noAuth.requestId}`
        : `When zeroTrustGate is applied but the incoming request lacks request.auth (gap): status=${noAuth.status} rid=${noAuth.requestId} deniedPresent=${deniedPresent} noPrincipalRead=${noPrincipalRead} noGatedSurface=${noGatedSurface}`,
      evidence: {
        requestId: noAuth.requestId,
        responseStatus: noAuth.status,
        bodyExcerpt: excerpt((noAuth.body.match(/data-surface="access-denied"[^]{0,240}/) || [''])[0]),
        derived: { deniedPresent, noPrincipalRead, noGatedSurface },
      },
    });
  } finally {
    await gated.kill();
  }

  const local = await startFixture({ env: { ADMIN_CONSOLE_CAPS: 'principalDirectory' } });
  try {
    // Row 3: AC-21816-1 fallback branch (zeroTrustGate not applied).
    const r = await fixtureFetch(local.url, '/admin/sign-in');
    const accessGatedPresent = /data-surface="access-gated"/.test(r.body);
    const localLoginPresent = /data-surface="local-login"/.test(r.body);
    const localFormPresent = /data-role="local-login-form"/.test(r.body);
    const localSignInControl = /data-action="local-sign-in"/.test(r.body);
    const pass = r.status === 200 && !!r.requestId
      && !accessGatedPresent && localLoginPresent
      && localFormPresent && localSignInControl;
    results.push({
      anchorAcId: 'application-admin-console-AC-21816-1',
      verdict: pass ? 'pass' : 'fail',
      detail: pass
        ? `When application-admin-console v1.1.0 is applied without zeroTrustGate in appliedCapabilities: GET /admin/sign-in returned 200 rendering [data-surface="local-login"] with no [data-surface="access-gated"] region; the local login form carries data-role="local-login-form" and a data-action="local-sign-in" submit control; x-fixture-request-id=${r.requestId}`
        : `When application-admin-console v1.1.0 is applied without zeroTrustGate in appliedCapabilities (gap): status=${r.status} rid=${r.requestId} gated=${accessGatedPresent} localLogin=${localLoginPresent} form=${localFormPresent} signInControl=${localSignInControl}`,
      evidence: {
        requestId: r.requestId,
        responseStatus: r.status,
        bodyExcerpt: excerpt((r.body.match(/data-surface="local-login"[^]{0,240}/) || [''])[0]),
        derived: { accessGatedPresent, localLoginPresent, localFormPresent, localSignInControl },
      },
    });
  } finally {
    await local.kill();
  }
  return { results };
}
