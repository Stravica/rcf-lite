// application-empty-error-states probe pack (v1.0.0).
//
// Eight surface-observable checks, one per named state, anchored to
// the blueprint's contributed AC ids:
//   AC-22101-1 not-found (heading, parent-surface link, search entry, tab title)
//   AC-22102-1 forbidden (request-access control, no resource-id leak)
//   AC-22103-1 server-error (retry, no stack trace, no path shape, no env-key shape)
//   AC-22104-1 permission-denied (class-level cause, no resource id)
//   AC-22105-1 offline (banner, buffered synthetic write, polite reconnection announcement)
//   AC-22106-1 empty-list (distinct visual wrapper, creation-affordance recovery)
//   AC-22107-1 no-search-results (distinct visual wrapper, echoed query, clear-filters recovery)
//   AC-22108-1 error-boundary (role=alert, retry control, no stack detail)
//
// Every check drives the real Playwright browser the T-0 runner
// injects. URLs are composed by the withUrl(runtimeUrl, path) helper
// per the round 3 T-3 fix train; no bare string concatenation.
//
// Sample-app fixture:
// packages/rcf-lite/test/fixtures/probe-pack-application-empty-error-states/
// Fixture ships one route per state under /probe/<state> plus break
// switches (?break=stack-trace, ?break=leak-id, ?break=no-recovery,
// ?break=no-live-region) so the negative runs can be driven from a
// single boot.

function withUrl(runtimeUrl, path) {
  return new URL(path, runtimeUrl).toString();
}

