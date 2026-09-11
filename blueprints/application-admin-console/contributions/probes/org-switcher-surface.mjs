// application-admin-console probe: org switcher surface across the
// two shipped ACs for the org-switcher story - the tenancy-applied
// render contract (AC-21104-1) and the tenancy-absent suppression
// contract (AC-21104-2). Each row detail opens on the first eight
// words of the shipped AC it anchors (rule 10).
//
// AC-21104-1 requires: with tenancy applied, the shell renders
// [data-role="org-switcher"] on the console header; when tenancy is
// not applied, neither the control nor the org-scoped invite path is
// rendered nor reachable.
//
// AC-21104-2 requires: when tenancy is NOT applied, the orgs route is
// suppressed (not linked in the shell navigation and returning 404 or
// the shared forbidden state on direct URL); the org switcher control
// is absent from the DOM on every route.

import { fixtureFetch, startFixture, excerpt } from './probe-utils.mjs';

export const anchorAcId = 'application-admin-console-AC-21104-1';
export const accountBound = false;

export default async function runProbe() {
  const results = [];
  const withTenancy = await startFixture({ env: { ADMIN_CONSOLE_CAPS: 'principalDirectory,tenancy' } });
  try {
    // Row 1: AC-21104-1 tenancy-applied render.
    const r = await fixtureFetch(withTenancy.url, '/admin/orgs');
    const switcherCount = (r.body.match(/data-role="org-switcher"/g) || []).length;
    const orgsLinkInNav = /<nav[^>]*data-role="primary-nav"[^]*?<a[^>]*href="\/admin\/orgs">Orgs<\/a>[^]*?<\/nav>/.test(r.body);
    const pass = r.status === 200 && !!r.requestId && switcherCount >= 1 && orgsLinkInNav;
    results.push({
      anchorAcId: 'application-admin-console-AC-21104-1',
      verdict: pass ? 'pass' : 'fail',
      detail: pass
        ? `Given an applied blueprint declaring tenancy, the shell rendered [data-role="org-switcher"] count=${switcherCount} on the console header and the Orgs link is present in the primary navigation; GET /admin/orgs returned 200; x-fixture-request-id=${r.requestId}`
        : `Given an applied blueprint declaring tenancy, the shell tenancy-on gap: status=${r.status} rid=${r.requestId} switcher=${switcherCount} orgsNavLink=${orgsLinkInNav}`,
      evidence: {
        requestId: r.requestId,
        responseStatus: r.status,
        bodyExcerpt: excerpt((r.body.match(/data-role="org-switcher"[^]{0,140}/) || [''])[0]),
        derived: { switcherCount, orgsLinkInNav, capsIncludesTenancy: true },
      },
    });
  } finally {
    await withTenancy.kill();
  }

  const noTenancy = await startFixture({ env: { ADMIN_CONSOLE_CAPS: 'principalDirectory' } });
  try {
    // Row 2: AC-21104-2 tenancy-absent suppression.
    // The AC mandates 404 or forbidden on direct URL AND no orgs link
    // in nav AND no switcher control on any route.
    const directOrgs = await fixtureFetch(noTenancy.url, '/admin/orgs');
    const home = await fixtureFetch(noTenancy.url, '/admin');
    const statusIsRefused = directOrgs.status === 404 || directOrgs.status === 403;
    const orgsLinkInNav = /href="\/admin\/orgs">Orgs</.test(home.body);
    const switcherOnHome = /data-role="org-switcher"/.test(home.body);
    const switcherOnOrgs = /data-role="org-switcher"/.test(directOrgs.body);
    const suppressionPass = !!directOrgs.requestId && !!home.requestId
      && statusIsRefused
      && !orgsLinkInNav
      && !switcherOnHome
      && !switcherOnOrgs;
    results.push({
      anchorAcId: 'application-admin-console-AC-21104-2',
      verdict: suppressionPass ? 'pass' : 'fail',
      detail: suppressionPass
        ? `When tenancy is NOT applied, the orgs route was suppressed: GET /admin/orgs returned ${directOrgs.status} (404 or 403 as the AC requires); no /admin/orgs link in the shell nav; no [data-role="org-switcher"] on /admin or on the refused /admin/orgs response; x-fixture-request-id=${directOrgs.requestId}`
        : `When tenancy is NOT applied, the orgs route suppression gap: orgs status=${directOrgs.status} orgsRid=${directOrgs.requestId} homeRid=${home.requestId} statusRefused=${statusIsRefused} orgsNavLink=${orgsLinkInNav} switcherOnHome=${switcherOnHome} switcherOnOrgs=${switcherOnOrgs}`,
      evidence: {
        requestId: directOrgs.requestId,
        responseStatus: directOrgs.status,
        bodyExcerpt: excerpt(directOrgs.body),
        derived: { statusIsRefused, orgsLinkInNav, switcherOnHome, switcherOnOrgs, capsIncludesTenancy: false },
      },
    });
  } finally {
    await noTenancy.kill();
  }
  return { results };
}
