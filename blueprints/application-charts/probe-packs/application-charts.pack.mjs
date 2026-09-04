// application-charts probe pack (v1.0.0).
//
// Three runtime-observable checks anchored to the blueprint's ACs:
//   AC-18102-1 non-colour distinction (colour plus pattern plus direct label)
//   AC-18103-1 text-alternative table in the same landmark, cell-per-value
//   AC-18104-1 keyboard traversal contract with reduced-motion suppression
//
// Every check drives the real Playwright browser the T-0 runner
// injects (packages/rcf-lite/src/browser-verify/pack-browser.js) and
// asserts on the DOM the applying project renders under the render
// shell (TAC-1901) and the keyboard traversal contract (TAC-1902).
//
// The runner has no vision-deficiency emulation seam today, so
// AC-18102-1 is proven at the DOM level: every series carries a
// non-colour cue (a `data-pattern` attribute, an SVG `pattern` fill
// reference, a `stroke-dasharray`, or a marker shape) AND a direct
// label at the series. When `emulateVisionDeficiency` reaches the
// pack seam in a future runner minor, this pack will add a
// deuteranopia render pass and lift the DOM-level cue rule; see the
// README's known-mechanism-reach-gaps section.

export default {
  packName: 'application-charts',
  version: '1.0.0',
  blueprintSlug: 'application-charts',
  // Applies to any FBS that realises the chart render-shell TAC or
  // whose navModel routes match an operator-configured chart-route
  // glob. The source references BOTH `tacIds` and `route` so the
  // T-0 loader's applicability source-scan sees the two legal seams.
  appliesTo: ({ fbs }) => {
    const routes = fbs?.designStage?.navModel?.routes ?? [];
    const tacIds = fbs?.contextRequirements?.tacIds ?? [];
    if (tacIds.includes('TAC-1901-application-charts-render-shell')) return true;
    return routes.some((r) => typeof r?.path === 'string' && /chart|charts|dashboard/.test(r.path));
  },
  boot: { bootCommand: null, waitForUrl: null, waitForSelector: null },
  checks: [
    {
      id: 'AC-18102-1',
      severity: 'block',
      description: 'Non-colour distinction: every series carries a non-colour cue (data-pattern, stroke-dasharray, hatched fill or marker) plus a direct label at the series',
      run: async ({ browser, runtimeUrl }) => {
        if (!browser) return { verdict: 'fail', detail: 'no packBrowser wired' };
        await browser.goto(runtimeUrl + '/');
        const seriesShape = await browser.evaluate(() => {
          const svgs = Array.from(document.querySelectorAll('svg.chartSvg'));
          const seriesReports = [];
          svgs.forEach((svg) => {
            const chartForm = svg.getAttribute('data-chart-form');
            const seriesGroups = Array.from(svg.querySelectorAll('[data-series]'));
            const seenSeries = new Set();
            seriesGroups.forEach((el) => {
              const name = el.getAttribute('data-series');
              if (seenSeries.has(name)) return;
              seenSeries.add(name);
              const hasDataPattern = el.hasAttribute('data-pattern');
              const hasDash = el.hasAttribute('stroke-dasharray') || (el.querySelector && el.querySelector('polyline[stroke-dasharray]')) ? true : false;
              const fillRef = (el.getAttribute('fill') || '').startsWith('url(');
              const nonColourCue = hasDataPattern || hasDash || fillRef;
              const labelEl = svg.querySelector('[data-series-label="' + name + '"]');
              const hasDirectLabel = Boolean(labelEl && labelEl.textContent && labelEl.textContent.trim() === name);
              seriesReports.push({ chartForm, name, hasDataPattern, hasDash, fillRef, nonColourCue, hasDirectLabel });
            });
          });
          return seriesReports;
        });
        if (!Array.isArray(seriesShape) || seriesShape.length === 0) {
          return { verdict: 'fail', detail: 'no chart series found on the surface' };
        }
        const failing = seriesShape.filter((s) => !(s.nonColourCue && s.hasDirectLabel));
        if (failing.length > 0) {
          return { verdict: 'fail', detail: 'series missing non-colour cue or direct label: ' + JSON.stringify(failing) };
        }
        return { verdict: 'pass', detail: 'series with non-colour cue and direct label: ' + JSON.stringify(seriesShape.map((s) => ({ form: s.chartForm, name: s.name }))) };
      },
    },
    {
      id: 'AC-18103-1',
      severity: 'block',
      description: 'Text-alternative table: every chart landmark contains a table carrying the same values cell-per-value, focus-reachable through a labelled control',
      run: async ({ browser, runtimeUrl }) => {
        if (!browser) return { verdict: 'fail', detail: 'no packBrowser wired' };
        await browser.goto(runtimeUrl + '/');
        const report = await browser.evaluate(() => {
          const regions = Array.from(document.querySelectorAll('section.chartRegion[role="region"]'));
          return regions.map((region) => {
            const svg = region.querySelector('svg.chartSvg');
            const chartForm = svg ? svg.getAttribute('data-chart-form') : null;
            const table = region.querySelector('table.chartAltTable');
            const showBtn = region.querySelector('button.chartShowAltTable');
            let cellCount = 0;
            let seriesCount = 0;
            let xCount = 0;
            const cellValues = [];
            if (table) {
              const headerCells = Array.from(table.querySelectorAll('thead th'));
              seriesCount = Math.max(0, headerCells.length - 1);
              const bodyRows = Array.from(table.querySelectorAll('tbody tr'));
              xCount = bodyRows.length;
              cellCount = bodyRows.reduce((acc, tr) => acc + tr.querySelectorAll('td').length, 0);
              bodyRows.forEach((tr) => {
                Array.from(tr.querySelectorAll('td')).forEach((td) => cellValues.push(Number(td.textContent.trim())));
              });
            }
            const svgValues = svg ? Array.from(svg.querySelectorAll('[data-y]')).map((el) => Number(el.getAttribute('data-y'))) : [];
            const svgSeries = new Set();
            if (svg) Array.from(svg.querySelectorAll('[data-series]')).forEach((el) => svgSeries.add(el.getAttribute('data-series')));
            const valuesMatch = svgValues.length > 0 && svgValues.every((v) => cellValues.includes(v));
            return {
              chartForm,
              hasTable: Boolean(table),
              cellCount,
              seriesCount,
              xCount,
              showButtonPresent: Boolean(showBtn),
              valuesMatch,
              seriesCountSvg: svgSeries.size,
            };
          });
        });
        if (!Array.isArray(report) || report.length === 0) {
          return { verdict: 'fail', detail: 'no chart regions found on the surface' };
        }
        const missingTable = report.filter((r) => !r.hasTable);
        if (missingTable.length > 0) {
          return { verdict: 'fail', detail: 'chart regions missing paired table: ' + JSON.stringify(missingTable.map((r) => r.chartForm)) };
        }
        const missingButton = report.filter((r) => !r.showButtonPresent);
        if (missingButton.length > 0) {
          return { verdict: 'fail', detail: 'chart regions missing show-table control: ' + JSON.stringify(missingButton.map((r) => r.chartForm)) };
        }
        const mismatched = report.filter((r) => r.hasTable && r.cellCount !== r.seriesCount * r.xCount);
        if (mismatched.length > 0) {
          return { verdict: 'fail', detail: 'chart tables do not honour cell-per-value: ' + JSON.stringify(mismatched) };
        }
        const valueMisses = report.filter((r) => r.hasTable && !r.valuesMatch);
        if (valueMisses.length > 0) {
          return { verdict: 'fail', detail: 'chart tables carry values that do not match the SVG data-y attributes: ' + JSON.stringify(valueMisses) };
        }
        return { verdict: 'pass', detail: 'chart regions with paired tables: ' + JSON.stringify(report.map((r) => ({ form: r.chartForm, rows: r.xCount, cols: r.seriesCount }))) };
      },
    },
    {
      id: 'AC-18104-1',
      severity: 'block',
      description: 'Keyboard traversal: every data point is tab-focusable, the announced string matches "series, x, y unit", and prefers-reduced-motion suppresses transitions',
      run: async ({ browser, runtimeUrl }) => {
        if (!browser) return { verdict: 'fail', detail: 'no packBrowser wired' };
        await browser.goto(runtimeUrl + '/');
        const report = await browser.evaluate(() => {
          const dataPoints = Array.from(document.querySelectorAll('.chartDataPoint'));
          const focusable = dataPoints.filter((el) => el.getAttribute('tabindex') === '0');
          const labelled = focusable.filter((el) => {
            const label = el.getAttribute('aria-label');
            if (!label) return false;
            return /^[^,]+, [^,]+, [^ ]+ [^ ]+$/.test(label);
          });
          const sample = focusable.slice(0, 3).map((el) => ({
            series: el.getAttribute('data-series'),
            x: el.getAttribute('data-x'),
            y: el.getAttribute('data-y'),
            ariaLabel: el.getAttribute('aria-label'),
          }));
          const styles = Array.from(document.querySelectorAll('style')).map((s) => s.textContent).join('\n');
          const hasReducedMotionRule = /@media\s*\(\s*prefers-reduced-motion:\s*reduce\s*\)/.test(styles) &&
            /(transition-duration:\s*0|transition:\s*none|animation-duration:\s*0|animation:\s*none)/i.test(styles);
          return {
            totalDataPoints: dataPoints.length,
            focusableCount: focusable.length,
            labelledCount: labelled.length,
            sample,
            hasReducedMotionRule,
          };
        });
        if (!report || report.totalDataPoints === 0) {
          return { verdict: 'fail', detail: 'no data points found on the surface' };
        }
        if (report.focusableCount !== report.totalDataPoints) {
          return { verdict: 'fail', detail: 'not every data point is focusable: total=' + report.totalDataPoints + ' focusable=' + report.focusableCount };
        }
        if (report.labelledCount !== report.focusableCount) {
          return { verdict: 'fail', detail: 'aria-label format does not match "series, x, y unit" on every focusable data point: sample=' + JSON.stringify(report.sample) };
        }
        if (!report.hasReducedMotionRule) {
          return { verdict: 'fail', detail: 'no prefers-reduced-motion rule suppressing transitions found in the rendered CSS' };
        }
        return { verdict: 'pass', detail: 'focusable data points=' + report.focusableCount + ' sample=' + JSON.stringify(report.sample.slice(0, 1)) + ' reduced-motion rule present' };
      },
    },
  ],
};
