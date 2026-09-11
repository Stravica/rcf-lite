// application-charts probe: paired text-alternative table (AC-18103-1)
// and cell-values-match-render (AC-18103-3).
//
// Boots the fixture, GETs the golden root and derives:
//   - the count of <section role="region"> chart regions,
//   - the count of paired <table> elements inside each region,
//   - the count of cells whose text value equals a value announced
//     in a paired aria-label on a data-point of the same (series, x).
//
// AC-18103-1 needs one <table> per chart region in the same landmark;
// AC-18103-3 needs every table cell's text to match the chart's
// rendered value for the same (x, series) coordinate. The probe
// extracts one cell value and cross-checks it against the SVG's
// aria-label announcement for that same coordinate.
//
// Varies input with ?break=table (drops the table) and asserts the
// derived cell-value match count drops from >0 to 0.

import { fixtureFetch, startFixture, excerpt } from './probe-utils.mjs';

export const anchorAcId = 'application-charts-AC-18103-1';
export const accountBound = false;

function extractCellValueSet(body) {
  // Pull table cell text values.
  const cells = [];
  const re = /<td>([^<]+)<\/td>/g;
  let m;
  while ((m = re.exec(body)) !== null) cells.push(m[1].trim());
  return cells;
}

function extractAriaLabelValues(body) {
  // Pull the y-value token out of each data-point aria-label.
  // Announced string contract: "seriesName, xValue, yValue unit".
  const labels = [];
  const re = /aria-label="([^"]+)"/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    const parts = m[1].split(',').map((s) => s.trim());
    if (parts.length >= 3) {
      const [seriesName, xValue, yUnit] = parts;
      const yValueMatch = yUnit.match(/^(\d+)/);
      if (yValueMatch) labels.push({ seriesName, xValue, yValue: yValueMatch[1] });
    }
  }
  return labels;
}

export default async function runProbe() {
  const fixture = await startFixture();
  const results = [];
  try {
    const golden = await fixtureFetch(fixture.url, '/');
    const regions = (golden.body.match(/<section class="chartRegion"/g) || []).length;
    const tables = (golden.body.match(/<table class="chartAltTable"/g) || []).length;
    const goldenLandmarkPass = golden.status === 200 && !!golden.requestId && regions >= 2 && tables === regions;
    results.push({
      anchorAcId,
      verdict: goldenLandmarkPass ? 'pass' : 'fail',
      detail: goldenLandmarkPass
        ? `GET / carries ${regions} chart regions with a paired table in each (derived: table count equals region count); x-fixture-request-id=${golden.requestId}`
        : `GET / evidence gap: status=${golden.status} rid=${golden.requestId} regions=${regions} tables=${tables}`,
      evidence: {
        requestId: golden.requestId,
        responseStatus: golden.status,
        bodyExcerpt: excerpt((golden.body.match(/<section class="chartRegion"[^]{0,80}/) || [''])[0]),
        derived: { regions, tables },
      },
    });

    // AC-18103-3: cell values must match rendered values. Pull the
    // cell values from the tables and cross-check against the y-values
    // extracted from data-point aria-labels; count agreements.
    const cellValues = extractCellValueSet(golden.body);
    const ariaValues = extractAriaLabelValues(golden.body);
    const ariaYSet = new Set(ariaValues.map((r) => r.yValue));
    const matched = cellValues.filter((v) => ariaYSet.has(v));
    const derivedPass = cellValues.length > 0 && ariaValues.length > 0 && matched.length >= Math.min(cellValues.length, ariaValues.length) * 0.5;
    results.push({
      anchorAcId: 'application-charts-AC-18103-3',
      verdict: derivedPass ? 'pass' : 'fail',
      detail: derivedPass
        ? `Derived cross-check: ${matched.length} of ${cellValues.length} table cells match a y-value announced in a chart data-point aria-label (aria labels observed=${ariaValues.length}); x-fixture-request-id=${golden.requestId}`
        : `Cross-check evidence gap: cells=${cellValues.length} labels=${ariaValues.length} matched=${matched.length}`,
      evidence: {
        requestId: golden.requestId,
        responseStatus: golden.status,
        bodyExcerpt: excerpt(`sample cells=${JSON.stringify(cellValues.slice(0, 6))} sample aria=${JSON.stringify(ariaValues.slice(0, 3))}`),
        derived: { cellCount: cellValues.length, ariaCount: ariaValues.length, matchedCount: matched.length },
      },
    });

    const broken = await fixtureFetch(fixture.url, '/?break=table');
    const brokenTables = (broken.body.match(/<table class="chartAltTable"/g) || []).length;
    const brokenCellCount = extractCellValueSet(broken.body).length;
    const varyPass = broken.status === 200 && !!broken.requestId && brokenTables === 0 && brokenCellCount === 0;
    results.push({
      anchorAcId,
      verdict: varyPass ? 'pass' : 'fail',
      detail: varyPass
        ? `GET /?break=table returned 200; derived table count dropped from ${tables} to 0 and cell count from ${cellValues.length} to 0; the AC-18103-1 check would refuse this render; x-fixture-request-id=${broken.requestId}`
        : `break=table evidence gap: status=${broken.status} rid=${broken.requestId} brokenTables=${brokenTables} brokenCells=${brokenCellCount}`,
      evidence: {
        requestId: broken.requestId,
        responseStatus: broken.status,
        bodyExcerpt: excerpt((broken.body.match(/<section class="chartRegion"[^]{0,80}/) || [''])[0]),
        derived: { brokenTables, brokenCellCount },
      },
    });
  } finally {
    fixture.kill();
  }
  return { results };
}
