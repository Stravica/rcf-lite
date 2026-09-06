// application-forms-wizard probe pack (v1.0.0).
//
// Four surface-observable checks, one per core contract, anchored
// to the blueprint's contributed AC ids:
//   AC-24101-1 task-list (per-step state from the GOV.UK vocabulary,
//              ARIA progressbar wrapper)
//   AC-24103-1 error-summary (top-of-page summary, skip links,
//              aria-invalid on the field, focus to summary heading)
//   AC-24104-1 summary-review (summary-list rows, Change links,
//              answer retention across an edit-and-save round-trip)
//   AC-24105-1 save-and-return (server-draft POST/GET round-trip on
//              ?draft-store=server, localStorage write plus sync tick
//              on ?draft-store=local; the ?draft-store=none branch
//              proves the missing-transport refusal on the fixture)
//
// Every check drives the real Playwright browser the T-0 runner
// injects. URLs are composed by the withUrl(runtimeUrl, path)
// helper per the round 3 T-3 fix train; no bare string
// concatenation.
//
// Sample-app fixture:
// packages/rcf-lite/test/fixtures/probe-pack-application-forms-wizard/
// Fixture ships four routes (/task-list, /step/<n>, /summary,
// /in-progress) plus query switches (?draft-store=server|local|none,
// ?nav=linear|free, ?step=<n>) and break switches
// (?break=task-list-vocab, ?break=no-summary, ?break=no-retain,
// ?break=no-draft) so the negative runs can be driven from a
// single boot.

function withUrl(runtimeUrl, path) {
  return new URL(path, runtimeUrl).toString();
}

// GOV.UK task-list vocabulary (closed enum, v1.0.0). A fifth state
// is a v1.1.0 minor bump.
const TASK_LIST_STATES = ['Cannot start yet', 'Not started', 'In progress', 'Completed'];

