// application-datatable probe pack (v1.0.0).
//
// Six runtime-observable checks anchored to the blueprint's ACs:
//   AC-17101-1 sort click reorders rows (server-side sort)
//   AC-17102-1 filter chrome text-search issues q=<value> request
//   AC-17103-2 pagination announcement via aria-live "Page N of M"
//   AC-17104-3 bulk-action confirmation focus return
//   AC-17105-1 state region distinctness (empty / loading / error / no-results)
//   AC-17106-1 column reorder keyboard alternative
//
// Every check drives the real Playwright browser the runner injects
// (see rcf-lite src/browser-verify/pack-browser.js). Runs against a
// server-side implementation of the shell: a keyboard-reachable sort
// control, a text filter that issues fetch('/api/rows?q=...'),
// pagination with an aria-live status region, row selection with a
// bulk action that opens an aria-modal dialog and returns focus on
// close, four distinct query-driven states, and a non-drag column
// reorder path.

export default {
  packName: 'application-datatable',
  version: '1.0.0',
  blueprintSlug: 'application-datatable',
  // Applies to any FBS that realises the datatable shell TAC or whose
  // navModel routes name a datatable path. The source references both
  // `tacIds` and `route` so the loader's applicability source-scan
  // (route / tacIds / blueprint: tag) sees the two legal seams.
  appliesTo: ({ fbs }) => {
    const routes = fbs?.designStage?.navModel?.routes ?? [];
    const tacIds = fbs?.contextRequirements?.tacIds ?? [];
    if (tacIds.includes('TAC-1801-application-datatable-shell')) return true;
    return routes.some((r) => typeof r?.path === 'string' && /datatable-shell|\/dt(\/|$)/.test(r.path));
  },
  boot: { bootCommand: null, waitForUrl: null, waitForSelector: null },
  checks: [
    {
      id: 'AC-17101-1',
      severity: 'block',
      description: 'Sort click reorders rendered rows to match server sort order',
      run: async ({ browser, fetch, runtimeUrl }) => {
        if (!browser) return { verdict: 'fail', detail: 'no packBrowser wired' };
        await browser.goto(runtimeUrl + '/');
        const initialIds = await browser.evaluate(() =>
          Array.from(document.querySelectorAll('table[role="grid"] tbody tr'))
            .map((tr) => Number(tr.getAttribute('data-id'))));
        if (!Array.isArray(initialIds) || initialIds.length === 0) {
          return { verdict: 'fail', detail: 'no rows rendered: ' + JSON.stringify(initialIds) };
        }
        await browser.click('button.sortControl[data-column="score"]', 'score sort control');
        // Give the client a beat to fetch and re-render.
        await new Promise((resolve) => setTimeout(resolve, 500));
        const sortedIds = await browser.evaluate(() =>
          Array.from(document.querySelectorAll('table[role="grid"] tbody tr'))
            .map((tr) => Number(tr.getAttribute('data-id'))));
        const apiRes = await fetch(runtimeUrl + '/api/rows?sort=score:asc&page=1&pageSize=3');
        const apiPayload = await apiRes.json();
        const apiIds = apiPayload.rows.map((r) => r.id);
        if (JSON.stringify(sortedIds) === JSON.stringify(initialIds)) {
          return { verdict: 'fail', detail: 'sort click did not change row order: initial=' + JSON.stringify(initialIds) };
        }
        if (JSON.stringify(sortedIds) !== JSON.stringify(apiIds)) {
          return { verdict: 'fail', detail: 'rendered order ' + JSON.stringify(sortedIds) + ' does not match server sort ' + JSON.stringify(apiIds) };
        }
        return { verdict: 'pass', detail: 'initial=' + JSON.stringify(initialIds) + ' sorted=' + JSON.stringify(sortedIds) };
      },
    },
    {
      id: 'AC-17102-1',
      severity: 'block',
      description: 'Filter chrome text search issues q=<value> request and narrows rendered rows',
      run: async ({ browser, fetch, runtimeUrl }) => {
        if (!browser) return { verdict: 'fail', detail: 'no packBrowser wired' };
        await browser.goto(runtimeUrl + '/');
        await browser.type('input#filterInput', 'Alpha', 'filter input');
        await new Promise((resolve) => setTimeout(resolve, 500));
        const names = await browser.evaluate(() =>
          Array.from(document.querySelectorAll('table[role="grid"] tbody tr td:nth-child(3)'))
            .map((td) => td.textContent.trim()));
        const apiRes = await fetch(runtimeUrl + '/api/rows?q=Alpha&page=1&pageSize=3');
        const apiPayload = await apiRes.json();
        if (apiPayload.q !== 'Alpha') {
          return { verdict: 'fail', detail: 'server did not read q parameter; payload.q=' + JSON.stringify(apiPayload.q) };
        }
        const expected = apiPayload.rows.map((r) => r.name);
        if (JSON.stringify(names) !== JSON.stringify(expected)) {
          return { verdict: 'fail', detail: 'filter did not narrow rows: rendered=' + JSON.stringify(names) + ' expected=' + JSON.stringify(expected) };
        }
        return { verdict: 'pass', detail: 'filter q=Alpha rendered ' + JSON.stringify(names) };
      },
    },
    {
      id: 'AC-17103-2',
      severity: 'block',
      description: 'Pagination announcement uses an aria-live region reading Page N of M',
      run: async ({ browser, runtimeUrl }) => {
        if (!browser) return { verdict: 'fail', detail: 'no packBrowser wired' };
        await browser.goto(runtimeUrl + '/');
        const initial = await browser.evaluate(() => {
          const live = document.getElementById('paginationLive');
          return { text: live?.textContent ?? '', ariaLive: live?.getAttribute('aria-live') ?? null };
        });
        if (initial.ariaLive !== 'polite') {
          return { verdict: 'fail', detail: 'pagination status region missing aria-live=polite: ' + JSON.stringify(initial) };
        }
        if (!/^Page \d+ of \d+$/.test(initial.text)) {
          return { verdict: 'fail', detail: 'initial pagination text does not match "Page N of M": ' + JSON.stringify(initial.text) };
        }
        await browser.click('button#pageNext', 'next page button');
        await new Promise((resolve) => setTimeout(resolve, 500));
        const next = await browser.evaluate(() => document.getElementById('paginationLive')?.textContent ?? '');
        if (!/^Page 2 of \d+$/.test(next)) {
          return { verdict: 'fail', detail: 'next-page announcement did not update: ' + JSON.stringify(next) };
        }
        return { verdict: 'pass', detail: 'initial=' + JSON.stringify(initial.text) + ' next=' + JSON.stringify(next) };
      },
    },
    {
      id: 'AC-17104-3',
      severity: 'block',
      description: 'Bulk-action confirmation dialog opens as aria-modal and returns focus to the originating row on close',
      run: async ({ browser, runtimeUrl }) => {
        if (!browser) return { verdict: 'fail', detail: 'no packBrowser wired' };
        await browser.goto(runtimeUrl + '/');
        await browser.click('input.rowSelect[data-id="1"]', 'select row 1');
        await browser.click('button#bulkAction', 'bulk action button');
        await new Promise((resolve) => setTimeout(resolve, 300));
        const opened = await browser.evaluate(() => {
          const dialog = document.getElementById('bulkDialog');
          return {
            hidden: dialog?.hidden ?? true,
            role: dialog?.getAttribute('role') ?? null,
            ariaModal: dialog?.getAttribute('aria-modal') ?? null,
            ariaLabelledBy: dialog?.getAttribute('aria-labelledby') ?? null,
            ariaDescribedBy: dialog?.getAttribute('aria-describedby') ?? null,
            focused: document.activeElement?.id ?? null,
          };
        });
        if (opened.hidden || opened.role !== 'dialog' || opened.ariaModal !== 'true') {
          return { verdict: 'fail', detail: 'dialog did not open with role=dialog and aria-modal=true: ' + JSON.stringify(opened) };
        }
        if (!opened.ariaLabelledBy || !opened.ariaDescribedBy) {
          return { verdict: 'fail', detail: 'dialog missing aria-labelledby / aria-describedby: ' + JSON.stringify(opened) };
        }
        if (opened.focused !== 'bulkConfirm') {
          return { verdict: 'fail', detail: 'confirm control did not receive focus on open: ' + JSON.stringify(opened) };
        }
        await browser.click('button#bulkCancel', 'cancel bulk');
        await new Promise((resolve) => setTimeout(resolve, 300));
        const closed = await browser.evaluate(() => ({
          hidden: document.getElementById('bulkDialog')?.hidden ?? false,
          focused: document.activeElement?.getAttribute?.('data-id') ?? document.activeElement?.id ?? null,
          focusedTag: document.activeElement?.tagName ?? null,
          focusedType: document.activeElement?.getAttribute?.('type') ?? null,
        }));
        if (!closed.hidden) {
          return { verdict: 'fail', detail: 'dialog did not close: ' + JSON.stringify(closed) };
        }
        if (closed.focused !== '1' || closed.focusedType !== 'checkbox') {
          return { verdict: 'fail', detail: 'focus did not return to row 1 checkbox: ' + JSON.stringify(closed) };
        }
        return { verdict: 'pass', detail: 'dialog open+close: opened=' + JSON.stringify(opened) + ' closed=' + JSON.stringify(closed) };
      },
    },
    {
      id: 'AC-17105-1',
      severity: 'block',
      description: 'Empty, loading, error and no-results states each render a distinct role=region with aria-live=polite',
      run: async ({ browser, runtimeUrl }) => {
        if (!browser) return { verdict: 'fail', detail: 'no packBrowser wired' };
        const states = [
          { name: 'empty', url: runtimeUrl + '/?state=empty', expectId: 'emptyRegion' },
          { name: 'loading', url: runtimeUrl + '/?state=loading', expectId: 'loadingRegion' },
          { name: 'error', url: runtimeUrl + '/?state=error', expectId: 'errorRegion' },
        ];
        const observed = [];
        for (const state of states) {
          await browser.goto(state.url);
          const info = await browser.evaluate((id) => {
            const el = document.getElementById(id);
            if (!el) return { present: false };
            return {
              present: true,
              role: el.getAttribute('role'),
              ariaLive: el.getAttribute('aria-live'),
            };
          }, state.expectId);
          if (!info.present || info.role !== 'region' || info.ariaLive !== 'polite') {
            return { verdict: 'fail', detail: 'state ' + state.name + ' missing region+aria-live: ' + JSON.stringify(info) };
          }
          observed.push({ state: state.name, info });
        }
        await browser.goto(runtimeUrl + '/?q=ZZZ');
        await new Promise((resolve) => setTimeout(resolve, 400));
        const noResults = await browser.evaluate(() => {
          const el = document.getElementById('noResultsRegion');
          if (!el) return { present: false };
          return {
            present: true,
            hidden: el.hidden,
            role: el.getAttribute('role'),
            ariaLive: el.getAttribute('aria-live'),
          };
        });
        if (!noResults.present || noResults.role !== 'region' || noResults.ariaLive !== 'polite') {
          return { verdict: 'fail', detail: 'no-results region shape wrong: ' + JSON.stringify(noResults) };
        }
        return { verdict: 'pass', detail: 'observed=' + JSON.stringify(observed) + ' noResults=' + JSON.stringify(noResults) };
      },
    },
    {
      id: 'AC-17106-1',
      severity: 'block',
      description: 'Column reorder has a non-drag keyboard-reachable path (WCAG 2.5.7)',
      run: async ({ browser, runtimeUrl }) => {
        if (!browser) return { verdict: 'fail', detail: 'no packBrowser wired' };
        await browser.goto(runtimeUrl + '/');
        const buttons = await browser.evaluate(() =>
          Array.from(document.querySelectorAll('button.columnMove')).map((b) => ({
            column: b.getAttribute('data-column'),
            direction: b.getAttribute('data-direction'),
            ariaLabel: b.getAttribute('aria-label'),
            tag: b.tagName,
          })));
        if (buttons.length === 0) {
          return { verdict: 'fail', detail: 'no keyboard column-move buttons found' };
        }
        const initialOrder = await browser.evaluate(() =>
          Array.from(document.querySelectorAll('table[role="grid"] thead th[data-column]')).map((th) => th.getAttribute('data-column')));
        await browser.click('button.columnMove[data-column="score"][data-direction="left"]', 'move score left');
        await new Promise((resolve) => setTimeout(resolve, 300));
        const afterOrder = await browser.evaluate(() =>
          Array.from(document.querySelectorAll('table[role="grid"] thead th[data-column]')).map((th) => th.getAttribute('data-column')));
        if (JSON.stringify(initialOrder) === JSON.stringify(afterOrder)) {
          return { verdict: 'fail', detail: 'column reorder button did not change header order: ' + JSON.stringify(initialOrder) };
        }
        return { verdict: 'pass', detail: 'initial=' + JSON.stringify(initialOrder) + ' after=' + JSON.stringify(afterOrder) + ' buttons=' + JSON.stringify(buttons.length) };
      },
    },
  ],
};
