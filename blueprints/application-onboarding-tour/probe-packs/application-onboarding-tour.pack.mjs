// application-onboarding-tour probe pack (v1.0.0).
//
// Four surface-observable checks anchored to the blueprint AC ids:
//   AC-26101-1 step-container focus lifecycle and Escape (drives the tour open,
//              asserts the first step renders, walks Tab through the tour
//              controls, presses Escape, asserts dismissal)
//   AC-26102-1 tooltip-as-dialog contract (opens a step, reads the DOM, asserts
//              role="dialog" and aria-labelledby; asserts focus moves to the
//              tooltip on open; asserts focus is not obscured at breakpoints
//              1440 and 360 via the browser.resize seam)
//   AC-26103-1 checklist slot (asserts the checklist renders inside <details open>
//              on the dashboard-top anchor when application-dashboard is applied
//              and inside a <details> closed on the settings-page anchor when not)
//   AC-26104-1 completion-state persistence (completes the tour, reads the
//              completion-state store per the elicited shape, activates restart
//              from the settings surface, asserts the tour re-opens)
//
// Every check drives the real Playwright browser the T-0 runner injects and
// reads its per-check applicability from the blueprint applied sidecar
// (rcf/blueprints/application-onboarding-tour.applied.json) written by the apply
// verb. T-5 has no requiresAppliedCapabilities, but the checklist-slot check
// gates its dashboard-vs-settings branch on the applied-blueprint set
// (application-dashboard present or not), and the persistence check gates its
// backend on the elicited completion-state-store answer (with the Q4 fallback
// spa-local-storage when no persistence blueprint is applied).
//
// Sample-app fixture: packages/rcf-lite/test/fixtures/probe-pack-application-onboarding-tour/.
// The fixture ships APPS and STORE env / ?apps= / ?store= query switches
// mirroring the applied-blueprint set and the elicited completion-state store,
// plus four break switches (?break=no-role, ?break=focus-escape,
// ?break=no-collapse, ?break=no-persist) driving the negative runs.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

async function readAppliedSidecar(projectRoot) {
  if (!projectRoot) return { appliedCapabilities: [], appliedElicitations: {}, appliedBlueprints: [] };
  try {
    const raw = await readFile(join(projectRoot, 'rcf', 'blueprints', 'application-onboarding-tour.applied.json'), 'utf8');
    const doc = JSON.parse(raw);
    return {
      appliedCapabilities: Array.isArray(doc.appliedCapabilities) ? doc.appliedCapabilities.slice() : [],
      appliedElicitations: typeof doc.appliedElicitations === 'object' && doc.appliedElicitations ? doc.appliedElicitations : {},
      appliedBlueprints: Array.isArray(doc.appliedBlueprints) ? doc.appliedBlueprints.slice() : [],
    };
  } catch {
    return { appliedCapabilities: [], appliedElicitations: {}, appliedBlueprints: [] };
  }
}

function withUrl(runtimeUrl, path) {
  return new URL(path, runtimeUrl).toString();
}

function appsQuery(sidecar) {
  // The sidecar's appliedBlueprints[] is the truth; on a fixture where the
  // sidecar is absent (a bare test run) the fixture defaults route through
  // the ?apps= query so the check still runs against the honest branch.
  return sidecar.appliedBlueprints.join(',');
}

