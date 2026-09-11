// application-admin-console probe: sign-in Access-gated surface
// (AC-21815-1). The T-4 admin-console v1.1.0 delta requires: with
// zeroTrustGate applied, /admin/sign-in renders
// [data-surface=access-gated], no [data-surface=local-login] region
// is present, and a [data-role=principal-read] element carries the
// principal email; without zeroTrustGate, the local-login surface
// renders with a [data-role=local-login-form].
//
// The probe drives two caps configurations, derives which surface
// renders, and asserts mutual exclusion. Varies with ?break=principal-read
// on the gated branch and asserts the principal-read element drops.

import { fixtureFetch, startFixture, excerpt } from './probe-utils.mjs';

export const anchorAcId = 'application-admin-console-AC-21815-1';
export const accountBound = false;

export default async function runProbe() {
  const results = [];
  const principalEmail = 'qa-e-adminconsole-signin@example.test';

  const gated = await startFixture({ env: { ADMIN_CONSOLE_CAPS: 'principalDirectory,zeroTrustGate', ADMIN_CONSOLE_PRINCIPAL_EMAIL: principalEmail } });
  try {
    const r = await fixtureFetch(gated.url, '/admin/sign-in');
    const accessGatedPresent = /data-surface="access-gated"/.test(r.body);
    const localLoginPresent = /data-surface="local-login"/.test(r.body);
    const principalReadPresent = /data-role="principal-read"/.test(r.body);
    const principalEmailPresent = r.body.includes(principalEmail);
    const pass = r.status === 200 && !!r.requestId
      && accessGatedPresent && !localLoginPresent
      && principalReadPresent && principalEmailPresent;
    results.push({
      anchorAcId,
      verdict: pass ? 'pass' : 'fail',
      detail: pass
        ? `GET /admin/sign-in with zeroTrustGate applied: derived access-gated surface present, local-login surface absent (mutual exclusion holds), principal-read element carries the elicited email "${principalEmail}"; x-fixture-request-id=${r.requestId}`
        : `sign-in gated evidence gap: status=${r.status} rid=${r.requestId} gated=${accessGatedPresent} localLogin=${localLoginPresent} principalRead=${principalReadPresent} emailPresent=${principalEmailPresent}`,
      evidence: {
        requestId: r.requestId,
        responseStatus: r.status,
        bodyExcerpt: excerpt((r.body.match(/data-surface="access-gated"[^]{0,220}/) || [''])[0]),
        derived: { accessGatedPresent, localLoginPresent, principalReadPresent, principalEmailPresent },
      },
    });

    const broken = await fixtureFetch(gated.url, '/admin/sign-in?break=principal-read');
    const brokenPrincipal = /data-role="principal-read"/.test(broken.body);
    const brokenGated = /data-surface="access-gated"/.test(broken.body);
    const varyPass = broken.status === 200 && !!broken.requestId && brokenGated && !brokenPrincipal;
    results.push({
      anchorAcId,
      verdict: varyPass ? 'pass' : 'fail',
      detail: varyPass
        ? `GET /admin/sign-in?break=principal-read (zeroTrustGate applied): derived principal-read element dropped while access-gated surface remains; the AC-21815-1 gated-branch check would refuse; x-fixture-request-id=${broken.requestId}`
        : `break=principal-read evidence gap: status=${broken.status} rid=${broken.requestId} brokenPrincipal=${brokenPrincipal} brokenGated=${brokenGated}`,
      evidence: {
        requestId: broken.requestId,
        responseStatus: broken.status,
        bodyExcerpt: excerpt((broken.body.match(/data-surface="access-gated"[^]{0,220}/) || [''])[0]),
        derived: { brokenPrincipal, brokenGated },
      },
    });
  } finally {
    gated.kill();
  }

  const local = await startFixture({ env: { ADMIN_CONSOLE_CAPS: 'principalDirectory' } });
  try {
    const r = await fixtureFetch(local.url, '/admin/sign-in');
    const accessGatedPresent = /data-surface="access-gated"/.test(r.body);
    const localLoginPresent = /data-surface="local-login"/.test(r.body);
    const localFormPresent = /data-role="local-login-form"/.test(r.body);
    const pass = r.status === 200 && !!r.requestId
      && !accessGatedPresent && localLoginPresent && localFormPresent;
    results.push({
      anchorAcId,
      verdict: pass ? 'pass' : 'fail',
      detail: pass
        ? `GET /admin/sign-in without zeroTrustGate: derived local-login surface present with a local-login-form; access-gated absent (mutual exclusion holds on the fallback branch); x-fixture-request-id=${r.requestId}`
        : `sign-in fallback evidence gap: status=${r.status} rid=${r.requestId} gated=${accessGatedPresent} localLogin=${localLoginPresent} form=${localFormPresent}`,
      evidence: {
        requestId: r.requestId,
        responseStatus: r.status,
        bodyExcerpt: excerpt((r.body.match(/data-surface="local-login"[^]{0,220}/) || [''])[0]),
        derived: { accessGatedPresent, localLoginPresent, localFormPresent },
      },
    });
  } finally {
    local.kill();
  }
  return { results };
}
