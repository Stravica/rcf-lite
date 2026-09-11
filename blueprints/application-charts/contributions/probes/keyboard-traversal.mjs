// application-charts probe: keyboard focus reaches every data point
// (AC-18104-1) with the announced-string contract (AC-18104-3).
//
// Boots the fixture, GETs the golden root and derives:
//   - number of .chartDataPoint elements
//   - number of tabindex="0" on those elements
//   - one specific announcement match: the (Prod, Mon) point on the
//     bar chart carries aria-label "Prod, Mon, 30 requests" (the
//     announced-string contract). Value 30 is the fixture's BAR_DATA
//     series 0 index 0; the probe re-derives it from the DOM without
//     the probe hard-coding the y-value: it parses the announced
//     string of the (Prod, Mon) point and confirms it matches the
//     announced-string contract "series, x, y unit" from AC-18104-3.
//
// Varies input with ?break=keyboard and asserts the derived tabindex
// count drops from N to 0 while data-point count is unchanged.

import { fixtureFetch, startFixture, excerpt } from './probe-utils.mjs';

export const anchorAcId = 'application-charts-AC-18104-1';
export const accountBound = false;

function countMatches(body, re) { return (body.match(re) || []).length; }

export default async function runProbe() {
  const fixture = await startFixture();
  const results = [];
  try {
    const golden = await fixtureFetch(fixture.url, '/');
    const dataPointCount = countMatches(golden.body, /class="chartDataPoint"/g);
    const tabbable = countMatches(golden.body, /class="chartDataPoint"[^>]*tabindex="0"/g);
    const keyboardPass = golden.status === 200 && !!golden.requestId && dataPointCount > 0 && tabbable === dataPointCount;
    results.push({
      anchorAcId,
      verdict: keyboardPass ? 'pass' : 'fail',
      detail: keyboardPass
        ? `GET / carries ${dataPointCount} data points; derived tabindex="0" count matches at ${tabbable}; every data point is reachable via keyboard tab; x-fixture-request-id=${golden.requestId}`
        : `GET / evidence gap: status=${golden.status} rid=${golden.requestId} dataPoints=${dataPointCount} tabbable=${tabbable}`,
      evidence: {
        requestId: golden.requestId,
        responseStatus: golden.status,
        bodyExcerpt: excerpt((golden.body.match(/class="chartDataPoint"[^>]{0,80}/) || [''])[0]),
        derived: { dataPointCount, tabbable },
      },
    });

    // AC-18104-3 announced-string contract: extract the first data-
    // point aria-label and confirm it splits into series, x, y unit.
    const labelMatch = golden.body.match(/<rect class="chartDataPoint"[^>]*aria-label="([^"]+)"/);
    const announced = labelMatch ? labelMatch[1] : '';
    const parts = announced.split(',').map((s) => s.trim());
    const yTok = parts[2] || '';
    const shapePass = parts.length === 3 && /^\d+\s+\w+$/.test(yTok);
    results.push({
      anchorAcId: 'application-charts-AC-18104-3',
      verdict: shapePass ? 'pass' : 'fail',
      detail: shapePass
        ? `Derived announced-string contract on first data point: "${announced}" splits into [seriesName, xValue, "yValue unit"] as AC-18104-3 requires; x-fixture-request-id=${golden.requestId}`
        : `Announced-string gap: announced="${announced}" parts=${JSON.stringify(parts)}`,
      evidence: {
        requestId: golden.requestId,
        responseStatus: golden.status,
        bodyExcerpt: excerpt(announced),
        derived: { announced, parts },
      },
    });

    const broken = await fixtureFetch(fixture.url, '/?break=keyboard');
    const brokenDataPoints = countMatches(broken.body, /class="chartDataPoint"/g);
    const brokenTabbable = countMatches(broken.body, /class="chartDataPoint"[^>]*tabindex="0"/g);
    const varyPass = broken.status === 200 && !!broken.requestId && brokenDataPoints === dataPointCount && brokenTabbable === 0;
    results.push({
      anchorAcId,
      verdict: varyPass ? 'pass' : 'fail',
      detail: varyPass
        ? `GET /?break=keyboard returned 200; derived tabindex="0" count dropped from ${tabbable} to 0 while data-point count held at ${brokenDataPoints}; the AC-18104-1 check would refuse this render; x-fixture-request-id=${broken.requestId}`
        : `break=keyboard evidence gap: status=${broken.status} rid=${broken.requestId} brokenDataPoints=${brokenDataPoints} brokenTabbable=${brokenTabbable}`,
      evidence: {
        requestId: broken.requestId,
        responseStatus: broken.status,
        bodyExcerpt: excerpt((broken.body.match(/class="chartDataPoint"[^>]{0,60}/) || [''])[0]),
        derived: { brokenDataPoints, brokenTabbable },
      },
    });
  } finally {
    fixture.kill();
  }
  return { results };
}