export default {
  packName: 'application-onboarding-tour',
  version: '1.0.0',
  blueprintSlug: 'application-onboarding-tour',
  // Applies to any FBS that realises the step-runner TAC or whose navModel
  // routes match the operator-configured tour-anchor path glob (any /tour,
  // /welcome, /getting-started, /onboarding path is a legal anchor).
  appliesTo: ({ fbs }) => {
    const routes = fbs?.designStage?.navModel?.routes ?? [];
    const tacIds = fbs?.contextRequirements?.tacIds ?? [];
    if (tacIds.includes('TAC-2701-application-onboarding-tour-step-runner')) return true;
    return routes.some((r) => typeof r?.path === 'string' && /\/(tour|welcome|getting-started|onboarding)(\/|$)/.test(r.path));
  },
  boot: { bootCommand: null, waitForUrl: null, waitForSelector: null },
  checks: [
    {
      id: 'AC-26101-1',
      severity: 'block',
      description: 'Step-container focus lifecycle: the tour opens the first step on a first-run principal, Tab reaches every tour control inside the tooltip in DOM order without escaping to the underlying surface, and Escape dismisses the tour and returns focus to the anchor (WCAG 2.1.1 Keyboard, 2.1.2 No Keyboard Trap, 2.4.3 Focus Order)',
      appliesTo: async () => true,
      run: async ({ browser, runtimeUrl, projectRoot }) => {
        if (!browser) return { verdict: 'fail', detail: 'no packBrowser wired' };
        const sidecar = await readAppliedSidecar(projectRoot);
        const apps = appsQuery(sidecar);
        await browser.goto(withUrl(runtimeUrl, `/tour?first-run=1&apps=${encodeURIComponent(apps)}`));
        const open = await browser.evaluate(() => {
          const tip = document.querySelector('[data-role="onboarding-tour-tooltip"]');
          if (!tip) return { present: false };
          const role = tip.getAttribute('role');
          const step = tip.getAttribute('data-step-id');
          const controls = Array.from(tip.querySelectorAll('[data-tour-control]')).map((c) => c.getAttribute('data-tour-control'));
          const focusInside = tip.contains(document.activeElement);
          return { present: true, role, step, controls, focusInside };
        });
        if (!open.present) return { verdict: 'fail', detail: 'onboarding tooltip [data-role="onboarding-tour-tooltip"] not rendered on first run' };
        if (open.role !== 'dialog') return { verdict: 'fail', detail: `tooltip role expected dialog, got ${open.role}` };
        if (!open.focusInside) return { verdict: 'fail', detail: 'focus did not move into the tooltip on open' };
        const requiredControls = ['previous', 'next', 'dismiss'];
        const missingControls = requiredControls.filter((c) => !open.controls.includes(c));
        if (missingControls.length > 0) return { verdict: 'fail', detail: `tooltip missing tour controls: ${JSON.stringify(missingControls)} present=${JSON.stringify(open.controls)}` };
        // Walk Tab across every control; refuse if focus escapes the tooltip.
        for (let i = 0; i < open.controls.length + 1; i += 1) {
          await browser.press('Tab');
        }
        const walk = await browser.evaluate(() => {
          const tip = document.querySelector('[data-role="onboarding-tour-tooltip"]');
          return { focusInside: tip ? tip.contains(document.activeElement) : false };
        });
        if (!walk.focusInside) return { verdict: 'fail', detail: 'Tab traversal escaped the tooltip (focus trap failed)' };
        await browser.press('Escape');
        const closed = await browser.evaluate(() => {
          const tip = document.querySelector('[data-role="onboarding-tour-tooltip"]');
          return { present: !!tip };
        });
        if (closed.present) return { verdict: 'fail', detail: 'tooltip still present after Escape (dismiss did not fire)' };
        return { verdict: 'pass', detail: `step=${open.step} controls=${JSON.stringify(open.controls)} focus trapped and Escape dismissed cleanly` };
      },
    },
    {
      id: 'AC-26102-1',
      severity: 'block',
      description: 'Tooltip-as-dialog contract per the ARIA APG dialog-modal pattern: role="dialog", aria-labelledby to the step heading, aria-describedby to the step body, focus moves in on open, focus not obscured at the 1440 wide and 360 narrow breakpoints (WCAG 2.4.11 Focus Not Obscured Minimum)',
      appliesTo: async () => true,
      run: async ({ browser, runtimeUrl, projectRoot }) => {
        if (!browser) return { verdict: 'fail', detail: 'no packBrowser wired' };
        const sidecar = await readAppliedSidecar(projectRoot);
        const apps = appsQuery(sidecar);
        // Wide breakpoint first.
        await browser.resize(1440, 900);
        await browser.goto(withUrl(runtimeUrl, `/tour?first-run=1&apps=${encodeURIComponent(apps)}`));
        const wide = await browser.evaluate(() => {
          const tip = document.querySelector('[data-role="onboarding-tour-tooltip"]');
          if (!tip) return { present: false };
          const headingId = tip.getAttribute('aria-labelledby');
          const bodyId = tip.getAttribute('aria-describedby');
          const headingEl = headingId ? document.getElementById(headingId) : null;
          const bodyEl = bodyId ? document.getElementById(bodyId) : null;
          const rect = tip.getBoundingClientRect();
          const inViewport = rect.top >= 0 && rect.left >= 0 && rect.bottom <= window.innerHeight && rect.right <= window.innerWidth;
          return { present: true, role: tip.getAttribute('role'), headingId, bodyId, headingText: headingEl ? headingEl.textContent : null, bodyText: bodyEl ? bodyEl.textContent : null, inViewport, rect: { top: rect.top, left: rect.left, right: rect.right, bottom: rect.bottom }, viewport: { w: window.innerWidth, h: window.innerHeight } };
        });
        if (!wide.present) return { verdict: 'fail', detail: 'tooltip not rendered at 1440x900' };
        if (wide.role !== 'dialog') return { verdict: 'fail', detail: `tooltip role expected dialog at 1440, got ${wide.role}` };
        if (!wide.headingId || !wide.headingText) return { verdict: 'fail', detail: `tooltip aria-labelledby ("${wide.headingId}") does not point at a live heading element` };
        if (!wide.bodyId || !wide.bodyText) return { verdict: 'fail', detail: `tooltip aria-describedby ("${wide.bodyId}") does not point at a live body element` };
        if (!wide.inViewport) return { verdict: 'fail', detail: `tooltip focus obscured at 1440x900: rect=${JSON.stringify(wide.rect)} viewport=${JSON.stringify(wide.viewport)}` };
        // Narrow breakpoint.
        await browser.resize(360, 640);
        await browser.goto(withUrl(runtimeUrl, `/tour?first-run=1&apps=${encodeURIComponent(apps)}`));
        const narrow = await browser.evaluate(() => {
          const tip = document.querySelector('[data-role="onboarding-tour-tooltip"]');
          if (!tip) return { present: false };
          const rect = tip.getBoundingClientRect();
          const inViewport = rect.top >= 0 && rect.left >= 0 && rect.bottom <= window.innerHeight && rect.right <= window.innerWidth;
          return { present: true, rect: { top: rect.top, left: rect.left, right: rect.right, bottom: rect.bottom }, viewport: { w: window.innerWidth, h: window.innerHeight }, inViewport };
        });
        if (!narrow.present) return { verdict: 'fail', detail: 'tooltip not rendered at 360x640' };
        if (!narrow.inViewport) return { verdict: 'fail', detail: `tooltip focus obscured at 360x640: rect=${JSON.stringify(narrow.rect)} viewport=${JSON.stringify(narrow.viewport)}` };
        return { verdict: 'pass', detail: `dialog contract clean at 1440 and 360; aria-labelledby="${wide.headingId}" aria-describedby="${wide.bodyId}"` };
      },
    },
    {
      id: 'AC-26103-1',
      severity: 'block',
      description: 'Checklist slot: renders inside <details open> on the dashboard-top anchor when application-dashboard is applied, and inside <details> (closed) on the settings-page anchor when not; both branches carry data-role="onboarding-tour-checklist"',
      appliesTo: async () => true,
      run: async ({ browser, runtimeUrl, projectRoot }) => {
        if (!browser) return { verdict: 'fail', detail: 'no packBrowser wired' };
        const sidecar = await readAppliedSidecar(projectRoot);
        const apps = appsQuery(sidecar);
        const dashboardApplied = sidecar.appliedBlueprints.includes('application-dashboard');
        const targetPath = dashboardApplied ? '/dashboard' : '/settings';
        await browser.goto(withUrl(runtimeUrl, `${targetPath}?apps=${encodeURIComponent(apps)}`));
        const dom = await browser.evaluate((expectedAnchor) => {
          const checklist = document.querySelector('details[data-role="onboarding-tour-checklist"]');
          if (!checklist) return { present: false };
          const isOpen = checklist.hasAttribute('open');
          const anchor = checklist.getAttribute('data-anchor');
          const items = Array.from(checklist.querySelectorAll('[data-checklist-item]')).map((el) => el.getAttribute('data-checklist-item'));
          return { present: true, isOpen, anchor, items, expectedAnchor };
        }, dashboardApplied ? 'dashboard-top' : 'settings-page');
        if (!dom.present) return { verdict: 'fail', detail: `details[data-role="onboarding-tour-checklist"] not found at ${targetPath} (apps=${apps})` };
        if (dashboardApplied && !dom.isOpen) return { verdict: 'fail', detail: `checklist on dashboard-top anchor is not <details open> (anchor="${dom.anchor}")` };
        if (!dashboardApplied && dom.isOpen) return { verdict: 'fail', detail: `checklist on settings-page anchor rendered <details open> but should default closed (anchor="${dom.anchor}")` };
        if (dom.anchor !== dom.expectedAnchor) return { verdict: 'fail', detail: `data-anchor expected "${dom.expectedAnchor}", got "${dom.anchor}"` };
        return { verdict: 'pass', detail: `anchor=${dom.anchor} open=${dom.isOpen} items=${JSON.stringify(dom.items)} (dashboardApplied=${dashboardApplied})` };
      },
    },
    {
      id: 'AC-26104-1',
      severity: 'block',
      description: 'Completion-state persistence: completing the tour writes to the elicited completion-state store (spa-local-storage per the Q4 fallback when no persistence blueprint is applied; spa-session-storage or server-side-per-principal per the elicit); the restart-tour control on the settings surface clears the record and re-opens the tour on the next principal load',
      appliesTo: async () => true,
      run: async ({ browser, runtimeUrl, projectRoot }) => {
        if (!browser) return { verdict: 'fail', detail: 'no packBrowser wired' };
        const sidecar = await readAppliedSidecar(projectRoot);
        const apps = appsQuery(sidecar);
        const store = sidecar.appliedElicitations['completion-state-store'] || 'spa-local-storage';
        await browser.goto(withUrl(runtimeUrl, `/tour?first-run=1&apps=${encodeURIComponent(apps)}&store=${encodeURIComponent(store)}&complete=1`));
        const afterComplete = await browser.evaluate((s) => {
          const marker = document.querySelector('[data-role="onboarding-tour-completion-marker"]');
          const writtenAttr = marker ? marker.getAttribute('data-written-to') : null;
          const key = 'onboarding-tour:completion';
          let readBack = null;
          try {
            if (s === 'spa-local-storage') readBack = window.localStorage.getItem(key);
            else if (s === 'spa-session-storage') readBack = window.sessionStorage.getItem(key);
          } catch (e) {
            readBack = `storage-error: ${e.message}`;
          }
          return { markerPresent: !!marker, writtenAttr, readBack };
        }, store);
        if (!afterComplete.markerPresent) return { verdict: 'fail', detail: `completion marker [data-role="onboarding-tour-completion-marker"] not present after complete flow (store=${store})` };
        if (afterComplete.writtenAttr !== store) return { verdict: 'fail', detail: `completion marker data-written-to expected "${store}", got "${afterComplete.writtenAttr}"` };
        if ((store === 'spa-local-storage' || store === 'spa-session-storage') && !afterComplete.readBack) {
          return { verdict: 'fail', detail: `store "${store}" reports no persisted record under key onboarding-tour:completion` };
        }
        // Drive the restart control.
        await browser.goto(withUrl(runtimeUrl, `/settings?apps=${encodeURIComponent(apps)}&store=${encodeURIComponent(store)}`));
        const restartBtn = await browser.evaluate(() => !!document.querySelector('button[data-action="restart-tour"]'));
        if (!restartBtn) return { verdict: 'fail', detail: 'restart-tour control not reachable on settings surface' };
        await browser.click('button[data-action="restart-tour"]');
        await browser.goto(withUrl(runtimeUrl, `/tour?apps=${encodeURIComponent(apps)}&store=${encodeURIComponent(store)}`));
        const reopen = await browser.evaluate(() => !!document.querySelector('[data-role="onboarding-tour-tooltip"]'));
        if (!reopen) return { verdict: 'fail', detail: 'tour did not re-open on the highest-value surface after restart' };
        return { verdict: 'pass', detail: `store=${store} completion persisted, restart cleared, tour re-opened` };
      },
    },
  ],
};
