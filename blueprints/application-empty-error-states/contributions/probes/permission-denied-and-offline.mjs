// application-empty-error-states probe: permission-denied
// (AC-22104-1) and offline reconnect live-region (AC-22105-1).

import { fixtureFetch, startFixture, excerpt } from './probe-utils.mjs';

export const anchorAcId = 'application-empty-error-states-AC-22104-1';
export const accountBound = false;

export default async function runProbe() {
  const fixture = await startFixture();
  const results = [];
  try {
    const pd = await fixtureFetch(fixture.url, '/probe/permission-denied');
    const region = /data-surface="permission-denied"[^>]*role="region"/.test(pd.body);
    const causeMatch = pd.body.match(/<span data-cause>([^<]+)<\/span>/);
    const causeText = causeMatch ? causeMatch[1] : '';
    // AC requires a class-level cause string with no digits-run of
    // 4+. Derive: cause text length > 0 and no /\d{4,}/ in it.
    const causeShape = causeText.length > 0 && !/\d{4,}/.test(causeText);
    const action = /data-action="request-access"/.test(pd.body);
    const causeClass = /data-cause-class="scope-missing"/.test(pd.body);
    const pass = pd.status === 403 && !!pd.requestId && region && causeShape && action && causeClass;
    results.push({
      anchorAcId,
      verdict: pass ? 'pass' : 'fail',
      detail: pass
        ? `GET /probe/permission-denied returned 403 with role="region", class-level cause "${causeText}" (no 4+ digit run), request-access control, and data-cause-class="scope-missing"; x-fixture-request-id=${pd.requestId}`
        : `permission-denied evidence gap: status=${pd.status} rid=${pd.requestId} region=${region} cause="${causeText}" causeShape=${causeShape} action=${action} causeClass=${causeClass}`,
      evidence: {
        requestId: pd.requestId,
        responseStatus: pd.status,
        bodyExcerpt: excerpt((pd.body.match(/data-surface="permission-denied"[^]{0,220}/) || [''])[0]),
        derived: { region, causeText, causeShape, action, causeClass },
      },
    });

    // AC-22105-1 offline + reconnect live-region.
    const offline = await fixtureFetch(fixture.url, '/probe/offline');
    const offlineRegion = /data-surface="offline"[^>]*role="region"/.test(offline.body);
    const offlineBanner = /data-banner="offline"/.test(offline.body);
    const bufferedWrite = /window\.__offlineBuffer/.test(offline.body);
    const offlinePass = offline.status === 200 && !!offline.requestId && offlineRegion && offlineBanner && bufferedWrite;
    results.push({
      anchorAcId: 'application-empty-error-states-AC-22105-1',
      verdict: offlinePass ? 'pass' : 'fail',
      detail: offlinePass
        ? `GET /probe/offline returned 200 with role="region", data-banner="offline" and a pre-seeded window.__offlineBuffer for the reconnect flush; x-fixture-request-id=${offline.requestId}`
        : `offline evidence gap: status=${offline.status} rid=${offline.requestId} region=${offlineRegion} banner=${offlineBanner} buffer=${bufferedWrite}`,
      evidence: {
        requestId: offline.requestId,
        responseStatus: offline.status,
        bodyExcerpt: excerpt((offline.body.match(/data-banner="offline"[^]{0,200}/) || [''])[0]),
        derived: { offlineRegion, offlineBanner, bufferedWrite },
      },
    });

    const reconnect = await fixtureFetch(fixture.url, '/probe/offline?reconnect=1');
    const liveMatch = reconnect.body.match(/<div data-live-region="polite"[^>]*>([^<]+)<\/div>/);
    const liveText = liveMatch ? liveMatch[1] : '';
    const bufferSizeInText = /Flushing\s+(\d+)\s+buffered/.exec(liveText);
    const derivedBufferSize = bufferSizeInText ? Number(bufferSizeInText[1]) : NaN;
    const rcPass = reconnect.status === 200 && !!reconnect.requestId && derivedBufferSize === 1;
    results.push({
      anchorAcId: 'application-empty-error-states-AC-22105-1',
      verdict: rcPass ? 'pass' : 'fail',
      detail: rcPass
        ? `GET /probe/offline?reconnect=1 returned 200; derived polite live-region announcement "${liveText}" carries buffered-write count ${derivedBufferSize} (matches the fixture's pre-seed count); x-fixture-request-id=${reconnect.requestId}`
        : `reconnect evidence gap: status=${reconnect.status} rid=${reconnect.requestId} liveText="${liveText}" bufferSize=${derivedBufferSize}`,
      evidence: {
        requestId: reconnect.requestId,
        responseStatus: reconnect.status,
        bodyExcerpt: excerpt(liveText),
        derived: { liveText, derivedBufferSize },
      },
    });
  } finally {
    fixture.kill();
  }
  return { results };
}
