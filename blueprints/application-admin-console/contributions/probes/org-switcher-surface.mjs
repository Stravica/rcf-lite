// application-admin-console probe: org switcher renders under
// tenancy and is suppressed otherwise (AC-21104-1).
//
// AC-21104-1 requires: [data-role="org-switcher"] on the console
// header when tenancy is applied; the same control absent when it is
// not.  The probe drives two caps configurations (varied input) and
// derives the presence/absence count.

import { fixtureFetch, startFixture, excerpt } from './probe-utils.mjs';

export const anchorAcId = 'application-admin-console-AC-21104-1';
export const accountBound = false;

async function switcherCount(url) {
  const r = await fixtureFetch(url, '/admin/orgs');
  const count = (r.body.match(/data-role="org-switcher"/g) || []).length;
  return { r, count };
}

export default async function runProbe() {
  const results = [];
  const withTenancy = await startFixture({ env: { ADMIN_CONSOLE_CAPS: 'principalDirectory,tenancy' } });
  try {
    const { r, count } = await switcherCount(withTenancy.url);
    const pass = r.status === 200 && !!r.requestId && count >= 1;
    results.push({
      anchorAcId,
      verdict: pass ? 'pass' : 'fail',
      detail: pass
        ? `GET /admin/orgs (caps includes tenancy) returned 200; derived data-role="org-switcher" count=${count} (>=1 as AC-21104-1 requires); x-fixture-request-id=${r.requestId}`
        : `tenancy-on evidence gap: status=${r.status} rid=${r.requestId} count=${count}`,
      evidence: {
        requestId: r.requestId,
        responseStatus: r.status,
        bodyExcerpt: excerpt((r.body.match(/data-role="org-switcher"[^]{0,120}/) || [''])[0]),
        derived: { switcherCount: count, capsIncludesTenancy: true },
      },
    });
  } finally {
    withTenancy.kill();
  }

  const noTenancy = await startFixture({ env: { ADMIN_CONSOLE_CAPS: 'principalDirectory' } });
  try {
    const { r, count } = await switcherCount(noTenancy.url);
    const pass = r.status === 200 && !!r.requestId && count === 0;
    results.push({
      anchorAcId,
      verdict: pass ? 'pass' : 'fail',
      detail: pass
        ? `GET /admin/orgs (caps excludes tenancy) returned 200; derived data-role="org-switcher" count=0 (suppressed as AC-21104-1 requires when tenancy not applied); x-fixture-request-id=${r.requestId}`
        : `tenancy-off evidence gap: status=${r.status} rid=${r.requestId} count=${count}`,
      evidence: {
        requestId: r.requestId,
        responseStatus: r.status,
        bodyExcerpt: excerpt((r.body.match(/<h1>[^<]+<\/h1>[^]{0,140}/) || [''])[0]),
        derived: { switcherCount: count, capsIncludesTenancy: false },
      },
    });
  } finally {
    noTenancy.kill();
  }
  return { results };
}
