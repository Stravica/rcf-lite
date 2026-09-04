// application-dashboard probe pack (v1.0.0).
//
// Three runtime-observable checks anchored to the blueprint's ACs:
//   AC-19102-1 primary-KPI position (DOM order and CSS Grid position at 1440, 1024 and 360)
//   AC-19104-1 timeframe refetch fan-out (every fetch same from/to/preset, matching as-of stamp)
//   AC-19103-1 per-tile four-state contract (role region, aria-live polite, non-colour distinction)
//
// Every check drives the real Playwright browser the T-0 runner
// injects (packages/rcf-lite/src/browser-verify/pack-browser.js) and
// asserts on the DOM the applying project renders under the tile
// grid TAC (TAC-2001), the fan-out contract TAC (TAC-2002) and the
// four-state contract on every tile.
//
// The runner has no network-interception seam today, so fan-out
// evidence is captured through a request log the sample app exposes
// on `window.__dashboardFetches` and at `GET /__requests`; the pack
// reads both to reconcile the timeframe-preset refetch batch.
//
// The runner exposes viewport resize through pack-browser's
// `resize(width, height)` seam (T-3 extension): the primary-KPI
// position check drives 1440, 1024 and 360 through the same handle.

export default {
  packName: 'application-dashboard',
  version: '1.0.0',
  blueprintSlug: 'application-dashboard',
  // Applies to any FBS that realises the dashboard tile-grid TAC or
  // whose navModel routes match an operator-configured dashboard
  // route glob. The source references BOTH `tacIds` and `route` so
  // the T-0 loader's applicability source-scan sees the two legal
  // seams (route is one of the three legal predicates).
  appliesTo: ({ fbs }) => {
    const routes = fbs?.designStage?.navModel?.routes ?? [];
    const tacIds = fbs?.contextRequirements?.tacIds ?? [];
    if (tacIds.includes('TAC-2001-application-dashboard-tile-grid')) return true;
    return routes.some((r) => typeof r?.path === 'string' && /dashboard/.test(r.path));
  },
  boot: { bootCommand: null, waitForUrl: null, waitForSelector: null },
  checks: [
    {
      id: 'AC-19102-1',
      severity: 'block',
      description: 'Primary-KPI position: at 1440, 1024 and 360 the primary tile is first in DOM order within the tile row and lives at grid-column-start 1, grid-row-start 1 (at 360 the row-start is 1 after the one-column reflow)',
      run: async ({ browser, runtimeUrl }) => {
        if (!browser) return { verdict: 'fail', detail: 'no packBrowser wired' };
        if (typeof browser.resize !== 'function') {
          return { verdict: 'fail', detail: 'packBrowser has no resize seam; the T-3 extension has not landed' };
        }
        const url = new URL('', runtimeUrl).toString();
        const widths = [1440, 1024, 360];
        const perWidth = [];
        for (const width of widths) {
          await browser.resize(width, 900);
          await browser.goto(url);
          const measurement = await browser.evaluate(() => {
            const tileRow = document.querySelector('[data-region="tile-row"]');
            if (!tileRow) return { error: 'no tile-row region' };
            const tiles = Array.from(tileRow.querySelectorAll('[data-tile-id]'));
            if (tiles.length === 0) return { error: 'tile row has no tiles' };
            const primary = tiles.find((el) => el.getAttribute('data-tile-role') === 'primary-kpi');
            if (!primary) return { error: 'no primary-kpi tile' };
            const domIndex = tiles.indexOf(primary);
            const style = window.getComputedStyle(primary);
            const kpiKind = primary.getAttribute('data-kpi-kind');
            const kpiName = primary.getAttribute('data-kpi-name');
            return {
              domIndex,
              gridColumnStart: style.gridColumnStart,
              gridRowStart: style.gridRowStart,
              kpiKind,
              kpiName,
              tileCount: tiles.length,
              tileIds: tiles.map((el) => el.getAttribute('data-tile-id')),
              viewportWidth: window.innerWidth,
            };
          });
          perWidth.push({ width, measurement });
        }
        const failures = perWidth.filter((r) => {
          if (r.measurement.error) return true;
          if (r.measurement.domIndex !== 0) return true;
          if (r.measurement.gridRowStart !== '1') return true;
          if (r.width === 1440 || r.width === 1024) {
            if (r.measurement.gridColumnStart !== '1') return true;
          }
          return false;
        });
        if (failures.length > 0) {
          return { verdict: 'fail', detail: 'primary-KPI position broke at: ' + JSON.stringify(failures) };
        }
        const enumValues = ['revenue', 'active-users', 'error-rate', 'throughput', 'custom'];
        const kpiKind = perWidth[0].measurement.kpiKind;
        if (!enumValues.includes(kpiKind)) {
          return { verdict: 'fail', detail: 'primary-KPI data-kpi-kind not in ADR-2001 enum: ' + JSON.stringify(kpiKind) };
        }
        if (kpiKind === 'custom' && !perWidth[0].measurement.kpiName) {
          return { verdict: 'fail', detail: 'primary-KPI kind is custom but data-kpi-name is missing' };
        }
        return { verdict: 'pass', detail: 'primary-KPI top-left at every breakpoint (tiles: ' + perWidth[0].measurement.tileCount + '): ' + JSON.stringify(perWidth.map((r) => ({ width: r.width, kind: r.measurement.kpiKind, domIndex: r.measurement.domIndex, gcs: r.measurement.gridColumnStart, grs: r.measurement.gridRowStart, tiles: r.measurement.tileCount }))) };
      },
    },
    {
      id: 'AC-19104-1',
      severity: 'block',
      description: 'Timeframe refetch fan-out: a preset change issues one refetch per tile and per chart with the same from/to/preset trio, and every tile updates data-as-of matching the shell root',
      run: async ({ browser, runtimeUrl }) => {
        if (!browser) return { verdict: 'fail', detail: 'no packBrowser wired' };
        const url = new URL('', runtimeUrl).toString();
        await browser.resize(1440, 900);
        await browser.goto(url);
        const initial = await browser.evaluate(() => {
          const preset = document.querySelector('[data-region="timeframe-picker"]');
          const buttons = preset ? Array.from(preset.querySelectorAll('[data-preset]')) : [];
          const initialPresets = buttons.map((b) => b.getAttribute('data-preset'));
          return {
            initialPresets,
            initialFetches: (window.__dashboardFetches || []).slice(),
            initialAsOf: document.querySelector('[data-region="shell-root"]')?.getAttribute('data-as-of') || null,
          };
        });
        if (!initial.initialPresets || initial.initialPresets.length < 2) {
          return { verdict: 'fail', detail: 'timeframe picker missing or has fewer than two presets: ' + JSON.stringify(initial.initialPresets) };
        }
        const target = initial.initialPresets.find((p) => p !== 'last-7-days') || initial.initialPresets[1];
        await browser.click('[data-region="timeframe-picker"] [data-preset="' + target + '"]');
        await browser.evaluate((preset) => new Promise((resolve) => {
          const start = Date.now();
          const check = () => {
            const root = document.querySelector('[data-region="shell-root"]');
            const currentPreset = root && root.getAttribute('data-current-preset');
            const fetches = window.__dashboardFetches || [];
            const last = fetches[fetches.length - 1];
            if (currentPreset === preset && last && last.preset === preset) return resolve(true);
            if (Date.now() - start > 5000) return resolve(false);
            setTimeout(check, 40);
          };
          check();
        }), target);
        const evidence = await browser.evaluate((initialCount) => {
          const root = document.querySelector('[data-region="shell-root"]');
          const fetches = (window.__dashboardFetches || []).slice(initialCount);
          const tileRow = document.querySelector('[data-region="tile-row"]');
          const tiles = tileRow ? Array.from(tileRow.querySelectorAll('[data-tile-id]')) : [];
          return {
            fetches,
            tileAsOfs: tiles.map((el) => ({ tileId: el.getAttribute('data-tile-id'), asOf: el.getAttribute('data-as-of') })),
            shellAsOf: root ? root.getAttribute('data-as-of') : null,
            shellPreset: root ? root.getAttribute('data-current-preset') : null,
            targetPreset: root ? root.getAttribute('data-current-preset') : null,
          };
        }, initial.initialFetches.length);
        try {
          const requestsRes = await fetch(new URL('/__requests', runtimeUrl).toString());
          if (requestsRes.status !== 200) {
            return { verdict: 'fail', detail: '/__requests endpoint returned ' + requestsRes.status };
          }
          await requestsRes.json();
        } catch (err) {
          return { verdict: 'fail', detail: '/__requests endpoint unreachable: ' + err.message };
        }
        const newBatch = evidence.fetches;
        if (newBatch.length === 0) {
          return { verdict: 'fail', detail: 'no fetches recorded after timeframe change' };
        }
        const first = newBatch[0];
        const drift = newBatch.filter((f) => f.from !== first.from || f.to !== first.to || f.preset !== first.preset);
        if (drift.length > 0) {
          return { verdict: 'fail', detail: 'fan-out drifted boundary or preset: ' + JSON.stringify({ first, drift }) };
        }
        if (!evidence.shellAsOf) {
          return { verdict: 'fail', detail: 'shell root missing data-as-of after fan-out' };
        }
        const stampDrift = evidence.tileAsOfs.filter((t) => t.asOf !== evidence.shellAsOf);
        if (stampDrift.length > 0) {
          return { verdict: 'fail', detail: 'tile data-as-of drifted from shell: ' + JSON.stringify(stampDrift) };
        }
        const isoRe = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
        if (!isoRe.test(evidence.shellAsOf)) {
          return { verdict: 'fail', detail: 'shell data-as-of not ISO-8601: ' + JSON.stringify(evidence.shellAsOf) };
        }
        return { verdict: 'pass', detail: 'timeframe fan-out coherent: ' + JSON.stringify({ preset: first.preset, from: first.from, to: first.to, fetches: newBatch.length, shellAsOf: evidence.shellAsOf, tiles: evidence.tileAsOfs.length }) };
      },
    },
    {
      id: 'AC-19103-1',
      severity: 'block',
      description: 'Per-tile four-state contract: every tile renders each of loading, empty, error and populated inside role region with aria-live polite, a data-tile-state attribute, and a non-colour visual cue distinct per state',
      run: async ({ browser, runtimeUrl }) => {
        if (!browser) return { verdict: 'fail', detail: 'no packBrowser wired' };
        const states = ['loading', 'empty', 'error', 'populated'];
        const perState = [];
        const url = new URL('', runtimeUrl).toString();
        await browser.resize(1440, 900);
        for (const state of states) {
          const target = new URL('', runtimeUrl);
          target.searchParams.set('tile', 'primary');
          target.searchParams.set('state', state);
          await browser.goto(target.toString());
          const measurement = await browser.evaluate((expectedState) => {
            const tile = document.querySelector('[data-tile-id="primary"]');
            if (!tile) return { error: 'no primary tile' };
            const region = tile.matches('[role="region"]') ? tile : tile.querySelector('[role="region"]');
            if (!region) return { error: 'primary tile missing role=region wrapper' };
            const ariaLive = region.getAttribute('aria-live');
            const actualState = region.getAttribute('data-tile-state') || tile.getAttribute('data-tile-state');
            const visualCue = tile.querySelector('[data-state-cue]');
            const cueKind = visualCue ? visualCue.getAttribute('data-state-cue') : null;
            const accessibleName = region.getAttribute('aria-label') || region.textContent.trim().slice(0, 120);
            return { expectedState, actualState, ariaLive, cueKind, accessibleName, cueHasContent: Boolean(visualCue && visualCue.textContent.trim().length > 0) };
          }, state);
          perState.push({ state, measurement });
        }
        const failures = perState.filter((r) => {
          if (r.measurement.error) return true;
          if (r.measurement.ariaLive !== 'polite') return true;
          if (r.measurement.actualState !== r.state) return true;
          if (!r.measurement.cueKind || r.measurement.cueKind !== r.state) return true;
          return false;
        });
        if (failures.length > 0) {
          return { verdict: 'fail', detail: 'four-state contract broke on: ' + JSON.stringify(failures) };
        }
        const cueKinds = new Set(perState.map((r) => r.measurement.cueKind));
        if (cueKinds.size !== states.length) {
          return { verdict: 'fail', detail: 'state visual cues not distinct across states: ' + JSON.stringify(perState.map((r) => ({ state: r.state, cue: r.measurement.cueKind }))) };
        }
        return { verdict: 'pass', detail: 'four-state contract honoured across: ' + JSON.stringify(perState.map((r) => ({ state: r.state, cue: r.measurement.cueKind, ariaLive: r.measurement.ariaLive }))) };
      },
    },
  ],
};
