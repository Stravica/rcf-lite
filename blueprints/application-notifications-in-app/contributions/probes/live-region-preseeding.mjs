// application-notifications-in-app probe: live-region preseeding
// (AC-20101-1). Boots the fixture, GETs the shell root and the two
// nested surfaces (/notifications-centre, /notifications-preferences),
// enumerates elements by the per-element attribute [data-live-region]
// (per AC-20101-1 wording), and observes the polite/assertive semantics
// on each preseeded wrapper.
//
// AC-20101-1 requires BOTH wrappers to be present at page load on
// every declared route, enumerated by [data-live-region]:
//   the polite wrapper carries aria-live="polite" AND
//     data-live-region="polite" AND is empty (no descendant text nodes);
//   the assertive wrapper carries role="alert" AND
//     data-live-region="assertive" AND is empty.
//
// A broken-variant absence row is deliberately not emitted
// (positive-anchor rule: broken-variant rows must not be
// positive-anchored on absence, removed here per the charts pattern).

import { fixtureFetch, startFixture, excerpt } from './probe-utils.mjs';

export const anchorAcId = 'application-notifications-in-app-AC-20101-1';
export const accountBound = false;

// Enumerate every element that carries a data-live-region attribute
// in the served HTML. Returns per-element observed semantics.
function enumerateLiveRegions(body) {
  const rx = /<([a-z][a-z0-9]*)\b([^>]*\bdata-live-region="([^"]+)"[^>]*)>([\s\S]*?)<\/\1>/gi;
  const out = [];
  let m;
  while ((m = rx.exec(body)) !== null) {
    const attrs = m[2];
    const kind = m[3];
    const inner = m[4];
    const ariaLiveMatch = /\baria-live="([^"]+)"/.exec(attrs);
    const roleMatch = /\brole="([^"]+)"/.exec(attrs);
    out.push({
      kind,
      empty: inner.length === 0,
      ariaLive: ariaLiveMatch ? ariaLiveMatch[1] : null,
      role: roleMatch ? roleMatch[1] : null,
    });
  }
  return out;
}

function observePoliteAssertive(elements) {
  const polite = elements.find((e) => e.kind === 'polite') || null;
  const assertive = elements.find((e) => e.kind === 'assertive') || null;
  const politeOk = !!polite && polite.ariaLive === 'polite' && polite.empty === true;
  const assertiveOk = !!assertive && assertive.role === 'alert' && assertive.empty === true;
  return { polite, assertive, politeOk, assertiveOk };
}

export default async function runProbe() {
  const fixture = await startFixture();
  const results = [];
  try {
    const routes = ['/', '/notifications-centre', '/notifications-preferences'];
    for (const route of routes) {
      const r = await fixtureFetch(fixture.url, route);
      const elements = enumerateLiveRegions(r.body);
      const { polite, assertive, politeOk, assertiveOk } = observePoliteAssertive(elements);
      const pass = r.status === 200 && !!r.requestId && politeOk && assertiveOk;
      const politeShape = polite
        ? `ariaLive=${polite.ariaLive} dataLiveRegion=polite empty=${polite.empty}`
        : 'missing';
      const assertiveShape = assertive
        ? `role=${assertive.role} dataLiveRegion=assertive empty=${assertive.empty}`
        : 'missing';
      results.push({
        anchorAcId,
        verdict: pass ? 'pass' : 'fail',
        detail: pass
          ? `Given a page load on any declared route; observed on GET ${route}: enumerated by [data-live-region] found ${elements.length} elements; polite {${politeShape}}; assertive {${assertiveShape}}; x-fixture-request-id=${r.requestId}`
          : `Given a page load on any declared route; evidence gap on GET ${route}: status=${r.status} rid=${r.requestId} polite {${politeShape}} assertive {${assertiveShape}}`,
        evidence: {
          requestId: r.requestId,
          responseStatus: r.status,
          bodyExcerpt: excerpt((r.body.match(/<[^>]+data-live-region="polite"[^>]*>[\s\S]*?<\/[a-z]+>/i) || [''])[0]),
          derived: {
            route,
            elementCount: elements.length,
            polite: polite && { ariaLive: polite.ariaLive, role: polite.role, empty: polite.empty },
            assertive: assertive && { ariaLive: assertive.ariaLive, role: assertive.role, empty: assertive.empty },
          },
        },
      });
    }
  } finally {
    await fixture.kill();
  }
  return { results };
}
