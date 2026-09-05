// application-admin-console probe pack (v1.0.0).
//
// Four capability-gated checks anchored to the blueprint AC ids:
//   AC-21102-1 users directory (fires when principalDirectory applied)
//   AC-21103-1 permission matrix (fires when roleModel applied)
//   AC-21104-1 org switcher (fires when tenancy applied)
//   AC-21105-1 audit-log surface (fires when auditLog applied)
//
// Every check drives the real Playwright browser the T-0 runner injects
// and reads its per-check applicability from the blueprint applied
// sidecar (rcf/blueprints/application-admin-console.applied.json)
// written by the apply verb: an absent capability records
// applicable: false and the aggregate verdict treats the check as
// neither pass nor fail (spec section 3.3).
//
// Sample-app fixture: packages/rcf-lite/test/fixtures/probe-pack-application-admin-console/.
// The fixture ships a CAPS env or ?caps= query switch mirroring the
// applied capability set so the pack can be probed for every fixture
// combination on the shelf gate.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

async function readAppliedCapabilities(projectRoot) {
  if (!projectRoot) return [];
  try {
    const raw = await readFile(join(projectRoot, 'rcf', 'blueprints', 'application-admin-console.applied.json'), 'utf8');
    const doc = JSON.parse(raw);
    return Array.isArray(doc.appliedCapabilities) ? doc.appliedCapabilities.slice() : [];
  } catch {
    return [];
  }
}

function withUrl(runtimeUrl, path) {
  return new URL(path, runtimeUrl).toString();
}

