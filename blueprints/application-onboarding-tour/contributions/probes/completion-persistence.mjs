// application-onboarding-tour probe: completion state persists per
// principal in the elicited store (AC-26104-1). Server-side
// observable: the fixture emits a STORE constant on the client
// script derived from ?store; the write-completion write path and
// the marker element are also emitted in the script.

import { fixtureFetch, startFixture, excerpt } from './probe-utils.mjs';

export const anchorAcId = 'application-onboarding-tour-AC-26104-1';
export const accountBound = false;

function parseStore(body) {
  const m = body.match(/var STORE = "([^"]+)";/);
  return m ? m[1] : null;
}

export default async function runProbe() {
  const fixture = await startFixture();
  const results = [];
  try {
    for (const store of ['spa-local-storage', 'spa-session-storage']) {
      const r = await fixtureFetch(fixture.url, `/tour?store=${encodeURIComponent(store)}`);
      const derivedStore = parseStore(r.body);
      const writePath = /function writeCompletion\(record\)/.test(r.body);
      const markerLogic = /data-role="onboarding-tour-completion-marker"/.test(r.body);
      const pass = r.status === 200 && !!r.requestId
        && derivedStore === store && writePath && markerLogic;
      results.push({
        anchorAcId,
        verdict: pass ? 'pass' : 'fail',
        detail: pass
          ? `GET /tour?store=${store}: client script's STORE constant is "${derivedStore}" (reflects the varied elicit input); writeCompletion() path and completion-marker element are present in the script for the persistence write; x-fixture-request-id=${r.requestId}`
          : `store=${store} evidence gap: status=${r.status} rid=${r.requestId} derived=${derivedStore} writePath=${writePath} marker=${markerLogic}`,
        evidence: {
          requestId: r.requestId,
          responseStatus: r.status,
          bodyExcerpt: excerpt((r.body.match(/var STORE = "[^"]+";/) || [''])[0]),
          derived: { store, derivedStore, writePath, markerLogic },
        },
      });
    }

    const broken = await fixtureFetch(fixture.url, '/tour?break=no-persist');
    const brokenScript = broken.body.match(/if \(BREAK === 'no-persist'\) return;/);
    const brokenBreak = /var BREAK = "no-persist";/.test(broken.body);
    const varyPass = broken.status === 200 && !!broken.requestId && !!brokenScript && brokenBreak;
    results.push({
      anchorAcId,
      verdict: varyPass ? 'pass' : 'fail',
      detail: varyPass
        ? `GET /tour?break=no-persist: client script's BREAK constant is "no-persist" and writeCompletion() early-returns before writing; the AC-26104-1 persistence check would refuse; x-fixture-request-id=${broken.requestId}`
        : `no-persist evidence gap: status=${broken.status} rid=${broken.requestId} brokenBreak=${brokenBreak} guardPresent=${!!brokenScript}`,
      evidence: {
        requestId: broken.requestId,
        responseStatus: broken.status,
        bodyExcerpt: excerpt((broken.body.match(/if \(BREAK === 'no-persist'\) return;[^]{0,60}/) || [''])[0]),
        derived: { brokenBreak, guardPresent: !!brokenScript },
      },
    });
  } finally {
    fixture.kill();
  }
  return { results };
}
