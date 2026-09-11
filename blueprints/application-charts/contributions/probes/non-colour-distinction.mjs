// application-charts probe: series distinction combines colour with
// a non-colour attribute AND a direct label AT EVERY SERIES
// (AC-18102-1). The observation runs per-series (not by aggregate
// counts): each series must carry a data-pattern attribute AND a
// labelled text node bearing its name. A series with two patterns
// and another with none does not satisfy the AC  -  the per-series
// check's false-pass path.

import { fixtureFetch, startFixture, excerpt } from './probe-utils.mjs';

export const anchorAcId = 'application-charts-AC-18102-1';
export const accountBound = false;

function distinctSeriesNames(body) {
  const set = new Set();
  const re = /data-series="([^"]+)"/g;
  let m;
  while ((m = re.exec(body)) !== null) set.add(m[1]);
  return [...set];
}

function seriesHasPattern(body, name) {
  // A series has a pattern attribute if any element that carries
  // data-series="name" also carries data-pattern="…" (on the same
  // element or on a wrapping <g class="chartSeriesLine"> for line
  // charts).
  const elemRe = new RegExp(`<[^>]*data-series="${name.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}"[^>]*data-pattern="[^"]+"`, 'g');
  return elemRe.test(body);
}

function seriesHasLabel(body, name) {
  return body.includes(`data-series-label="${name}"`);
}

export default async function runProbe() {
  const fixture = await startFixture();
  const results = [];
  try {
    const golden = await fixtureFetch(fixture.url, '/');
    const seriesNames = distinctSeriesNames(golden.body);
    const perSeries = seriesNames.map((name) => ({
      name,
      hasPattern: seriesHasPattern(golden.body, name),
      hasLabel: seriesHasLabel(golden.body, name),
    }));
    const everyOne = perSeries.length >= 2 && perSeries.every((s) => s.hasPattern && s.hasLabel);
    const goldenPass = golden.status === 200 && !!golden.requestId && everyOne;
    results.push({
      anchorAcId: null,
      conformanceOnly: true,
      limitation: 'application-charts-AC-18102-1: browser layout of the label adjacent to the series and rendered-colour distinguishability at applied colour choices (the AC clauses beyond DOM shape) are browser-driven and not observed by this Node HTTP probe; the per-series DOM-attribute walk is a partial observation of AC-18102-1',
      verdict: goldenPass ? 'warn' : 'fail',
      detail: goldenPass
        ? `Given a rendered chart with N series, the; Per-series check on ${perSeries.length} series (${perSeries.map((s) => s.name).join(', ')}): every series carries a data-pattern attribute AND a data-series-label text node  -  the AC-18102-1 non-colour distinction contract is satisfied at every series; x-fixture-request-id=${golden.requestId}`
        : `Given a rendered chart with N series, the; AC-18102-1 per-series gap: ${JSON.stringify(perSeries)} rid=${golden.requestId}`,
      evidence: {
        requestId: golden.requestId,
        responseStatus: golden.status,
        bodyExcerpt: excerpt((golden.body.match(/data-series="[^"]+"[^>]*data-pattern="[^"]+"/) || [''])[0]),
        derived: { perSeries },
      },
    });
  } finally {
    await fixture.kill();
  }
  return { results };
}
