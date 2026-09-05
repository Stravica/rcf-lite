// application-notifications-in-app probe pack (v1.0.0).
//
// Three runtime-observable checks anchored to the blueprint's ACs:
//   AC-20101-1 live-region preseeding (both wrappers present AND empty
//              at load on every declared route)
//   AC-20102-1 transient toast contract (priority-to-role mapping,
//              one-shot announcement, timeout measured against the
//              ADR-2102 six-second floor via data-shown-at /
//              data-dismissed-at timestamps rather than a sleep in
//              the pack)
//   AC-20103-1 centre acknowledge round-trip (Tab-reachable acknowledge
//              control POSTs to the server, the server responds, the
//              DOM updates in response; enumerated by data-notification-id
//              per the T-3 gate discipline, never by role alone)
//
// Every check drives the real Playwright browser the T-0 runner
// injects (packages/rcf-lite/src/browser-verify/pack-browser.js) and
// asserts on the DOM the applying project renders under TAC-2101
// (live-region wrappers and toast factory), TAC-2102 (centre inbox
// and acknowledge round-trip) and the priority-to-role mapping per
// ADR-2101.
//
// The pack has no network-interception seam (T-0 shipped none); the
// acknowledge round-trip is captured through the request log the
// sample app exposes on window.__notificationFetches and at
// GET /__requests. The toast timeout is measured with browser.evaluate
// reading timestamps the sample app records on the toast element
// (data-shown-at and data-dismissed-at), polled with a bounded loop
// so the pack does not sleep for six seconds on the happy path.

