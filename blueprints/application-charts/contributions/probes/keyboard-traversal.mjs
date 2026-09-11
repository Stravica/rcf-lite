// application-charts probe: keyboard focus reaches every data point
// in the required reading order (AC-18104-1) and the announced
// string carries series name, x-value, y-value and unit
// (AC-18104-3).
//
// AC-18104-1 wording: "keyboard focus reaches each data point in
// reading order (left-to-right, top-to-bottom for single-series;
// series-by-series for multi-series)". The probe walks the DOM in
// source order to construct the Tab sequence a browser would follow,
// then asserts:
//   - every .chartDataPoint is tabbable (tabindex="0")
//   - the source-order walk groups points series-by-series for the
//     multi-series charts (all Prod x-values, then all Staging
//     x-values, and so on)
//   - the reduced-motion CSS rule zeros the transition duration
// The Tab sequence a browser follows on a static SVG document IS
// source-order across focusable elements when no tabindex reorders
// them, so a source-order walk faithfully represents the observed
// order.

import { fixtureFetch, startFixture, excerpt } from './probe-utils.mjs';

export const anchorAcId = 'application-charts-AC-18104-1';
export const accountBound = false;

function walkFocusOrder(body) {
  // Enumerate focusable data-point elements in DOM source order.
  // Emits { series, x, y, tag } tuples.
  const order = [];
  const re = /<(rect|circle) class="chartDataPoint"[^>]*data-series="([^"]+)"[^>]*data-x="([^"]+)"[^>]*data-y="([^"]+)"[^>]*tabindex="0"[^>]*aria-label="([^"]+)"/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    order.push({ tag: m[1], series: m[2], x: m[3], y: m[4], label: m[5] });
  }
  return order;
}

function isSeriesByX(order) {
  // Split by chart form (rect=bar, circle=line) so the two charts on
  // one page do not blur into one sequence, then confirm that within
  // each chart the walk emits all points of series A before any
  // points of series B (series-by-series in x order).
  const byForm = { rect: [], circle: [] };
  for (const p of order) byForm[p.tag].push(p);
  for (const list of Object.values(byForm)) {
    if (list.length === 0) continue;
    // Group by series in encounter order.
    const seenSeries = [];
    for (const p of list) if (!seenSeries.includes(p.series)) seenSeries.push(p.series);
    // Assert each series appears in one contiguous block.
    let idx = 0;
    for (const s of seenSeries) {
      while (idx < list.length && list[idx].series === s) idx += 1;
      // Any later element with the same series would mean interleave.
      for (let j = idx; j < list.length; j += 1) {
        if (list[j].series === s) return { ok: false, seenSeries, interleaveAt: j, list };
      }
    }
  }
  return { ok: true, byForm };
}

function announcedShape(label) {
  // "seriesName, xValue, yValue unit"  -  three parts, third part
  // "<number> <unit>".
  const parts = label.split(',').map((s) => s.trim());
  if (parts.length !== 3) return { ok: false, parts };
  const [seriesName, xValue, yUnit] = parts;
  const yUnitMatch = yUnit.match(/^(-?\d+(?:\.\d+)?)(\s+)(\S+)$/);
  if (!yUnitMatch) return { ok: false, parts };
  return { ok: true, seriesName, xValue, yValue: yUnitMatch[1], unit: yUnitMatch[3] };
}

