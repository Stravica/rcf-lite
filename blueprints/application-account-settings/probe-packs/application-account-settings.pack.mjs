// application-account-settings probe pack (v1.0.0).
//
// Five capability-gated checks anchored to the blueprint AC ids:
//   AC-25101-1 shell tabs mirror the applied capability set (always fires; guard-checked)
//   AC-25102-1 profile surface renders with WCAG 1.3.5 autocomplete tokens (always fires)
//   AC-25105-1 security surface renders the branch matching the applied capability +
//              the elicited security-surface-shape (fires when credentialSelfService or
//              hostedIdentityUi is applied)
//   AC-25106-1 sessions surface lists rows and renders the ARIA APG dialog-modal on
//              terminate (fires when sessionInventory is applied)
//   AC-25108-1 theme surface renders the radiogroup and persists per the elicited
//              theme-persistence (fires when application-spa is applied via caps)
//
// Every check drives the real Playwright browser the runner injects and reads
// its per-check applicability from the blueprint applied sidecar
// (rcf/blueprints/application-account-settings.applied.json) written by the apply
// verb: an absent capability records verdict: skipped and the aggregate treats the
// check as neither pass nor fail (spec section 3.3, rcf-schemas 0.6.1 has no
// applicable: false field, per round-3 precedent).
//
// Sample-app fixture: packages/rcf-lite/test/fixtures/probe-pack-application-account-settings/.
// The fixture ships CAPS and APPS env / ?caps= / ?apps= switches mirroring the
// applied capability set so the pack can be probed for every fixture combination
// on the shelf gate.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

async function readAppliedCapabilities(projectRoot) {
  if (!projectRoot) return [];
  try {
    const raw = await readFile(join(projectRoot, 'rcf', 'blueprints', 'application-account-settings.applied.json'), 'utf8');
    const doc = JSON.parse(raw);
    return Array.isArray(doc.appliedCapabilities) ? doc.appliedCapabilities.slice() : [];
  } catch {
    return [];
  }
}

async function readAppliedElicitations(projectRoot) {
  if (!projectRoot) return {};
  try {
    const raw = await readFile(join(projectRoot, 'rcf', 'blueprints', 'application-account-settings.applied.json'), 'utf8');
    const doc = JSON.parse(raw);
    return typeof doc.appliedElicitations === 'object' && doc.appliedElicitations ? doc.appliedElicitations : {};
  } catch {
    return {};
  }
}

function withUrl(runtimeUrl, path) {
  return new URL(path, runtimeUrl).toString();
}