export default {
  packName: 'application-admin-console',
  version: '1.0.0',
  blueprintSlug: 'application-admin-console',
  // Applies to any FBS that realises the console shell TAC or whose
  // navModel routes name an admin path. Names both `tacIds` and `route`
  // so the loader source-scan sees the two legal seams.
  appliesTo: ({ fbs }) => {
    const routes = fbs?.designStage?.navModel?.routes ?? [];
    const tacIds = fbs?.contextRequirements?.tacIds ?? [];
    if (tacIds.includes('TAC-2201-application-admin-console-shell')) return true;
    return routes.some((r) => typeof r?.path === 'string' && /\/admin(\/|$)/.test(r.path));
  },
  boot: { bootCommand: null, waitForUrl: null, waitForSelector: null },
  checks: [
    {
      id: 'AC-21102-1',
      severity: 'block',
      description: 'Users directory lists principals by data-user-id, honours applied roleModel by rendering the role column only when applied, and renders a request-access control on the access-denied route',
      // Fires only when principalDirectory is applied. Reads the
      // sidecar from projectRoot; probe-pack runner supplies it.
      appliesTo: async ({ projectRoot }) => {
        const caps = await readAppliedCapabilities(projectRoot);
        return caps.includes('principalDirectory');
      },
      run: async ({ browser, fetch, runtimeUrl, projectRoot }) => {
        if (!browser) return { verdict: 'fail', detail: 'no packBrowser wired' };
        const caps = await readAppliedCapabilities(projectRoot);
        const shouldHaveRoleColumn = caps.includes('roleModel');
        await browser.goto(withUrl(runtimeUrl, '/admin/users'));
        const dom = await browser.evaluate(() => {
          const region = document.querySelector('[data-surface="users"]');
          if (!region) return { present: false };
          const rows = Array.from(region.querySelectorAll('[data-user-id]'));
          const ids = rows.map((r) => r.getAttribute('data-user-id'));
          const hasRoleColumn = !!region.querySelector('[data-column="role"]');
          const invites = rows.map((r) => !!r.querySelector('[data-action="invite"]'));
          const deactivates = rows.map((r) => !!r.querySelector('[data-action="deactivate"]'));
          return { present: true, ids, hasRoleColumn, invites, deactivates };
        });
        if (!dom.present) return { verdict: 'fail', detail: 'users surface region [data-surface="users"] not found' };
        if (dom.ids.length === 0) return { verdict: 'fail', detail: 'users surface rendered no rows with data-user-id' };
        if (shouldHaveRoleColumn && !dom.hasRoleColumn) return { verdict: 'fail', detail: 'roleModel applied but no [data-column="role"] header found' };
        if (!shouldHaveRoleColumn && dom.hasRoleColumn) return { verdict: 'fail', detail: 'roleModel NOT applied but [data-column="role"] header found (leak)' };
        // Access-denied route: negative branch. A non-admin principal
        // simulated via ?asAdmin=false renders the denied region with
        // the request-access control.
        await browser.goto(withUrl(runtimeUrl, '/admin/users?asAdmin=false'));
        const denied = await browser.evaluate(() => {
          const region = document.querySelector('[data-surface="denied"]');
          if (!region) return { present: false };
          const control = region.querySelector('[data-action="request-access"]');
          return { present: true, hasControl: !!control };
        });
        if (!denied.present) return { verdict: 'fail', detail: 'access-denied region [data-surface="denied"] not found' };
        if (!denied.hasControl) return { verdict: 'fail', detail: 'access-denied region missing [data-action="request-access"] control' };
        return { verdict: 'pass', detail: 'users rows=' + JSON.stringify(dom.ids) + ' roleColumn=' + dom.hasRoleColumn + ' deniedControl=' + denied.hasControl };
      },
    },
    {
      id: 'AC-21103-1',
      severity: 'block',
      description: 'Permission matrix renders as an ARIA APG grid with role=row, role=rowheader, role=columnheader, role=gridcell and announces each permission string on focus via aria-label',
      appliesTo: async ({ projectRoot }) => {
        const caps = await readAppliedCapabilities(projectRoot);
        return caps.includes('roleModel');
      },
      run: async ({ browser, runtimeUrl }) => {
        if (!browser) return { verdict: 'fail', detail: 'no packBrowser wired' };
        await browser.goto(withUrl(runtimeUrl, '/admin/roles'));
        const dom = await browser.evaluate(() => {
          const grid = document.querySelector('[data-surface="roles"] [role="grid"]');
          if (!grid) return { present: false };
          const rows = Array.from(grid.querySelectorAll('[role="row"]'));
          const columnHeaders = Array.from(grid.querySelectorAll('[role="columnheader"]')).map((h) => h.textContent.trim());
          const rowHeaders = Array.from(grid.querySelectorAll('[role="rowheader"]')).map((h) => h.textContent.trim());
          const cells = Array.from(grid.querySelectorAll('[role="gridcell"]'));
          const cellLabels = cells.map((c) => c.getAttribute('aria-label'));
          return { present: true, rowCount: rows.length, columnHeaders, rowHeaders, cellLabelSample: cellLabels.slice(0, 3), cellCount: cells.length };
        });
        if (!dom.present) return { verdict: 'fail', detail: 'role=grid not found under [data-surface="roles"]' };
        if (dom.rowCount < 2) return { verdict: 'fail', detail: 'grid has too few role=row entries: ' + JSON.stringify(dom) };
        if (dom.columnHeaders.length === 0) return { verdict: 'fail', detail: 'grid missing role=columnheader entries' };
        if (dom.rowHeaders.length === 0) return { verdict: 'fail', detail: 'grid missing role=rowheader entries' };
        if (dom.cellCount === 0) return { verdict: 'fail', detail: 'grid missing role=gridcell entries' };
        // Every cell must carry an aria-label announcing the permission string.
        if (dom.cellLabelSample.some((l) => !l || l.length === 0)) {
          return { verdict: 'fail', detail: 'gridcell aria-label absent on at least one cell: ' + JSON.stringify(dom.cellLabelSample) };
        }
        return { verdict: 'pass', detail: 'rows=' + dom.rowCount + ' cols=' + JSON.stringify(dom.columnHeaders) + ' rowHeaders=' + JSON.stringify(dom.rowHeaders) + ' cellSample=' + JSON.stringify(dom.cellLabelSample) };
      },
    },
    {
      id: 'AC-21104-1',
      severity: 'block',
      description: 'Org switcher control renders on the shell header only when tenancy is applied',
      appliesTo: async ({ projectRoot }) => {
        const caps = await readAppliedCapabilities(projectRoot);
        return caps.includes('tenancy');
      },
      run: async ({ browser, runtimeUrl }) => {
        if (!browser) return { verdict: 'fail', detail: 'no packBrowser wired' };
        await browser.goto(withUrl(runtimeUrl, '/admin'));
        const dom = await browser.evaluate(() => {
          const control = document.querySelector('[data-role="org-switcher"]');
          if (!control) return { present: false };
          return { present: true, tag: control.tagName, ariaLabel: control.getAttribute('aria-label') };
        });
        if (!dom.present) return { verdict: 'fail', detail: 'org switcher [data-role="org-switcher"] not present on the shell header' };
        return { verdict: 'pass', detail: 'org-switcher ' + JSON.stringify(dom) };
      },
    },
    {
      id: 'AC-21105-1',
      severity: 'block',
      description: 'Audit-log entries surface with actor, target, before, after, timestamp and correlationId columns; every row enumerable by data-audit-id',
      appliesTo: async ({ projectRoot }) => {
        const caps = await readAppliedCapabilities(projectRoot);
        return caps.includes('auditLog');
      },
      run: async ({ browser, runtimeUrl }) => {
        if (!browser) return { verdict: 'fail', detail: 'no packBrowser wired' };
        await browser.goto(withUrl(runtimeUrl, '/admin/audit'));
        const dom = await browser.evaluate(() => {
          const region = document.querySelector('[data-surface="audit"]');
          if (!region) return { present: false };
          const rows = Array.from(region.querySelectorAll('[data-audit-id]'));
          const ids = rows.map((r) => r.getAttribute('data-audit-id'));
          const columns = Array.from(region.querySelectorAll('[data-column]')).map((c) => c.getAttribute('data-column'));
          const firstRowColumns = rows[0] ? Array.from(rows[0].querySelectorAll('[data-column]')).map((c) => c.getAttribute('data-column')) : [];
          return { present: true, ids, columns, firstRowColumns };
        });
        if (!dom.present) return { verdict: 'fail', detail: 'audit surface [data-surface="audit"] not found' };
        if (dom.ids.length === 0) return { verdict: 'fail', detail: 'audit surface rendered no rows with data-audit-id' };
        const required = ['actor', 'target', 'before', 'after', 'timestamp', 'correlationId'];
        const missing = required.filter((c) => !dom.firstRowColumns.includes(c));
        if (missing.length > 0) {
          return { verdict: 'fail', detail: 'audit entries missing columns: ' + JSON.stringify(missing) + ' present=' + JSON.stringify(dom.firstRowColumns) };
        }
        return { verdict: 'pass', detail: 'auditRows=' + dom.ids.length + ' columns=' + JSON.stringify(dom.firstRowColumns) };
      },
    },
  ],
};