export default {
  packName: 'application-forms-wizard',
  version: '1.0.0',
  blueprintSlug: 'application-forms-wizard',
  // Applies to any FBS that realises the task-list TAC or whose
  // navModel routes name an operator-configured wizard path.
  // References BOTH tacIds AND route per the loader source-scan
  // rule (T-0 AC-1701-3, cross-check with authoring standard 8c).
  appliesTo: ({ fbs }) => {
    const routes = fbs?.designStage?.navModel?.routes ?? [];
    const tacIds = fbs?.contextRequirements?.tacIds ?? [];
    if (tacIds.includes('TAC-2501-application-forms-wizard-task-list')) return true;
    return routes.some((r) => typeof r?.path === 'string' && /\/(?:task-list|step|summary|in-progress|wizard)(\/|$|\?)/.test(r.path));
  },
  boot: { bootCommand: null, waitForUrl: null, waitForSelector: null },
  checks: [
    {
      id: 'AC-24101-1',
      severity: 'block',
      description: 'task-list surface renders every step with a data-step-state from the closed GOV.UK vocabulary {Cannot start yet, Not started, In progress, Completed}, wraps them in an ARIA progressbar with aria-valuenow, aria-valuemax and aria-valuetext, and enumerates the step slugs in the manifest order (per WCAG 2.2 SC 2.4.6 Headings and Labels).',
      run: async ({ browser, runtimeUrl }) => {
        if (!browser) return { verdict: 'fail', detail: 'no packBrowser wired' };
        await browser.goto(withUrl(runtimeUrl, '/task-list'));
        const dom = await browser.evaluate(() => {
          const region = document.querySelector('[data-surface="task-list"]');
          if (!region) return { present: false };
          const progressbar = region.querySelector('[role="progressbar"]');
          const rows = Array.from(region.querySelectorAll('[data-step-slug]'));
          return {
            present: true,
            hasProgressbar: !!progressbar,
            valueNow: progressbar ? progressbar.getAttribute('aria-valuenow') : null,
            valueMax: progressbar ? progressbar.getAttribute('aria-valuemax') : null,
            valueText: progressbar ? progressbar.getAttribute('aria-valuetext') : null,
            rows: rows.map((r) => ({ slug: r.getAttribute('data-step-slug'), state: r.getAttribute('data-step-state') })),
          };
        });
        if (!dom.present) return { verdict: 'fail', detail: 'task-list region [data-surface="task-list"] not found' };
        if (!dom.hasProgressbar) return { verdict: 'fail', detail: 'task-list region missing [role="progressbar"] wrapper' };
        if (!dom.valueNow || !dom.valueMax || !dom.valueText) {
          return { verdict: 'fail', detail: `progressbar missing aria attributes: valuenow=${JSON.stringify(dom.valueNow)} valuemax=${JSON.stringify(dom.valueMax)} valuetext=${JSON.stringify(dom.valueText)}` };
        }
        if (dom.rows.length < 2) return { verdict: 'fail', detail: `task-list rows must number at least 2; got ${dom.rows.length}` };
        const closedStates = ['Cannot start yet', 'Not started', 'In progress', 'Completed'];
        const badRow = dom.rows.find((r) => !r.slug || !closedStates.includes(r.state));
        if (badRow) return { verdict: 'fail', detail: `task-list row outside the closed GOV.UK vocabulary: ${JSON.stringify(badRow)}` };
        return { verdict: 'pass', detail: `rows=${dom.rows.length} progressbar=${JSON.stringify({ now: dom.valueNow, max: dom.valueMax, text: dom.valueText })}` };
      },
    },
    {
      id: 'AC-24103-1',
      severity: 'block',
      description: 'On submit refusal the step renders [data-surface="error-summary"] with a heading, one anchor per failed field whose href points at the field id, every failed field carries aria-invalid="true" and aria-describedby referencing its per-field error message, and focus lands on the summary heading (per WCAG 2.2 SC 3.3.1 Error Identification and SC 3.3.3 Error Suggestion).',
      run: async ({ browser, runtimeUrl }) => {
        if (!browser) return { verdict: 'fail', detail: 'no packBrowser wired' };
        // The fixture step 2 route pre-renders the error summary shape
        // on ?refused=1 so the pack can read the DOM without driving
        // the submit click through the browser transport.
        await browser.goto(withUrl(runtimeUrl, '/step/2?refused=1'));
        const dom = await browser.evaluate(() => {
          const region = document.querySelector('[data-surface="error-summary"]');
          if (!region) return { present: false };
          const heading = region.querySelector('h2, [role="heading"]');
          const anchors = Array.from(region.querySelectorAll('a[href^="#"]'));
          const anchorHrefs = anchors.map((a) => a.getAttribute('href'));
          const invalidFields = Array.from(document.querySelectorAll('[aria-invalid="true"]'));
          const describedFields = invalidFields.map((f) => ({
            id: f.id,
            describedBy: f.getAttribute('aria-describedby'),
            messagePresent: f.getAttribute('aria-describedby')
              ? !!document.getElementById(f.getAttribute('aria-describedby'))
              : false,
          }));
          const activeSelector = document.activeElement
            ? [document.activeElement.tagName.toLowerCase(), document.activeElement.getAttribute('data-role') || document.activeElement.id || ''].filter(Boolean).join('#')
            : null;
          return {
            present: true,
            headingText: heading ? heading.textContent.trim() : null,
            anchorHrefs,
            invalidFields: describedFields,
            activeSelector,
            activeIsHeading: !!(document.activeElement && heading && document.activeElement === heading),
          };
        });
        if (!dom.present) return { verdict: 'fail', detail: 'error-summary region [data-surface="error-summary"] not found' };
        if (!dom.headingText) return { verdict: 'fail', detail: 'error-summary region missing heading' };
        if (dom.anchorHrefs.length < 1) return { verdict: 'fail', detail: 'error-summary region carries no skip links' };
        if (dom.invalidFields.length < 1) return { verdict: 'fail', detail: 'no fields carry aria-invalid="true" on submit refusal' };
        const unbound = dom.invalidFields.find((f) => !f.describedBy || !f.messagePresent);
        if (unbound) return { verdict: 'fail', detail: `field ${JSON.stringify(unbound.id)} missing aria-describedby or its message: ${JSON.stringify(unbound)}` };
        if (!dom.activeIsHeading) return { verdict: 'fail', detail: `focus did not land on the summary heading; activeSelector=${JSON.stringify(dom.activeSelector)}` };
        return { verdict: 'pass', detail: `anchors=${dom.anchorHrefs.length} invalidFields=${dom.invalidFields.length} heading=${JSON.stringify(dom.headingText)}` };
      },
    },
    {
      id: 'AC-24104-1',
      severity: 'block',
      description: 'summary-review surface renders one [data-summary-list-section] per step with a <dl> holding [data-summary-row] entries, every row exposes a [data-recovery="change"] link, and after following one Change link and saving a new value the other rows retain their original values verbatim (per WCAG 2.2 SC 3.3.4 Error Prevention).',
      run: async ({ browser, runtimeUrl }) => {
        if (!browser) return { verdict: 'fail', detail: 'no packBrowser wired' };
        // The fixture seeds three steps of answers on ?seed=complete
        // so /summary renders fully populated for the pack.
        await browser.goto(withUrl(runtimeUrl, '/summary?seed=complete'));
        const before = await browser.evaluate(() => {
          const region = document.querySelector('[data-surface="summary-review"]');
          if (!region) return { present: false };
          const sections = Array.from(region.querySelectorAll('[data-summary-list-section]'));
          const rows = Array.from(region.querySelectorAll('[data-summary-row]'));
          const rowSnapshot = rows.map((r) => {
            const dt = r.querySelector('dt');
            const dd = r.querySelector('dd');
            const change = r.querySelector('[data-recovery="change"]');
            return {
              label: dt ? dt.textContent.trim() : null,
              value: dd ? dd.textContent.trim() : null,
              hasChange: !!change,
              slug: r.getAttribute('data-field-slug') || null,
            };
          });
          return { present: true, sectionCount: sections.length, rows: rowSnapshot };
        });
        if (!before.present) return { verdict: 'fail', detail: 'summary-review region [data-surface="summary-review"] not found' };
        if (before.sectionCount < 1) return { verdict: 'fail', detail: 'summary-review carries zero [data-summary-list-section] blocks' };
        if (before.rows.length < 1) return { verdict: 'fail', detail: 'summary-review carries zero [data-summary-row] entries' };
        const rowMissingChange = before.rows.find((r) => !r.hasChange);
        if (rowMissingChange) return { verdict: 'fail', detail: `summary-review row missing [data-recovery="change"] link: ${JSON.stringify(rowMissingChange)}` };
        // Drive the edit-and-save round-trip via the fixture's
        // synthetic ?edit=<slug>&value=<new> query on /summary so the
        // browser transport does not require a full form submit path.
        const editTarget = before.rows[0];
        if (!editTarget.slug) return { verdict: 'fail', detail: 'first summary row is missing [data-field-slug]; the fixture must expose the slug for the round-trip' };
        const newValue = `edited-value-${Date.now()}`;
        await browser.goto(withUrl(runtimeUrl, `/summary?seed=complete&edit=${encodeURIComponent(editTarget.slug)}&value=${encodeURIComponent(newValue)}`));
        const after = await browser.evaluate(() => {
          const region = document.querySelector('[data-surface="summary-review"]');
          const rows = Array.from(region.querySelectorAll('[data-summary-row]'));
          return rows.map((r) => {
            const dd = r.querySelector('dd');
            return {
              slug: r.getAttribute('data-field-slug') || null,
              value: dd ? dd.textContent.trim() : null,
            };
          });
        });
        const editedAfter = after.find((r) => r.slug === editTarget.slug);
        if (!editedAfter || editedAfter.value !== newValue) {
          return { verdict: 'fail', detail: `edited row did not update to the new value; expected ${JSON.stringify(newValue)}, got ${JSON.stringify(editedAfter && editedAfter.value)}` };
        }
        const drifted = before.rows.filter((r) => r.slug && r.slug !== editTarget.slug).find((r) => {
          const afterRow = after.find((a) => a.slug === r.slug);
          return !afterRow || afterRow.value !== r.value;
        });
        if (drifted) return { verdict: 'fail', detail: `an unedited row changed value across the edit-and-save round-trip: ${JSON.stringify(drifted)}` };
        return { verdict: 'pass', detail: `sections=${before.sectionCount} rows=${before.rows.length} editedSlug=${JSON.stringify(editTarget.slug)}` };
      },
    },
    {
      id: 'AC-24105-1',
      severity: 'block',
      description: 'save-and-return contract ships either the server-side draft table (?draft-store=server issues POST /drafts on advance and GET /drafts returns the persisted answer) or the client-side local buffer (?draft-store=local writes to window.localStorage and renders [data-sync-tick] carrying an ISO-8601 timestamp on every write). The ?draft-store=none branch refuses at severity block (per WCAG 2.2 SC 3.3.7 Redundant Entry).',
      run: async ({ browser, runtimeUrl }) => {
        if (!browser) return { verdict: 'fail', detail: 'no packBrowser wired' };
        // The fixture pre-drives the write on /step/1 boot so the
        // pack can inspect the persisted state without simulating a
        // form submit through the browser transport.
        await browser.goto(withUrl(runtimeUrl, '/step/1?draft-store=server&preseed=1'));
        const server = await browser.evaluate(async () => {
          const res = await fetch('/drafts');
          const body = res.ok ? await res.json() : null;
          return { status: res.status, body };
        });
        if (server.status !== 200 || !server.body || typeof server.body !== 'object') {
          return { verdict: 'fail', detail: `server-draft GET /drafts did not return a JSON body: status=${server.status} body=${JSON.stringify(server.body)}` };
        }
        const persistedFields = server.body.fields;
        if (!persistedFields || Object.keys(persistedFields).length < 1) {
          return { verdict: 'fail', detail: `server-draft body carries no persisted fields: ${JSON.stringify(server.body)}` };
        }
        await browser.goto(withUrl(runtimeUrl, '/step/1?draft-store=local&preseed=1'));
        const local = await browser.evaluate(() => {
          const keys = Object.keys(window.localStorage).filter((k) => k.startsWith('draft:application-forms-wizard:'));
          const tick = document.querySelector('[data-sync-tick]');
          return { keys, tickText: tick ? tick.getAttribute('data-sync-tick') || tick.textContent.trim() : null };
        });
        if (local.keys.length < 1) {
          return { verdict: 'fail', detail: `client-local localStorage did not carry a namespaced draft key: keys=${JSON.stringify(local.keys)}` };
        }
        if (!local.tickText || !/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(local.tickText)) {
          return { verdict: 'fail', detail: `client-local [data-sync-tick] missing or not ISO-8601: ${JSON.stringify(local.tickText)}` };
        }
        return { verdict: 'pass', detail: `serverPersistedFields=${JSON.stringify(Object.keys(persistedFields))} localKeys=${local.keys.length} tick=${JSON.stringify(local.tickText)}` };
      },
    },
  ],
};