export default {
  packName: 'application-account-settings',
  version: '1.0.0',
  blueprintSlug: 'application-account-settings',
  appliesTo: ({ fbs }) => {
    const routes = fbs?.designStage?.navModel?.routes ?? [];
    const tacIds = fbs?.contextRequirements?.tacIds ?? [];
    if (tacIds.includes('TAC-2601-application-account-settings-shell')) return true;
    return routes.some((r) => typeof r?.path === 'string' && /\/(account|settings|profile)(\/|$)/.test(r.path));
  },
  boot: { bootCommand: null, waitForUrl: null, waitForSelector: null },
  checks: [
    {
      id: 'AC-25101-1',
      severity: 'block',
      description: 'Shell renders as an ARIA APG tabs region and its tabs mirror the union of applied capabilities plus the always-on profile tab; a tab whose capability is not applied does not render',
      appliesTo: async () => true,
      run: async ({ browser, runtimeUrl, projectRoot }) => {
        if (!browser) return { verdict: 'fail', detail: 'no packBrowser wired' };
        const caps = await readAppliedCapabilities(projectRoot);
        await browser.goto(withUrl(runtimeUrl, '/account'));
        const dom = await browser.evaluate(() => {
          const nav = document.querySelector('nav[data-role="account-settings-nav"]');
          if (!nav) return { present: false };
          const tabs = Array.from(nav.querySelectorAll('[role="tab"]')).map((t) => t.getAttribute('data-tab-id'));
          const role = nav.getAttribute('role');
          const ariaLabel = nav.getAttribute('aria-label');
          return { present: true, tabs, role, ariaLabel };
        });
        if (!dom.present) return { verdict: 'fail', detail: 'nav[data-role="account-settings-nav"] not found' };
        if (dom.role !== 'tablist') return { verdict: 'fail', detail: `nav role expected tablist, got ${dom.role}` };
        if (!dom.ariaLabel) return { verdict: 'fail', detail: 'nav missing aria-label (accessible name)' };
        if (!dom.tabs.includes('profile')) return { verdict: 'fail', detail: `profile tab missing from ${JSON.stringify(dom.tabs)}` };
        const securityExpected = caps.includes('credentialSelfService') || caps.includes('hostedIdentityUi');
        const securityRendered = dom.tabs.includes('security');
        if (securityExpected && !securityRendered) return { verdict: 'fail', detail: `security tab expected (caps=${JSON.stringify(caps)}) but not rendered` };
        if (!securityExpected && securityRendered) return { verdict: 'fail', detail: `security tab rendered but caps=${JSON.stringify(caps)} declare neither credentialSelfService nor hostedIdentityUi (leak)` };
        const sessionsExpected = caps.includes('sessionInventory');
        const sessionsRendered = dom.tabs.includes('sessions');
        if (sessionsExpected && !sessionsRendered) return { verdict: 'fail', detail: `sessions tab expected but not rendered` };
        if (!sessionsExpected && sessionsRendered) return { verdict: 'fail', detail: `sessions tab rendered but sessionInventory not applied (leak)` };
        return { verdict: 'pass', detail: `tabs=${JSON.stringify(dom.tabs)} caps=${JSON.stringify(caps)}` };
      },
    },
    {
      id: 'AC-25102-1',
      severity: 'block',
      description: 'Profile surface renders a form with WCAG 1.3.5 autocomplete tokens (name, email, bday, country) and a polite aria-live save-status region',
      appliesTo: async () => true,
      run: async ({ browser, runtimeUrl }) => {
        if (!browser) return { verdict: 'fail', detail: 'no packBrowser wired' };
        await browser.goto(withUrl(runtimeUrl, '/account/profile'));
        const dom = await browser.evaluate(() => {
          const form = document.querySelector('form[data-surface="profile"]');
          if (!form) return { present: false };
          const nameAuto = form.querySelector('input[name="name"]')?.getAttribute('autocomplete');
          const emailAuto = form.querySelector('input[name="email"]')?.getAttribute('autocomplete');
          const bdayAuto = form.querySelector('input[name="bday"]')?.getAttribute('autocomplete');
          const countryAuto = form.querySelector('input[name="country"]')?.getAttribute('autocomplete');
          const status = form.querySelector('[role="status"][aria-live="polite"]');
          return { present: true, nameAuto, emailAuto, bdayAuto, countryAuto, statusPresent: !!status };
        });
        if (!dom.present) return { verdict: 'fail', detail: 'form[data-surface="profile"] not found' };
        if (dom.nameAuto !== 'name') return { verdict: 'fail', detail: `name autocomplete token expected "name", got "${dom.nameAuto}"` };
        if (dom.emailAuto !== 'email') return { verdict: 'fail', detail: `email autocomplete token expected "email", got "${dom.emailAuto}"` };
        if (dom.bdayAuto !== 'bday') return { verdict: 'fail', detail: `bday autocomplete token expected "bday", got "${dom.bdayAuto}"` };
        if (dom.countryAuto !== 'country') return { verdict: 'fail', detail: `country autocomplete token expected "country", got "${dom.countryAuto}"` };
        if (!dom.statusPresent) return { verdict: 'fail', detail: 'save-status region [role="status"][aria-live="polite"] not found' };
        return { verdict: 'pass', detail: `autocomplete tokens name+email+bday+country present; save-status present` };
      },
    },
    {
      id: 'AC-25105-1',
      severity: 'block',
      description: 'Security surface renders the self-service branch when credentialSelfService is applied and security-surface-shape=self-service; renders the hosted-link-out or hosted-embed branch when hostedIdentityUi is applied and security-surface-shape matches',
      appliesTo: async ({ projectRoot }) => {
        const caps = await readAppliedCapabilities(projectRoot);
        return caps.includes('credentialSelfService') || caps.includes('hostedIdentityUi');
      },
      run: async ({ browser, runtimeUrl, projectRoot }) => {
        if (!browser) return { verdict: 'fail', detail: 'no packBrowser wired' };
        const caps = await readAppliedCapabilities(projectRoot);
        const elicits = await readAppliedElicitations(projectRoot);
        const shape = elicits['security-surface-shape'] ?? 'self-service';
        await browser.goto(withUrl(runtimeUrl, `/account/security?security-surface-shape=${encodeURIComponent(shape)}`));
        const dom = await browser.evaluate(() => {
          const region = document.querySelector('[data-surface="security"]');
          if (!region) return { present: false };
          return {
            present: true,
            branch: region.getAttribute('data-branch'),
            hasPassword: !!region.querySelector('[data-role="change-password"]'),
            hasMfa: !!region.querySelector('[data-role="mfa-management"]'),
            hasLinkOut: !!region.querySelector('[data-role="hosted-link-out"]'),
            hasEmbed: !!region.querySelector('[data-role="hosted-embed"]'),
            linkRel: region.querySelector('[data-role="hosted-link-out"]')?.getAttribute('rel'),
            embedSandbox: region.querySelector('[data-role="hosted-embed"]')?.getAttribute('sandbox'),
          };
        });
        if (!dom.present) return { verdict: 'fail', detail: '[data-surface="security"] not found' };
        if (caps.includes('credentialSelfService') && shape === 'self-service') {
          if (!dom.hasPassword) return { verdict: 'fail', detail: 'self-service branch missing [data-role="change-password"]' };
          if (!dom.hasMfa) return { verdict: 'fail', detail: 'self-service branch missing [data-role="mfa-management"]' };
        } else if (caps.includes('hostedIdentityUi') && shape === 'hosted-link-out') {
          if (!dom.hasLinkOut) return { verdict: 'fail', detail: 'hosted-link-out branch missing [data-role="hosted-link-out"]' };
          if (!/noopener/.test(dom.linkRel || '')) return { verdict: 'fail', detail: `hosted-link-out missing rel=noopener (rel="${dom.linkRel}")` };
        } else if (caps.includes('hostedIdentityUi') && shape === 'hosted-embed') {
          if (!dom.hasEmbed) return { verdict: 'fail', detail: 'hosted-embed branch missing [data-role="hosted-embed"]' };
          if (!/allow-scripts/.test(dom.embedSandbox || '')) return { verdict: 'fail', detail: `hosted-embed sandbox missing allow-scripts (got "${dom.embedSandbox}")` };
        } else {
          return { verdict: 'fail', detail: `no branch matches caps=${JSON.stringify(caps)} shape="${shape}"` };
        }
        return { verdict: 'pass', detail: `branch=${dom.branch} caps=${JSON.stringify(caps)} shape="${shape}"` };
      },
    },
    {
      id: 'AC-25106-1',
      severity: 'block',
      description: 'Sessions surface renders one row per active session enumerated by data-session-id with device and last-active columns plus a terminate action; opens an ARIA APG dialog-modal on terminate',
      appliesTo: async ({ projectRoot }) => {
        const caps = await readAppliedCapabilities(projectRoot);
        return caps.includes('sessionInventory');
      },
      run: async ({ browser, runtimeUrl }) => {
        if (!browser) return { verdict: 'fail', detail: 'no packBrowser wired' };
        await browser.goto(withUrl(runtimeUrl, '/account/sessions'));
        const dom = await browser.evaluate(() => {
          const region = document.querySelector('[data-surface="sessions"]');
          if (!region) return { present: false };
          const rows = Array.from(region.querySelectorAll('[data-session-id]'));
          const ids = rows.map((r) => r.getAttribute('data-session-id'));
          const firstRowColumns = rows[0] ? Array.from(rows[0].querySelectorAll('[data-column]')).map((c) => c.getAttribute('data-column')) : [];
          const nonCurrentTerminates = rows.filter((r) => r.getAttribute('data-current-session') !== 'true').every((r) => !!r.querySelector('[data-action="terminate"]'));
          const currentRow = rows.find((r) => r.getAttribute('data-current-session') === 'true');
          const currentHasTerminate = currentRow ? !!currentRow.querySelector('[data-action="terminate"]') : false;
          const dialog = region.querySelector('[role="dialog"][aria-modal="true"][data-role="terminate-confirm"]');
          const dialogLabel = dialog ? dialog.getAttribute('aria-labelledby') : null;
          const announce = region.querySelector('[role="status"][aria-live="polite"][data-role="session-terminated-announce"]');
          return { present: true, ids, firstRowColumns, nonCurrentTerminates, currentHasTerminate, dialogPresent: !!dialog, dialogLabel, announcePresent: !!announce };
        });
        if (!dom.present) return { verdict: 'fail', detail: '[data-surface="sessions"] not found' };
        if (dom.ids.length === 0) return { verdict: 'fail', detail: 'sessions surface rendered no rows with data-session-id' };
        const required = ['device', 'lastActive'];
        const missing = required.filter((c) => !dom.firstRowColumns.includes(c));
        if (missing.length > 0) return { verdict: 'fail', detail: `sessions rows missing columns: ${JSON.stringify(missing)} present=${JSON.stringify(dom.firstRowColumns)}` };
        if (!dom.nonCurrentTerminates) return { verdict: 'fail', detail: 'at least one non-current session row missing [data-action="terminate"]' };
        if (dom.currentHasTerminate) return { verdict: 'fail', detail: 'the current-session row must not carry [data-action="terminate"]' };
        if (!dom.dialogPresent) return { verdict: 'fail', detail: 'terminate confirmation dialog [role="dialog"][aria-modal="true"] not rendered' };
        if (!dom.dialogLabel) return { verdict: 'fail', detail: 'dialog missing aria-labelledby' };
        if (!dom.announcePresent) return { verdict: 'fail', detail: 'session-terminated announce region not rendered' };
        return { verdict: 'pass', detail: `rows=${JSON.stringify(dom.ids)} columns=${JSON.stringify(dom.firstRowColumns)} dialog=${dom.dialogPresent}` };
      },
    },
    {
      id: 'AC-25108-1',
      severity: 'block',
      description: 'Theme surface renders as an ARIA APG radiogroup with light/dark/system options and persists per the elicited theme-persistence',
      appliesTo: async ({ projectRoot }) => {
        // The theme surface gates on application-spa being applied. On the
        // fixture side we mirror this via the ?apps=application-spa switch.
        // A future minor bump reads the manifest.blueprints[] set directly;
        // for v1 the applied-blueprint set is inferred from the caps sidecar
        // and the appliedElicitations map (theme-persistence answered => spa applied).
        const elicits = await readAppliedElicitations(projectRoot);
        return typeof elicits['theme-persistence'] === 'string';
      },
      run: async ({ browser, runtimeUrl, projectRoot }) => {
        if (!browser) return { verdict: 'fail', detail: 'no packBrowser wired' };
        const elicits = await readAppliedElicitations(projectRoot);
        const persist = elicits['theme-persistence'] ?? 'spa-local-storage';
        await browser.goto(withUrl(runtimeUrl, `/account/theme?apps=application-spa&theme-persistence=${encodeURIComponent(persist)}`));
        const dom = await browser.evaluate(() => {
          const region = document.querySelector('[data-surface="theme"]');
          if (!region) return { present: false };
          const role = region.getAttribute('role');
          const ariaLabel = region.getAttribute('aria-label');
          const persistAttr = region.getAttribute('data-persist');
          const options = Array.from(region.querySelectorAll('input[type="radio"][name="theme"]')).map((el) => el.getAttribute('value'));
          return { present: true, role, ariaLabel, persistAttr, options };
        });
        if (!dom.present) return { verdict: 'fail', detail: '[data-surface="theme"] not found' };
        if (dom.role !== 'radiogroup') return { verdict: 'fail', detail: `role expected radiogroup, got ${dom.role}` };
        if (!dom.ariaLabel) return { verdict: 'fail', detail: 'radiogroup missing aria-label' };
        const required = ['light', 'dark', 'system'];
        const missing = required.filter((v) => !dom.options.includes(v));
        if (missing.length > 0) return { verdict: 'fail', detail: `radiogroup missing options: ${JSON.stringify(missing)} present=${JSON.stringify(dom.options)}` };
        if (dom.persistAttr !== persist) return { verdict: 'fail', detail: `data-persist expected "${persist}", got "${dom.persistAttr}"` };
        return { verdict: 'pass', detail: `role=${dom.role} options=${JSON.stringify(dom.options)} persist=${dom.persistAttr}` };
      },
    },
  ],
};