export default async function runProbe() {
  const fixture = await startFixture();
  const results = [];
  try {
    const golden = await fixtureFetch(fixture.url, '/');
    const order = walkFocusOrder(golden.body);
    const totalDataPoints = (golden.body.match(/class="chartDataPoint"/g) || []).length;
    const traversal = isSeriesByX(order);
    const reducedMotion = /@media \(prefers-reduced-motion: reduce\)[^}]*\{[^}]*transition-duration:\s*0s[^}]*\}/.test(golden.body);
    const reachedAll = order.length === totalDataPoints;
    const shapeObserved = golden.status === 200 && !!golden.requestId
      && reachedAll && traversal.ok && reducedMotion && totalDataPoints > 0;
    // Conformance-only: DOM source-order walk of focusable data-point
    // elements is a partial observation of AC-18104-1; the AC's
    // authoritative property (browser Tab focus movement) requires a
    // running browser and is not observed here. Null anchor per rule
    // 11; limitation names the shipped AC and the browser-only clause.
    results.push({
      anchorAcId: null,
      conformanceOnly: true,
      verdict: shapeObserved ? 'warn' : 'fail',
      limitation: 'application-charts-AC-18104-1: browser Tab focus sequence is not observed by this Node HTTP probe; the DOM source-order walk is a proxy for Tab order (true when no tabindex reorders focusable elements) but not a browser-observed focus movement',
      detail: shapeObserved
        ? `Given an interactive chart (data points are clickable): DOM source-order walk of focusable [.chartDataPoint tabindex=0] elements returned ${order.length}/${totalDataPoints} points, grouped series-by-series per chart (${JSON.stringify(traversal.byForm && Object.fromEntries(Object.entries(traversal.byForm).map(([f, l]) => [f, [...new Set(l.map((p) => p.series))].join(' then ')])))}); reduced-motion rule zeros transition-duration on the surface; conformance-only observation of the DOM-shape half of AC-18104-1; x-fixture-request-id=${golden.requestId}`
        : `Given an interactive chart (data points are clickable) gap: focusable=${order.length}/${totalDataPoints} seriesOrderOk=${traversal.ok} reducedMotion=${reducedMotion} rid=${golden.requestId}`,
      evidence: {
        requestId: golden.requestId,
        responseStatus: golden.status,
        bodyExcerpt: excerpt(JSON.stringify(order.slice(0, 4))),
        derived: {
          focusableCount: order.length,
          totalDataPoints,
          seriesOrderOk: traversal.ok,
          reducedMotion,
          firstFive: order.slice(0, 5).map((p) => ({ series: p.series, x: p.x, tag: p.tag })),
        },
      },
    });

    // AC-18104-3 announced-string contract on every focusable point.
    let allShapesOk = true;
    let firstBad = null;
    for (const p of order) {
      const s = announcedShape(p.label);
      if (!s.ok) { allShapesOk = false; firstBad = { label: p.label, parts: s.parts }; break; }
      // Series/x/y must match the DOM data attributes on the same
      // element (announced string is derived from the point's own
      // series/x/y and unit, per AC-18104-3).
      if (s.seriesName !== p.series || s.xValue !== p.x || s.yValue !== p.y) {
        allShapesOk = false; firstBad = { label: p.label, expectedSeries: p.series, expectedX: p.x, expectedY: p.y, parsed: s }; break;
      }
    }
    const shapePass = order.length > 0 && allShapesOk;
    // AC-18104-3 is a derived-value contract on the announced string
    // format ("seriesName, xValue, yValue unit"). The aria-label
    // attribute IS server-observable, so this row keeps the AC anchor;
    // the ORAL announcement (assistive-tech reads the label aloud) is
    // browser + AT territory and not asserted here.
    results.push({
      anchorAcId: 'application-charts-AC-18104-3',
      conformanceOnly: true,
      limitation: 'application-charts-AC-18104-3: this row observes the aria-label token derivation on every focusable data point server-side, a partial observation of AC-18104-3; the AC also requires that on keyboard focus the derived string is announced by assistive tech - the browser focus event and the AT announcement are browser-driven and not observed by this Node HTTP probe',
      verdict: shapePass ? 'warn' : 'fail',
      detail: shapePass
        ? `Given an interactive chart, when the keyboard focus; Every one of ${order.length} focusable data points renders an aria-label of the form "<seriesName>, <xValue>, <yValue> <unit>" where each token matches the point's own data-series / data-x / data-y attributes (derived-output check); x-fixture-request-id=${golden.requestId}`
        : `Given an interactive chart, when the keyboard focus; AC-18104-3 gap: firstBad=${JSON.stringify(firstBad)}`,
      evidence: {
        requestId: golden.requestId,
        responseStatus: golden.status,
        bodyExcerpt: excerpt(order[0] ? order[0].label : ''),
        derived: { checkedLabels: order.length, firstBad },
      },
    });
  } finally {
    await fixture.kill();
  }
  return { results };
}