export default {
  packName: 'application-notifications-in-app',
  version: '1.0.0',
  blueprintSlug: 'application-notifications-in-app',
  // Applies to any FBS that realises the live-region TAC or whose
  // navModel routes include a notifications-centre path. The source
  // references BOTH `tacIds` and `route` so the T-0 loader's
  // applicability source-scan sees the two legal seams (route is one
  // of the three legal predicates).
  appliesTo: ({ fbs }) => {
    const routes = fbs?.designStage?.navModel?.routes ?? [];
    const tacIds = fbs?.contextRequirements?.tacIds ?? [];
    if (tacIds.includes('TAC-2101-application-notifications-in-app-live-region')) return true;
    return routes.some((r) => typeof r?.path === 'string' && /notifications-centre/.test(r.path));
  },
  boot: { bootCommand: null, waitForUrl: null, waitForSelector: null },
  checks: [
    {
      id: 'AC-20101-1',
      severity: 'block',
      description: 'Live-region preseeded on every declared route: both the polite wrapper ([aria-live="polite"] [data-live-region="polite"]) and the assertive wrapper ([role="alert"] [data-live-region="assertive"]) are preseeded and empty in the DOM at page load, before any notification fires. Enumerated by the per-element [data-live-region] attribute (never by aria-live or role alone).',
      run: async ({ browser, runtimeUrl }) => {
        if (!browser) return { verdict: 'fail', detail: 'no packBrowser wired' };
        const routes = ['/', '/notifications-centre', '/notifications-preferences'];
        const perRoute = [];
        for (const path of routes) {
          // Preserve the reviewer's --url query verbatim across every
          // route navigation: swap the pathname, keep the search.
          const target = new URL(runtimeUrl);
          target.pathname = path;
          await browser.goto(target.toString());
          const measurement = await browser.evaluate(() => {
            const polite = document.querySelector('[data-live-region="polite"]');
            const assertive = document.querySelector('[data-live-region="assertive"]');
            function inspect(el) {
              if (!el) return null;
              return {
                tag: el.tagName,
                ariaLive: el.getAttribute('aria-live'),
                role: el.getAttribute('role'),
                dataLiveRegion: el.getAttribute('data-live-region'),
                childCount: el.childElementCount,
                textLength: (el.textContent || '').trim().length,
              };
            }
            return { polite: inspect(polite), assertive: inspect(assertive) };
          });
          perRoute.push({ path, measurement });
        }
        const failures = [];
        for (const entry of perRoute) {
          if (!entry.measurement.polite) {
            failures.push({ path: entry.path, reason: 'polite wrapper missing at page load (preseeded wrappers are required per Sara Soueidan normative guidance)' });
            continue;
          }
          if (!entry.measurement.assertive) {
            failures.push({ path: entry.path, reason: 'assertive wrapper missing at page load' });
            continue;
          }
          if (entry.measurement.polite.ariaLive !== 'polite') {
            failures.push({ path: entry.path, reason: 'polite wrapper missing aria-live="polite"' });
          }
          if (entry.measurement.assertive.role !== 'alert') {
            failures.push({ path: entry.path, reason: 'assertive wrapper missing role="alert"' });
          }
          if (entry.measurement.polite.textLength > 0 || entry.measurement.polite.childCount > 0) {
            failures.push({ path: entry.path, reason: 'polite wrapper carries content at page load (must be empty until a notification fires)' });
          }
          if (entry.measurement.assertive.textLength > 0 || entry.measurement.assertive.childCount > 0) {
            failures.push({ path: entry.path, reason: 'assertive wrapper carries content at page load (must be empty until a notification fires)' });
          }
        }
        if (failures.length > 0) {
          return { verdict: 'fail', detail: 'live-region preseeded contract broken: ' + JSON.stringify(failures) };
        }
        return { verdict: 'pass', detail: 'live-region wrappers preseeded and empty on every declared route: ' + JSON.stringify(perRoute.map((r) => ({ path: r.path, polite: r.measurement.polite, assertive: r.measurement.assertive }))) };
      },
    },
    {
      id: 'AC-20102-1',
      severity: 'block',
      description: 'Transient toast contract: an info-priority toast renders inside the polite wrapper with role="status", an error-priority toast renders inside the assertive wrapper with role="alert" (per ADR-2101 priority-to-role mapping); every toast body appears in exactly one wrapper (never both); every toast records data-shown-at and data-dismissed-at, and a timeout-dismissed toast carries an elapsed time at or above the ADR-2102 six-second floor per WCAG 2.2.1.',
      run: async ({ browser, runtimeUrl }) => {
        if (!browser) return { verdict: 'fail', detail: 'no packBrowser wired' };
        const target = new URL('', runtimeUrl).toString();
        await browser.goto(target);
        // Read the shell's declared timeout floor (defaults to six
        // seconds per ADR-2102; may be overridden above the floor).
        const shellFloorSeconds = await browser.evaluate(() => {
          const root = document.querySelector('[data-region="shell-root"]');
          const value = root && root.getAttribute('data-toast-timeout-floor-seconds');
          return value ? Number(value) : 6;
        });
        // Fire one info toast and one error toast through the triggers
        // the fixture ships; a real applying project may drive the
        // same shape via a click on its own trigger, an evaluate hook,
        // or a background-event dispatch.
        await browser.click('[data-toast-trigger="info"]');
        await browser.click('[data-toast-trigger="error"]');
        // Poll for both toasts to dismiss (bounded loop; cap slightly
        // above the shell's floor so a six-second floor passes and a
        // two-second break-timeout run still finishes in time).
        const capMs = Math.max(shellFloorSeconds * 1000, 6000) + 3500;
        const outcome = await browser.evaluate(async (capMs) => {
          const start = Date.now();
          function toastState() {
            const infoToast = document.querySelector('[data-toast-priority="info"]');
            const errorToast = document.querySelector('[data-toast-priority="error"]');
            return { infoToast, errorToast };
          }
          return await new Promise((resolve) => {
            function tick() {
              const { infoToast, errorToast } = toastState();
              const infoDismissedAt = infoToast && infoToast.getAttribute('data-dismissed-at');
              const errorDismissedAt = errorToast && errorToast.getAttribute('data-dismissed-at');
              if (infoDismissedAt && errorDismissedAt) {
                resolve({ done: true });
                return;
              }
              if (Date.now() - start > capMs) {
                resolve({ done: false });
                return;
              }
              setTimeout(tick, 60);
            }
            tick();
          });
        }, capMs);
        if (!outcome || !outcome.done) {
          return { verdict: 'fail', detail: 'toasts did not dismiss within the polling cap (' + capMs + 'ms); the shell may have failed to fire the toast timer' };
        }
        const evidence = await browser.evaluate(() => {
          const politeWrapper = document.querySelector('[data-live-region="polite"]');
          const assertiveWrapper = document.querySelector('[data-live-region="assertive"]');
          function inspect(el) {
            if (!el) return null;
            return {
              id: el.getAttribute('data-toast-id'),
              priority: el.getAttribute('data-toast-priority'),
              role: el.getAttribute('role'),
              parentDataLiveRegion: el.parentElement && el.parentElement.getAttribute('data-live-region'),
              shownAt: el.getAttribute('data-shown-at'),
              dismissedAt: el.getAttribute('data-dismissed-at'),
              body: (el.textContent || '').trim(),
            };
          }
          function texts(wrapper) {
            if (!wrapper) return [];
            return Array.from(wrapper.querySelectorAll('[data-toast-id]')).map((t) => (t.textContent || '').trim());
          }
          const infoToast = document.querySelector('[data-toast-priority="info"]');
          const errorToast = document.querySelector('[data-toast-priority="error"]');
          return {
            info: inspect(infoToast),
            error: inspect(errorToast),
            politeBodies: texts(politeWrapper),
            assertiveBodies: texts(assertiveWrapper),
          };
        });
        if (!evidence.info) return { verdict: 'fail', detail: 'no info-priority toast rendered after trigger' };
        if (!evidence.error) return { verdict: 'fail', detail: 'no error-priority toast rendered after trigger' };
        if (evidence.info.parentDataLiveRegion !== 'polite') {
          return { verdict: 'fail', detail: 'info toast rendered in wrapper ' + JSON.stringify(evidence.info.parentDataLiveRegion) + ' instead of polite (ADR-2101 mapping broken)' };
        }
        if (evidence.info.role !== 'status') {
          return { verdict: 'fail', detail: 'info toast role is ' + JSON.stringify(evidence.info.role) + ' instead of status (ADR-2101 mapping broken)' };
        }
        if (evidence.error.parentDataLiveRegion !== 'assertive') {
          return { verdict: 'fail', detail: 'error toast rendered in wrapper ' + JSON.stringify(evidence.error.parentDataLiveRegion) + ' instead of assertive (ADR-2101 mapping broken)' };
        }
        if (evidence.error.role !== 'alert') {
          return { verdict: 'fail', detail: 'error toast role is ' + JSON.stringify(evidence.error.role) + ' instead of alert (ADR-2101 mapping broken)' };
        }
        // Disjoint-content check (AC-20108-1 support): the info body
        // does not appear in the assertive wrapper and vice versa.
        if (evidence.assertiveBodies.some((body) => body === evidence.info.body)) {
          return { verdict: 'fail', detail: 'info toast body appears in the assertive wrapper (double-post defect)' };
        }
        if (evidence.politeBodies.some((body) => body === evidence.error.body)) {
          return { verdict: 'fail', detail: 'error toast body appears in the polite wrapper (double-post defect)' };
        }
        // Timeout floor check (WCAG 2.2.1): elapsed time between
        // data-shown-at and data-dismissed-at at or above the ADR-2102
        // floor. Six seconds baseline; an operator-elicited override
        // raises the floor (never lowers it).
        const infoElapsed = new Date(evidence.info.dismissedAt).getTime() - new Date(evidence.info.shownAt).getTime();
        const errorElapsed = new Date(evidence.error.dismissedAt).getTime() - new Date(evidence.error.shownAt).getTime();
        const floorMs = shellFloorSeconds * 1000;
        if (infoElapsed < 6000) {
          return { verdict: 'fail', detail: 'info toast dismissed after ' + infoElapsed + 'ms, below the WCAG 2.2.1 six-second floor (shell declared floor: ' + shellFloorSeconds + 's)' };
        }
        if (errorElapsed < 6000) {
          return { verdict: 'fail', detail: 'error toast dismissed after ' + errorElapsed + 'ms, below the WCAG 2.2.1 six-second floor (shell declared floor: ' + shellFloorSeconds + 's)' };
        }
        if (shellFloorSeconds < 6) {
          return { verdict: 'fail', detail: 'shell root declared a toast timeout floor of ' + shellFloorSeconds + 's, below the ADR-2102 six-second floor' };
        }
        return { verdict: 'pass', detail: 'toast contract honoured: info in polite/status (elapsed ' + infoElapsed + 'ms), error in assertive/alert (elapsed ' + errorElapsed + 'ms), floor ' + shellFloorSeconds + 's, ' + evidence.politeBodies.length + ' polite bodies + ' + evidence.assertiveBodies.length + ' assertive bodies, disjoint' };
      },
    },
    {
      id: 'AC-20103-1',
      severity: 'block',
      description: 'Notification centre acknowledge round-trip: the centre lists notifications within the ADR-2103 retention window (default thirty days), each item carries a stable data-notification-id (enumerated per-element, never by role alone), and a Tab-reachable [data-action="acknowledge"] control activates a POST /api/notifications/acknowledge round-trip whose 2xx response flips the item data-acknowledged to true. Reconciled against window.__notificationFetches and /__requests.',
      run: async ({ browser, runtimeUrl }) => {
        if (!browser) return { verdict: 'fail', detail: 'no packBrowser wired' };
        // Preserve the reviewer's --url query across the route swap.
        const target = new URL(runtimeUrl);
        target.pathname = '/notifications-centre';
        await browser.goto(target.toString());
        const initial = await browser.evaluate(() => {
          // Enumerate only the notification wrappers (articles carrying
          // data-notification-id AND data-acknowledged; the acknowledge
          // and mark-read controls also carry data-notification-id so
          // scope the query to article elements).
          const items = Array.from(document.querySelectorAll('article[data-notification-id]'));
          return {
            itemCount: items.length,
            itemIds: items.map((el) => el.getAttribute('data-notification-id')),
            itemAcknowledged: items.map((el) => el.getAttribute('data-acknowledged')),
            centreRegion: Boolean(document.querySelector('[data-region="notifications-centre"]')),
            markAllRead: Boolean(document.querySelector('[data-action="mark-all-read"]')),
            initialFetchCount: (window.__notificationFetches || []).length,
          };
        });
        if (!initial.centreRegion) {
          return { verdict: 'fail', detail: 'centre region not found (missing [data-region="notifications-centre"])' };
        }
        if (initial.itemCount === 0) {
          return { verdict: 'fail', detail: 'centre inbox has zero items; the seeded backlog should render within the retention window' };
        }
        if (!initial.markAllRead) {
          return { verdict: 'fail', detail: 'mark-all-read control missing ([data-action="mark-all-read"])' };
        }
        // Pick the first not-yet-acknowledged item and activate its
        // acknowledge control by clicking. A Tab-driven activation
        // would exercise the same handler; the runner has no keyboard
        // seam beyond click / type / press but the fixture places the
        // acknowledge control inside a <button> so the click is the
        // same click a keyboard activation would trigger.
        const firstUnackIndex = initial.itemAcknowledged.findIndex((v) => v !== 'true');
        if (firstUnackIndex === -1) {
          return { verdict: 'fail', detail: 'every seeded notification is already acknowledged; cannot exercise the round-trip on an unacknowledged item' };
        }
        const targetId = initial.itemIds[firstUnackIndex];
        await browser.click('[data-action="acknowledge"][data-notification-id="' + targetId + '"]');
        // Poll for the DOM update (bounded loop; the acknowledge
        // round-trip should complete in well under a second).
        const outcome = await browser.evaluate(async (targetId) => {
          const start = Date.now();
          return await new Promise((resolve) => {
            function tick() {
              const item = document.querySelector('[data-notification-id="' + targetId + '"]');
              if (item && item.getAttribute('data-acknowledged') === 'true') {
                resolve({ done: true });
                return;
              }
              if (Date.now() - start > 3000) {
                resolve({ done: false });
                return;
              }
              setTimeout(tick, 50);
            }
            tick();
          });
        }, targetId);
        if (!outcome || !outcome.done) {
          return { verdict: 'fail', detail: 'acknowledge on notification ' + JSON.stringify(targetId) + ' did not flip data-acknowledged to true within 3s; the POST or the DOM update path is broken' };
        }
        // Reconcile the round-trip via window.__notificationFetches
        // and /__requests: an `acknowledge` client record and an
        // `acknowledge-server` server record should both exist for
        // this notificationId.
        const clientRecords = await browser.evaluate((targetId) => {
          const fetches = window.__notificationFetches || [];
          return fetches.filter((f) => f.type === 'acknowledge' && f.notificationId === targetId);
        }, targetId);
        if (!clientRecords || clientRecords.length === 0) {
          return { verdict: 'fail', detail: 'no client-side acknowledge fetch recorded for ' + JSON.stringify(targetId) };
        }
        try {
          const requestsRes = await fetch(new URL('/__requests', runtimeUrl).toString());
          if (requestsRes.status !== 200) {
            return { verdict: 'fail', detail: '/__requests endpoint returned ' + requestsRes.status };
          }
          const requestsBody = await requestsRes.json();
          const serverAcks = (Array.isArray(requestsBody) ? requestsBody : []).filter((r) => r.kind === 'acknowledge-server' && r.notificationId === targetId);
          if (serverAcks.length === 0) {
            return { verdict: 'fail', detail: 'no server-side acknowledge record for ' + JSON.stringify(targetId) + ' at /__requests' };
          }
        } catch (err) {
          return { verdict: 'fail', detail: '/__requests endpoint unreachable: ' + err.message };
        }
        return { verdict: 'pass', detail: 'acknowledge round-trip on ' + JSON.stringify(targetId) + ' completed: ' + initial.itemCount + ' items seeded, client + server records reconciled, data-acknowledged flipped to true' };
      },
    },
  ],
};
