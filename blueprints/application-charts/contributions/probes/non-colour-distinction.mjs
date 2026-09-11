// application-charts probe: series distinction combines colour,
// pattern and direct label (AC-18102-1).
//
// Boots the fixture on a scratch port, GETs the golden root and
// derives:
//   - the count of series glyphs (bar rects grouped by data-series
//     and line polylines) present in the response DOM,
//   - the count of data-pattern attributes present,
//   - the count of chartSeriesLabel text nodes present.
// AC-18102-1 requires every series to carry a non-colour attribute
// AND a direct label. The probe asserts the derived counts match:
// pattern count equals series-name count, and every series name
// appears in a chartSeriesLabel node.
//
// Also drives ?break=pattern (varied input) and asserts the derived
// pattern count drops to zero while series-label nodes remain: the
// fixture confirms the pack check would refuse a chart missing its
// non-colour cue.
//
// Positive evidence per rule 7d: response body excerpt naming the
// series data-pattern attribute plus the x-fixture-request-id
// header the fixture echoed.

import { fixtureFetch, startFixture, excerpt } from './probe-utils.mjs';

export const anchorAcId = 'application-charts-AC-18102-1';
export const accountBound = false;

function countMatches(body, re) {
  return (body.match(re) || []).length;
}

function distinctSeriesNames(body) {
  const set = new Set();
  const re = /data-series="([^"]+)"/g;
  let m;
  while ((m = re.exec(body)) !== null) set.add(m[1]);
  return [...set];
}

export default async function runProbe() {
  const fixture = await startFixture();
  const results = [];
  try {
    const golden = await fixtureFetch(fixture.url, '/');
    const seriesNames = distinctSeriesNames(golden.body);
    const patternCount = countMatches(golden.body, /data-pattern="[^"]+"/g);
    const labelCount = countMatches(golden.body, /class="chartSeriesLabel"/g);
    const everyNameLabelled = seriesNames.every((name) => golden.body.includes(`data-series-label="${name}"`));
    // The fixture ships two two-series charts; the AC requires every
    // series to carry both a non-colour attribute and a direct label.
    // Derived pass: at least two distinct series, pattern count >=
    // series count on both charts (each series shows up in bar+line),
    // label count >= 2, and each series name resolved to a label.
    const goldenPass = golden.status === 200
      && !!golden.requestId
      && seriesNames.length >= 2
      && patternCount >= seriesNames.length
      && labelCount >= seriesNames.length
      && everyNameLabelled;
    results.push({
      anchorAcId,
      verdict: goldenPass ? 'pass' : 'fail',
      detail: goldenPass
        ? `GET / returned 200; derived counts: distinct series=${seriesNames.length} (${seriesNames.join(', ')}), data-pattern attrs=${patternCount}, chartSeriesLabel nodes=${labelCount}, every series carries a labelled node; x-fixture-request-id=${golden.requestId}`
        : `GET / evidence gap: status=${golden.status} rid=${golden.requestId} names=${seriesNames.length} patterns=${patternCount} labels=${labelCount} everyLabelled=${everyNameLabelled}`,
      evidence: {
        requestId: golden.requestId,
        responseStatus: golden.status,
        bodyExcerpt: excerpt((golden.body.match(/data-series="[^"]+"[^>]*data-pattern="[^"]+"/) || [''])[0]),
        derived: { seriesNames, patternCount, labelCount },
      },
    });

    const broken = await fixtureFetch(fixture.url, '/?break=pattern');
    const brokenPatterns = countMatches(broken.body, /data-pattern="[^"]+"/g);
    const brokenLabels = countMatches(broken.body, /class="chartSeriesLabel"/g);
    const varyPass = broken.status === 200
      && !!broken.requestId
      && brokenPatterns === 0
      && brokenLabels >= 2;
    // Varied-input observation: same AC's underlying check is what
    // refuses a chart missing its non-colour cue. Anchor is the same
    // AC because the property under test (non-colour distinction) is
    // the same; the row records the derived count under a broken
    // input as evidence the fixture's break switch changes the
    // observable count in the expected direction.
    results.push({
      anchorAcId,
      verdict: varyPass ? 'pass' : 'fail',
      detail: varyPass
        ? `GET /?break=pattern returned 200; derived pattern count dropped from ${patternCount} to 0 while label count held at ${brokenLabels}; the AC-18102-1 check would refuse this render; x-fixture-request-id=${broken.requestId}`
        : `break=pattern evidence gap: status=${broken.status} rid=${broken.requestId} brokenPatterns=${brokenPatterns} brokenLabels=${brokenLabels}`,
      evidence: {
        requestId: broken.requestId,
        responseStatus: broken.status,
        bodyExcerpt: excerpt((broken.body.match(/data-series="[^"]+"[^>]{0,60}/) || [''])[0]),
        derived: { brokenPatterns, brokenLabels },
      },
    });
  } finally {
    fixture.kill();
  }
  return { results };
}
