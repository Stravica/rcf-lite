// application-charts probe: paired text-alternative table lives in
// the chart's landmark (AC-18103-1) and every cell matches the
// chart's rendered value for the same (x, series) coordinate to the
// same precision (AC-18103-3).
//
// The probe extracts the (series, x, value) tuple from every SVG
// data-point element (data-series/data-x/data-y on
// .chartDataPoint) as the render's own source of truth, then walks
// the paired <table> and confirms every cell holds the same numeric
// text at the same (x, series) coordinate. A single mismatch or a
// missing coordinate fails the row (AC-18103-3 wording: "every
// cell's text value matches the chart's rendered value for the same
// (x, series) coordinate to the same precision the chart renders;
// a mismatched or missing cell fails the pack check").

import { fixtureFetch, startFixture, excerpt } from './probe-utils.mjs';

export const anchorAcId = 'application-charts-AC-18103-1';
export const accountBound = false;

function parseChartRegions(body) {
  // Each <section class="chartRegion"> holds one SVG and (unless
  // broken) one <table class="chartAltTable"> in the same landmark.
  const regions = [];
  const regionRe = /<section class="chartRegion"[^>]*>([\s\S]*?)<\/section>/g;
  let m;
  while ((m = regionRe.exec(body)) !== null) regions.push(m[1]);
  return regions;
}

function extractRenderedPoints(regionHtml) {
  // The SVG data-points are the render's source of truth. Each
  // element carries data-series="<name>" data-x="<xLabel>"
  // data-y="<numeric value>". Return a Map keyed as "series|x".
  const points = new Map();
  const dpRe = /class="chartDataPoint"[^>]*data-series="([^"]+)"[^>]*data-x="([^"]+)"[^>]*data-y="([^"]+)"/g;
  let m;
  while ((m = dpRe.exec(regionHtml)) !== null) {
    points.set(`${m[1]}|${m[2]}`, m[3]);
  }
  return points;
}

function extractTableCells(regionHtml) {
  // Parse <thead><tr><th>Day</th><th>SeriesA (unit)</th>...</tr></thead>
  // <tbody><tr><th>Mon</th><td>30</td>...</tr>...</tbody>
  // and produce a Map keyed as "series|x" to cell text.
  const tableMatch = regionHtml.match(/<table class="chartAltTable"[\s\S]*?<\/table>/);
  if (!tableMatch) return null;
  const table = tableMatch[0];
  const headers = [...table.matchAll(/<th scope="col">([^<]+)<\/th>/g)].map((h) => h[1]);
  // Column 0 is the row heading (e.g. "Day"); subsequent columns are
  // series columns like "Prod (requests)". Strip the trailing unit
  // in parens to isolate the series name.
  const seriesCols = headers.slice(1).map((h) => h.replace(/\s*\(.*\)\s*$/, '').trim());
  const rows = [...table.matchAll(/<tr>([\s\S]*?)<\/tr>/g)];
  const cells = new Map();
  for (const [_, rowInner] of rows) {
    const rowHead = rowInner.match(/<th scope="row">([^<]+)<\/th>/);
    if (!rowHead) continue;
    const xLabel = rowHead[1];
    const tdMatches = [...rowInner.matchAll(/<td>([^<]*)<\/td>/g)].map((c) => c[1]);
    tdMatches.forEach((cellText, i) => {
      const series = seriesCols[i];
      if (series) cells.set(`${series}|${xLabel}`, cellText.trim());
    });
  }
  return cells;
}

export default async function runProbe() {
  const fixture = await startFixture();
  const results = [];
  try {
    const golden = await fixtureFetch(fixture.url, '/');
    const regions = parseChartRegions(golden.body);
    const landmarkPass = golden.status === 200 && !!golden.requestId
      && regions.length >= 2
      && regions.every((r) => /<table class="chartAltTable"/.test(r));
    results.push({
      anchorAcId: null,
      conformanceOnly: true,
      limitation: 'application-charts-AC-18103-1: browser focus movement onto the paired table and assistive-tech traversal (the AC clauses beyond DOM shape) are browser-driven and not observed by this Node HTTP probe; the DOM landmark walk is a partial observation of AC-18103-1',
      verdict: landmarkPass ? 'warn' : 'fail',
      detail: landmarkPass
        ? `Given a rendered chart, a \`<table>\` element carrying; GET / carries ${regions.length} <section class="chartRegion" role="region"> landmarks; every landmark holds one <table class="chartAltTable"> as AC-18103-1 requires ("a <table> element carrying the same data lives in the same landmark"); x-fixture-request-id=${golden.requestId}`
        : `Given a rendered chart, a \`<table>\` element carrying; landmark evidence gap: status=${golden.status} rid=${golden.requestId} regions=${regions.length}`,
      evidence: {
        requestId: golden.requestId,
        responseStatus: golden.status,
        bodyExcerpt: excerpt((golden.body.match(/<section class="chartRegion"[^]{0,140}/) || [''])[0]),
        derived: { regionCount: regions.length, tablesPerRegion: regions.map((r) => (r.match(/<table class="chartAltTable"/g) || []).length) },
      },
    });

    // AC-18103-3: every cell matches the (series, x) coordinate.
    const perRegion = [];
    let allMatch = true;
    let totalCoords = 0;
    let mismatches = [];
    for (let ri = 0; ri < regions.length; ri += 1) {
      const rendered = extractRenderedPoints(regions[ri]);
      const cells = extractTableCells(regions[ri]);
      if (!cells) { allMatch = false; mismatches.push({ region: ri, reason: 'no table' }); continue; }
      for (const [key, renderedValue] of rendered) {
        totalCoords += 1;
        const cellText = cells.get(key);
        if (cellText === undefined) { allMatch = false; mismatches.push({ region: ri, key, renderedValue, cellText: null }); continue; }
        // Same-precision comparison: the render emits the raw numeric
        // token in data-y, the table emits the same text; compare as
        // strings so a 30 vs 30.0 divergence is a fail.
        if (cellText !== renderedValue) { allMatch = false; mismatches.push({ region: ri, key, renderedValue, cellText }); }
      }
      // Also refuse extra table cells the chart has no coordinate
      // for (missing chart point / spurious cell): iterate cells.
      for (const [key, cellText] of cells) {
        if (!rendered.has(key)) { allMatch = false; mismatches.push({ region: ri, key, renderedValue: null, cellText }); }
      }
      perRegion.push({ region: ri, coords: rendered.size, tableCells: cells.size });
    }
    const cellPass = golden.status === 200 && !!golden.requestId && totalCoords > 0 && allMatch;
    results.push({
      anchorAcId: 'application-charts-AC-18103-3',
      verdict: cellPass ? 'pass' : 'fail',
      detail: cellPass
        ? `Given a rendered chart, when the pack inspects; Every one of ${totalCoords} rendered (series, x) coordinates matches its paired <td> cell text at the same precision the chart emits (per-region counts: ${JSON.stringify(perRegion)}); a mismatched or missing cell would fail per AC-18103-3; x-fixture-request-id=${golden.requestId}`
        : `Given a rendered chart, when the pack inspects; AC-18103-3 evidence gap: total coords=${totalCoords} mismatches=${JSON.stringify(mismatches.slice(0, 4))}`,
      evidence: {
        requestId: golden.requestId,
        responseStatus: golden.status,
        bodyExcerpt: excerpt(`per-region=${JSON.stringify(perRegion)}`),
        derived: { totalCoords, mismatchCount: mismatches.length, perRegion },
      },
    });
  } finally {
    await fixture.kill();
  }
  return { results };
}