// Sensitive-pattern list used by AC-22103-1 (server-error surface)
// and by AC-22108-1 (error-boundary surface). Words on this list must
// not appear on the rendered document text in production.
//
// Encoded as an array of {name, re} entries so a failure message can
// cite which pattern matched. Every regexp is anchored on token
// boundaries to reduce false positives on legitimate copy.
const SENSITIVE_PATTERNS = [
  { name: 'backtrace-frame', re: /\bat\s+[A-Za-z_$][\w$.]*\s*\([^)]*:\d+:\d+\)/ },
  { name: 'source-path-absolute', re: /(?:^|[\s"'>])\/(?:usr|opt|home|var|etc|Users|private)\/[\w\-./]+/ },
  { name: 'source-path-relative', re: /(?:^|[\s"'>])\.{1,2}\/[\w\-./]+\.(?:js|mjs|cjs|ts|tsx|jsx)/ },
  { name: 'env-key-assignment', re: /\b[A-Z][A-Z0-9_]{2,}=(?!=)[^\s"']+/ },
  { name: 'process-env-reference', re: /\bprocess\.env\.[A-Z_][A-Z0-9_]*/ },
  { name: 'framework-internal-frame', re: /\b(?:node_modules|webpack-internal|nextjs-internal)\b/ },
];

// Resource-id pattern list for AC-22104-1 (permission-denied cause
// must be class-level, not per-resource).
const RESOURCE_ID_PATTERNS = [
  { name: 'four-plus-digit-run', re: /\b\d{4,}\b/ },
  { name: 'uuid-shape', re: /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/ },
  { name: 'resource-slug-hint', re: /\b(?:resource|id|slug|handle)=[A-Za-z0-9._-]+/i },
];

function firstSensitiveMatch(text, patterns) {
  if (typeof text !== 'string') return null;
  for (const { name, re } of patterns) {
    const m = text.match(re);
    if (m) return { name, match: m[0] };
  }
  return null;
}

export default {
  packName: 'application-empty-error-states',
  version: '1.0.0',
  blueprintSlug: 'application-empty-error-states',
  // Applies to any FBS that realises the state-machine TAC or whose
  // navModel routes name the operator-configured error-shell path.
  // References BOTH `tacIds` AND `route` per the loader source-scan
  // rule (T-0 AC-1701-3, cross-check with authoring standard 8c).
  appliesTo: ({ fbs }) => {
    const routes = fbs?.designStage?.navModel?.routes ?? [];
    const tacIds = fbs?.contextRequirements?.tacIds ?? [];
    if (tacIds.includes('TAC-2301-application-empty-error-states-state-machine')) return true;
    return routes.some((r) => typeof r?.path === 'string' && /\/probe\/(?:not-found|forbidden|server-error|permission-denied|offline|empty-list|search|error-boundary)(\/|$|\?)/.test(r.path));
  },
  boot: { bootCommand: null, waitForUrl: null, waitForSelector: null },
  checks: [
    {
      id: 'AC-22101-1',
      severity: 'block',
      description: 'not-found state renders inside a region with a naming heading, a parent-surface recovery link, a search entry, and a browser tab title matching /^Not found - .+/',
      run: async ({ browser, runtimeUrl }) => {
        if (!browser) return { verdict: 'fail', detail: 'no packBrowser wired' };
        await browser.goto(withUrl(runtimeUrl, '/probe/not-found'));
        const dom = await browser.evaluate(() => {
          const region = document.querySelector('[data-surface="not-found"]');
          if (!region) return { present: false };
          const heading = region.querySelector('h1, h2, [role="heading"]');
          const parent = region.querySelector('[data-recovery="parent-surface"]');
          const search = region.querySelector('[data-recovery="search"]');
          return {
            present: true,
            headingText: heading ? heading.textContent.trim() : null,
            hasParent: !!parent,
            hasSearch: !!search,
            title: document.title,
          };
        });
        if (!dom.present) return { verdict: 'fail', detail: 'not-found region [data-surface="not-found"] not found' };
        if (!dom.headingText) return { verdict: 'fail', detail: 'not-found region missing heading' };
        if (!dom.hasParent) return { verdict: 'fail', detail: 'not-found region missing [data-recovery="parent-surface"]' };
        if (!dom.hasSearch) return { verdict: 'fail', detail: 'not-found region missing [data-recovery="search"]' };
        if (!/^Not found - .+/.test(dom.title)) return { verdict: 'fail', detail: `not-found tab title did not match /^Not found - .+/: ${JSON.stringify(dom.title)}` };
        return { verdict: 'pass', detail: `heading=${JSON.stringify(dom.headingText)} title=${JSON.stringify(dom.title)}` };
      },
    },
    {
      id: 'AC-22102-1',
      severity: 'block',
      description: 'forbidden state renders inside a region with a request-access control and the rendered surface refuses to include a resource id, resource name or path-shape token',
      run: async ({ browser, runtimeUrl }) => {
        if (!browser) return { verdict: 'fail', detail: 'no packBrowser wired' };
        await browser.goto(withUrl(runtimeUrl, '/probe/forbidden'));
        const dom = await browser.evaluate(() => {
          const region = document.querySelector('[data-surface="forbidden"]');
          if (!region) return { present: false };
          const control = region.querySelector('[data-action="request-access"]');
          return { present: true, hasControl: !!control, text: document.body.innerText };
        });
        if (!dom.present) return { verdict: 'fail', detail: 'forbidden region [data-surface="forbidden"] not found' };
        if (!dom.hasControl) return { verdict: 'fail', detail: 'forbidden region missing [data-action="request-access"] control' };
        // positive-marker gate: fixture seeds a known secret in the request context; the surface must render the safe-response marker plus a request-id, and the pack asserts absence of the leaked secret alongside the positive marker.
        const positive = await browser.evaluate(() => {
          const region = document.querySelector('[data-surface="forbidden"]');
          const safe = region.querySelector('[data-safe-response]');
          const rid = region.querySelector('[data-request-id]');
          return {
            hasSafeMarker: !!safe,
            safeText: safe ? safe.textContent.trim() : null,
            requestId: rid ? rid.getAttribute('data-request-id') : null,
          };
        });
        if (!positive.hasSafeMarker) return { verdict: 'fail', detail: 'forbidden region missing positive [data-safe-response] redaction marker' };
        if (!positive.requestId || !/^[A-Za-z0-9._-]+$/.test(positive.requestId)) return { verdict: 'fail', detail: `forbidden region missing valid [data-request-id]: ${JSON.stringify(positive.requestId)}` };
        const leak = firstSensitiveMatch(dom.text, RESOURCE_ID_PATTERNS);
        if (leak) return { verdict: 'fail', detail: `forbidden surface leaked ${leak.name}: ${leak.match}` };
        const path = firstSensitiveMatch(dom.text, SENSITIVE_PATTERNS.filter((p) => p.name.startsWith('source-path')));
        if (path) return { verdict: 'fail', detail: `forbidden surface leaked ${path.name}: ${path.match}` };
        return { verdict: 'pass', detail: `forbidden region carries positive safe-response marker; requestId=${positive.requestId}` };
      },
    },
    {
      id: 'AC-22103-1',
      severity: 'block',
      description: 'server-error state renders in production without a stack trace, without a source path, without an env-key shape and without a framework-internal frame prefix',
      run: async ({ browser, runtimeUrl }) => {
        if (!browser) return { verdict: 'fail', detail: 'no packBrowser wired' };
        await browser.goto(withUrl(runtimeUrl, '/probe/server-error'));
        const dom = await browser.evaluate(() => {
          const region = document.querySelector('[data-surface="server-error"]');
          if (!region) return { present: false };
          const retry = region.querySelector('[data-recovery="retry"]');
          return { present: true, hasRetry: !!retry, text: document.body.innerText };
        });
        if (!dom.present) return { verdict: 'fail', detail: 'server-error region [data-surface="server-error"] not found' };
        if (!dom.hasRetry) return { verdict: 'fail', detail: 'server-error region missing [data-recovery="retry"] control' };
        // positive-marker gate: fixture seeds a known safe-error body; the surface must render the safe-error marker plus a correlation id, and the pack asserts absence of a stack trace alongside the positive marker.
        const positive = await browser.evaluate(() => {
          const region = document.querySelector('[data-surface="server-error"]');
          const safe = region.querySelector('[data-safe-error]');
          const cid = region.querySelector('[data-correlation-id]');
          return {
            hasSafeMarker: !!safe,
            safeText: safe ? safe.textContent.trim() : null,
            correlationId: cid ? cid.getAttribute('data-correlation-id') : null,
          };
        });
        if (!positive.hasSafeMarker) return { verdict: 'fail', detail: 'server-error region missing positive [data-safe-error] body marker' };
        if (!positive.correlationId || !/^[A-Za-z0-9._-]+$/.test(positive.correlationId)) return { verdict: 'fail', detail: `server-error region missing valid [data-correlation-id]: ${JSON.stringify(positive.correlationId)}` };
        const leak = firstSensitiveMatch(dom.text, SENSITIVE_PATTERNS);
        if (leak) return { verdict: 'fail', detail: `server-error surface leaked ${leak.name}: ${leak.match}` };
        return { verdict: 'pass', detail: `server-error region carries positive safe-error marker; correlationId=${positive.correlationId}` };
      },
    },
    {
      id: 'AC-22104-1',
      severity: 'block',
      description: 'permission-denied state renders a class-level cause string and never a resource id',
      run: async ({ browser, runtimeUrl }) => {
        if (!browser) return { verdict: 'fail', detail: 'no packBrowser wired' };
        await browser.goto(withUrl(runtimeUrl, '/probe/permission-denied'));
        const dom = await browser.evaluate(() => {
          const region = document.querySelector('[data-surface="permission-denied"]');
          if (!region) return { present: false };
          const cause = region.querySelector('[data-cause]');
          const control = region.querySelector('[data-action="request-access"]');
          return {
            present: true,
            causeText: cause ? cause.textContent.trim() : null,
            hasControl: !!control,
          };
        });
        if (!dom.present) return { verdict: 'fail', detail: 'permission-denied region [data-surface="permission-denied"] not found' };
        if (!dom.causeText) return { verdict: 'fail', detail: 'permission-denied region missing [data-cause] class-level cause' };
        if (!dom.hasControl) return { verdict: 'fail', detail: 'permission-denied region missing [data-action="request-access"] control' };
        // positive-marker gate: fixture seeds an exact cause-class token; the surface must expose it on [data-cause-class] with a request id, and the pack asserts absence of any resource-id shape alongside the positive marker.
        const positive = await browser.evaluate(() => {
          const region = document.querySelector('[data-surface="permission-denied"]');
          const cls = region.querySelector('[data-cause-class]');
          const rid = region.querySelector('[data-request-id]');
          return {
            causeClass: cls ? cls.getAttribute('data-cause-class') : null,
            requestId: rid ? rid.getAttribute('data-request-id') : null,
          };
        });
        if (!positive.causeClass || !/^[a-z][a-z0-9-]*$/.test(positive.causeClass)) return { verdict: 'fail', detail: `permission-denied region missing valid [data-cause-class] token: ${JSON.stringify(positive.causeClass)}` };
        if (!positive.requestId || !/^[A-Za-z0-9._-]+$/.test(positive.requestId)) return { verdict: 'fail', detail: `permission-denied region missing valid [data-request-id]: ${JSON.stringify(positive.requestId)}` };
        const leak = firstSensitiveMatch(dom.causeText, RESOURCE_ID_PATTERNS);
        if (leak) return { verdict: 'fail', detail: `permission-denied cause leaked ${leak.name}: ${leak.match}` };
        return { verdict: 'pass', detail: `cause-class=${positive.causeClass} requestId=${positive.requestId}` };
      },
    },
    {
      id: 'AC-22105-1',
      severity: 'block',
      description: 'offline state renders with a read-only banner, a synthetic write buffers to window.__offlineBuffer with an idempotency token, and the polite live-region wrapper carries the reconnection announcement',
      run: async ({ browser, runtimeUrl }) => {
        if (!browser) return { verdict: 'fail', detail: 'no packBrowser wired' };
        await browser.goto(withUrl(runtimeUrl, '/probe/offline'));
        const offline = await browser.evaluate(() => {
          const region = document.querySelector('[data-surface="offline"]');
          if (!region) return { present: false };
          const banner = region.querySelector('[data-banner="offline"]');
          // Fixture pre-seeds a synthetic write on page load so the
          // pack can observe the buffer without driving Playwright
          // page.setOffline directly.
          const buf = window.__offlineBuffer;
          const hasBufferEntry = Array.isArray(buf) && buf.length > 0
            && typeof buf[0].idempotencyToken === 'string' && buf[0].idempotencyToken.length > 0
            && typeof buf[0].sequence === 'number';
          return { present: true, hasBanner: !!banner, hasBufferEntry, bufferSample: buf ? buf.slice(0, 1) : null };
        });
        if (!offline.present) return { verdict: 'fail', detail: 'offline region [data-surface="offline"] not found' };
        if (!offline.hasBanner) return { verdict: 'fail', detail: 'offline region missing [data-banner="offline"]' };
        if (!offline.hasBufferEntry) return { verdict: 'fail', detail: `window.__offlineBuffer not populated with a token-and-sequence entry: ${JSON.stringify(offline.bufferSample)}` };
        // Reconnection: drive the fixture's reconnect route, then
        // read the polite live-region wrapper's text.
        await browser.goto(withUrl(runtimeUrl, '/probe/offline?reconnect=1'));
        const reconnect = await browser.evaluate(() => {
          const live = document.querySelector('[data-live-region="polite"]');
          return { text: live ? live.textContent.trim() : null };
        });
        if (!reconnect.text || reconnect.text.length === 0) {
          return { verdict: 'fail', detail: 'polite live-region wrapper empty on reconnect; expected a reconnection announcement' };
        }
        return { verdict: 'pass', detail: `bufferSample=${JSON.stringify(offline.bufferSample)} reconnect=${JSON.stringify(reconnect.text)}` };
      },
    },
    {
      id: 'AC-22106-1',
      severity: 'block',
      description: 'empty-list state renders with a distinct visual wrapper and a creation-affordance recovery control',
      run: async ({ browser, runtimeUrl }) => {
        if (!browser) return { verdict: 'fail', detail: 'no packBrowser wired' };
        await browser.goto(withUrl(runtimeUrl, '/probe/empty-list'));
        const dom = await browser.evaluate(() => {
          const region = document.querySelector('[data-surface="empty-list"]');
          if (!region) return { present: false };
          const wrapper = region.querySelector('[data-visual="empty-list"]');
          const create = region.querySelector('[data-recovery="create"]');
          return { present: true, hasWrapper: !!wrapper, hasCreate: !!create };
        });
        if (!dom.present) return { verdict: 'fail', detail: 'empty-list region [data-surface="empty-list"] not found' };
        if (!dom.hasWrapper) return { verdict: 'fail', detail: 'empty-list region missing [data-visual="empty-list"] wrapper' };
        if (!dom.hasCreate) return { verdict: 'fail', detail: 'empty-list region missing [data-recovery="create"] control' };
        return { verdict: 'pass', detail: 'empty-list wrapper and create control present' };
      },
    },
    {
      id: 'AC-22107-1',
      severity: 'block',
      description: 'no-search-results state renders with a distinct visual wrapper, an echoed query and a clear-filters recovery control',
      run: async ({ browser, runtimeUrl }) => {
        if (!browser) return { verdict: 'fail', detail: 'no packBrowser wired' };
        await browser.goto(withUrl(runtimeUrl, '/probe/search?q=needle'));
        const dom = await browser.evaluate(() => {
          const region = document.querySelector('[data-surface="no-search-results"]');
          if (!region) return { present: false };
          const wrapper = region.querySelector('[data-visual="no-search-results"]');
          const query = region.querySelector('[data-query]');
          const clear = region.querySelector('[data-recovery="clear-filters"]');
          return {
            present: true,
            hasWrapper: !!wrapper,
            queryText: query ? query.textContent.trim() : null,
            hasClear: !!clear,
          };
        });
        if (!dom.present) return { verdict: 'fail', detail: 'no-search-results region [data-surface="no-search-results"] not found' };
        if (!dom.hasWrapper) return { verdict: 'fail', detail: 'no-search-results region missing [data-visual="no-search-results"] wrapper' };
        if (!dom.hasClear) return { verdict: 'fail', detail: 'no-search-results region missing [data-recovery="clear-filters"] control' };
        if (!dom.queryText || !dom.queryText.includes('needle')) {
          return { verdict: 'fail', detail: `no-search-results region did not echo the query verbatim: ${JSON.stringify(dom.queryText)}` };
        }
        return { verdict: 'pass', detail: `queryEcho=${JSON.stringify(dom.queryText)}` };
      },
    },
    {
      id: 'AC-22108-1',
      severity: 'block',
      description: 'error-boundary state renders inside role=alert with a retry recovery hook and no stack detail on the rendered surface',
      run: async ({ browser, runtimeUrl }) => {
        if (!browser) return { verdict: 'fail', detail: 'no packBrowser wired' };
        await browser.goto(withUrl(runtimeUrl, '/probe/error-boundary?crash=1'));
        const dom = await browser.evaluate(() => {
          const region = document.querySelector('[data-surface="error-boundary"]');
          if (!region) return { present: false };
          const role = region.getAttribute('role');
          const retry = region.querySelector('[data-recovery="retry"]');
          return { present: true, role, hasRetry: !!retry, text: document.body.innerText };
        });
        if (!dom.present) return { verdict: 'fail', detail: 'error-boundary region [data-surface="error-boundary"] not found' };
        if (dom.role !== 'alert') return { verdict: 'fail', detail: `error-boundary region role expected "alert", got ${JSON.stringify(dom.role)}` };
        if (!dom.hasRetry) return { verdict: 'fail', detail: 'error-boundary region missing [data-recovery="retry"] control' };
        // positive-marker gate: the boundary must expose a safe error-class token and a correlation id; the pack asserts absence of stack detail alongside the positive markers.
        const positive = await browser.evaluate(() => {
          const region = document.querySelector('[data-surface="error-boundary"]');
          const cls = region.querySelector('[data-error-class]');
          const cid = region.querySelector('[data-correlation-id]');
          return {
            errorClass: cls ? cls.getAttribute('data-error-class') : null,
            correlationId: cid ? cid.getAttribute('data-correlation-id') : null,
          };
        });
        if (!positive.errorClass || !/^[a-z][a-z0-9-]*$/.test(positive.errorClass)) return { verdict: 'fail', detail: `error-boundary region missing valid [data-error-class] token: ${JSON.stringify(positive.errorClass)}` };
        if (!positive.correlationId || !/^[A-Za-z0-9._-]+$/.test(positive.correlationId)) return { verdict: 'fail', detail: `error-boundary region missing valid [data-correlation-id]: ${JSON.stringify(positive.correlationId)}` };
        const leak = firstSensitiveMatch(dom.text, SENSITIVE_PATTERNS);
        if (leak) return { verdict: 'fail', detail: `error-boundary surface leaked ${leak.name}: ${leak.match}` };
        return { verdict: 'pass', detail: `error-boundary carries error-class=${positive.errorClass} correlationId=${positive.correlationId}; no stack detail` };
      },
    },
  ],
};
