// Browser-verification invariants (ui-design-gate-0.7.0-spec §8.3).
//
// v1 invariant set is module-encoded (§12 O-6 Decided): the record
// carries free-string invariant names, and adding an invariant is a
// build minor bump with no schema-versioning ceremony. v2 can
// schema-encode once the set stabilises.
//
// Every invariant here is deterministic against a DOM string plus a
// FBS + baseline context. The `agentScreenshotCritique` mode calls
// these against markup the driven browser returned; the operator-
// session mode does not invoke them (the operator's ack is the
// evidence, spec §8.2). Severities are the runtime enforcement:
// `block` refuses at the finalise gate, `warn` requires operator ack,
// `advisory` records the finding without gating.

/**
 * @typedef {'block'|'warn'|'advisory'} InvariantSeverity
 * @typedef {'pass'|'warn'|'fail'} InvariantVerdict
 */

/**
 * @typedef {object} InvariantResult
 * @property {string} invariant
 * @property {InvariantVerdict} verdict
 * @property {string} [detail]
 * @property {InvariantSeverity} severity
 */

/**
 * @typedef {object} InvariantContext
 * @property {string} routePath                  path of the route being checked
 * @property {'light'|'dark'} themeApplied       theme active during capture
 * @property {object} fbs                        the FBS being verified
 * @property {object} [uiBaseline]               the manifest uiBaseline record (defaults + opt-outs)
 * @property {string} dom                        the response HTML for the route
 * @property {boolean} [authenticated]           whether the request carried the auth cookie
 * @property {string} [landedPath]               the pathname the browser's final URL resolved to after any redirect chain; when the driver reports it, `authenticatedLandsOnRequestedPath` compares it against `routePath` (AC-1131-3 landed-path refusal)
 */

const OPT_OUT_FIELDS = new Set([
  'themeMode',
  'sharedLayoutModule',
  'authFlow.htmlLoginPageRequired',
]);

const V1_INVARIANTS = [
  {
    name: 'sharedNavPresent',
    severity: 'block',
    perThemeOnly: false,
    run: checkSharedNavPresent,
  },
  {
    name: 'activeNavMarked',
    severity: 'block',
    perThemeOnly: false,
    run: checkActiveNavMarked,
  },
  {
    name: 'signedInAsAffordance',
    severity: 'block',
    perThemeOnly: false,
    run: checkSignedInAsAffordance,
  },
  {
    name: 'themeToggleVisible',
    severity: 'block',
    perThemeOnly: false,
    run: checkThemeToggleVisible,
  },
  {
    name: 'themeDefaultsToLight',
    severity: 'warn',
    perThemeOnly: true, // only fires on the light-capture without a cookie
    run: checkThemeDefaultsToLight,
  },
  {
    name: 'focusRingsVisible',
    severity: 'warn',
    perThemeOnly: false,
    run: checkFocusRingsVisible,
  },
  {
    name: 'sharedLayoutModule',
    severity: 'block',
    perThemeOnly: false,
    run: checkSharedLayoutStructural,
  },
  {
    name: 'noInlineStyleBlocks',
    severity: 'block',
    perThemeOnly: false,
    run: checkNoInlineStyleBlocks,
  },
  {
    name: 'authenticatedLandsOnRequestedPath',
    severity: 'block',
    perThemeOnly: false,
    run: checkAuthenticatedLandsOnRequestedPath,
  },
];

/** Versioned constant, module-encoded per §12 O-6. */
export const UI_INVARIANTS_V1 = Object.freeze(V1_INVARIANTS.map((i) => Object.freeze({ name: i.name, severity: i.severity })));

/**
 * Run the v1 invariant set against a single (route × theme × DOM)
 * capture. Returns one result per invariant.
 *
 * @param {InvariantContext} ctx
 * @returns {InvariantResult[]}
 */
export function runInvariantsForCapture(ctx) {
  /** @type {InvariantResult[]} */
  const results = [];
  for (const inv of V1_INVARIANTS) {
    // `themeDefaultsToLight` only makes sense on the "no cookie, first
    // load" light capture; other invariants fire per capture.
    if (inv.perThemeOnly && ctx.themeApplied !== 'light') continue;
    const raw = inv.run(ctx);
    const detail = raw?.detail;
    /** @type {InvariantVerdict} */
    const verdict = raw?.verdict ?? 'pass';
    const result = { invariant: inv.name, verdict, severity: inv.severity };
    if (detail) result.detail = detail;
    // Baseline opt-outs demote block -> advisory (per spec §6.3: the
    // operator ruling wins). Only opt-outs registered for fields that
    // map to invariant enforcement.
    if (verdict !== 'pass' && isOptedOut(inv.name, ctx.uiBaseline)) {
      result.severity = 'advisory';
      result.detail = (detail ? detail + ' ' : '') + '(opt-out recorded on uiBaseline)';
    }
    results.push(result);
  }
  return results;
}

/**
 * Aggregate one route's results into a `browserVerificationInvariantCheck[]`
 * array as it lands on the record (spec §3.3). One entry per invariant,
 * with the per-route + per-theme details flattened into the detail
 * string when the invariant ran per capture.
 *
 * @param {Array<{ routePath: string, themeApplied: 'light'|'dark', results: InvariantResult[] }>} perCapture
 * @returns {Array<{ invariant: string, verdict: InvariantVerdict, detail?: string, severity: InvariantSeverity }>}
 */
export function foldInvariantsForRecord(perCapture) {
  /** @type {Map<string, { invariant: string, verdict: InvariantVerdict, severity: InvariantSeverity, details: string[] }>} */
  const byName = new Map();
  for (const cap of perCapture) {
    for (const r of cap.results) {
      const cursor = byName.get(r.invariant) ?? { invariant: r.invariant, verdict: 'pass', severity: r.severity, details: [] };
      cursor.verdict = worstOf(cursor.verdict, r.verdict);
      cursor.severity = mostSevere(cursor.severity, r.severity);
      if (r.verdict !== 'pass' && r.detail) {
        cursor.details.push(`${cap.routePath}[${cap.themeApplied}]: ${r.detail}`);
      }
      byName.set(r.invariant, cursor);
    }
  }
  const out = [];
  for (const cursor of byName.values()) {
    const entry = { invariant: cursor.invariant, verdict: cursor.verdict, severity: cursor.severity };
    if (cursor.details.length > 0) entry.detail = cursor.details.join(' | ');
    out.push(entry);
  }
  return out;
}

function worstOf(a, b) {
  const order = { pass: 0, warn: 1, fail: 2 };
  return (order[b] > order[a]) ? b : a;
}
function mostSevere(a, b) {
  const order = { advisory: 0, warn: 1, block: 2 };
  return (order[b] > order[a]) ? b : a;
}

function isOptedOut(invariantName, baseline) {
  const optOuts = Array.isArray(baseline?.operatorOptOuts) ? baseline.operatorOptOuts : [];
  if (invariantName === 'themeDefaultsToLight' && optOuts.some((o) => OPT_OUT_FIELDS.has(o.field) && o.field === 'themeMode')) return true;
  if (invariantName === 'sharedNavPresent' && optOuts.some((o) => o.field === 'sharedLayoutModule')) return true;
  if (invariantName === 'sharedLayoutModule' && optOuts.some((o) => o.field === 'sharedLayoutModule')) return true;
  return false;
}

// ---------- individual checks (each returns { verdict, detail? }) ----------

function checkSharedNavPresent(ctx) {
  const routes = ctx.fbs?.designStage?.navModel?.routes ?? [];
  const authRoutes = routes.filter((r) => r.authRequired);
  if (authRoutes.length === 0) return { verdict: 'pass' };
  if (!/<nav\b/i.test(ctx.dom)) {
    return { verdict: 'fail', detail: 'no <nav> element in the response HTML for an authenticated route' };
  }
  // Every enumerated route must appear as <a href="..."> OR (for the
  // current route) as a non-anchor stand-in - either the same path in
  // a <span>/<a> without href, or a labelled non-anchor. v1 heuristic:
  // pass when path shows up somewhere inside the <nav>.
  const navMatch = /<nav\b[\s\S]*?<\/nav>/i.exec(ctx.dom);
  const navMarkup = navMatch ? navMatch[0] : '';
  const missing = [];
  for (const r of routes) {
    const patternPath = escapeForRegExp(r.path);
    const patternLabel = escapeForRegExp(r.label);
    const found = new RegExp(`href=["']${patternPath}["']`, 'i').test(navMarkup)
      || new RegExp(`>${patternLabel}<`, 'i').test(navMarkup);
    if (!found) missing.push(r.path);
  }
  if (missing.length > 0) {
    return { verdict: 'fail', detail: `<nav> missing enumerated route(s): ${missing.join(', ')}` };
  }
  return { verdict: 'pass' };
}

function checkActiveNavMarked(ctx) {
  const routes = ctx.fbs?.designStage?.navModel?.routes ?? [];
  const authRoutes = routes.filter((r) => r.authRequired);
  if (authRoutes.length === 0) return { verdict: 'pass' };
  if (!/aria-current=["']page["']/i.test(ctx.dom)) {
    return { verdict: 'fail', detail: 'no element carries aria-current="page" (active-nav marker missing)' };
  }
  // We do NOT verify that the aria-current landed on the CURRENT
  // route's link (that would require request-to-route mapping in the
  // driver; v1 keeps this cheap and delegates that mapping to the
  // agent-critique rubric).
  return { verdict: 'pass' };
}

function checkSignedInAsAffordance(ctx) {
  const affordance = ctx.fbs?.designStage?.navModel?.signedInAsAffordance;
  if (affordance !== true) return { verdict: 'pass' };
  if (ctx.authenticated === false) return { verdict: 'pass' };
  const hasText = /signed[\s-]in as|logged[\s-]in as/i.test(ctx.dom);
  const hasLogout = /href=["'][^"']*\/logout["']/i.test(ctx.dom);
  if (hasText || hasLogout) return { verdict: 'pass' };
  return { verdict: 'fail', detail: 'no signed-in-as text and no /logout link visible on an authenticated route' };
}

function checkThemeToggleVisible(ctx) {
  // Widened recognition set per N7 (spec §8.3): any of (a)
  // [data-theme-toggle], (b) id/class matching /theme-toggle|toggle-theme/i,
  // (c) accessible name containing "theme" (aria-label / aria-labelledby /
  // inner text).
  if (/data-theme-toggle/i.test(ctx.dom)) return { verdict: 'pass' };
  if (/(?:id|class)=["'][^"']*(?:theme[\s-]?toggle|toggle[\s-]?theme)[^"']*["']/i.test(ctx.dom)) return { verdict: 'pass' };
  if (/aria-label=["'][^"']*theme[^"']*["']/i.test(ctx.dom)) return { verdict: 'pass' };
  // Inner-text heuristic: an element whose direct inner text contains
  // "theme" (case-insensitive). Cheap without a real DOM parser.
  if (/>[^<]*theme[^<]*</i.test(ctx.dom)) return { verdict: 'pass' };
  return { verdict: 'fail', detail: 'no theme toggle detectable in the response HTML' };
}

function checkThemeDefaultsToLight(ctx) {
  // Only meaningful on the "no cookie" first load. The runner is
  // expected to fire this against a light capture with no cookie; here
  // we just check the served theme attribute matches.
  const match = /<html\b[^>]*data-theme=["']([^"']+)["']/i.exec(ctx.dom);
  const served = match?.[1] ?? null;
  const expected = ctx.uiBaseline?.defaults?.themeMode === 'dark-default-with-toggle' ? 'dark'
    : ctx.uiBaseline?.defaults?.themeMode === 'single-theme-declared' ? null
      : 'light';
  if (expected === null) return { verdict: 'pass' };
  if (served === expected) return { verdict: 'pass' };
  return { verdict: 'fail', detail: `<html data-theme> served '${served ?? '(unset)'}' but the baseline expects '${expected}' on a first-load without a theme cookie` };
}

function checkFocusRingsVisible(ctx) {
  // Cheap chain-shaped heuristic: the response HTML either mentions a
  // focus style inline OR links a same-origin stylesheet where the
  // rule can live (per the styled-under-shipped-CSP baseline: no
  // inline <style>, ship rules via <link rel="stylesheet">). The real
  // check happens agent-side against a tab-focused screenshot; v1
  // records `warn` when the heuristic is inconclusive so operators
  // know to eyeball. spec §8.3 severity `warn`.
  if (/focus-visible|focus-ring|outline\s*:/i.test(ctx.dom)) return { verdict: 'pass' };
  if (/<link\b[^>]*rel=["']?stylesheet\b/i.test(ctx.dom)) return { verdict: 'pass' };
  return { verdict: 'warn', detail: 'no focus-ring style detected in the response HTML and no <link rel="stylesheet"> reference (visually confirm agent-side)' };
}

function checkSharedLayoutStructural(ctx) {
  // The record-shape reduction: pass on the individual capture; the
  // structural cross-route compare lives at the fold stage
  // (`compareTopLevelStructure` below) and is called from the runner.
  return { verdict: 'pass' };
}

/**
 * Compare top-level element sequences across multiple captured DOMs.
 * Returns a `sharedLayoutModule` invariant result to append to the
 * record when the sequences differ meaningfully (§8.3).
 *
 * @param {Array<{ routePath: string, dom: string }>} captures
 * @param {object} [baseline]
 * @returns {InvariantResult}
 */
export function compareTopLevelStructure(captures, baseline) {
  const auth = captures.filter((c) => c.dom);
  if (auth.length < 2) {
    return { invariant: 'sharedLayoutModule', verdict: 'pass', severity: 'block' };
  }
  const structures = auth.map((c) => topLevelChildTagSequence(c.dom));
  const [reference, ...rest] = structures;
  const mismatched = [];
  for (let i = 0; i < rest.length; i += 1) {
    if (!arraysEqual(rest[i], reference)) mismatched.push(auth[i + 1].routePath);
  }
  const severity = isOptedOut('sharedLayoutModule', baseline) ? 'advisory' : 'block';
  if (mismatched.length === 0) return { invariant: 'sharedLayoutModule', verdict: 'pass', severity };
  return {
    invariant: 'sharedLayoutModule',
    verdict: 'fail',
    detail: `top-level DOM structure diverges between ${auth[0].routePath} and ${mismatched.join(', ')} (spec §8.3 structural check)`,
    severity,
  };
}

/**
 * The captured DOM MUST NOT carry an inline <style> block. A <style>
 * block requires the shipping CSP to allow style-src 'unsafe-inline';
 * a project that ships one either weakens the CSP baseline (a security
 * regression) or renders unstyled at deploy (the watchpost run4 class
 * defect this invariant refuses). Stylesheets must be served from
 * same-origin routes and referenced via <link rel="stylesheet"> so
 * style-src 'self' remains sufficient.
 */
function checkNoInlineStyleBlocks(ctx) {
  const dom = typeof ctx.dom === 'string' ? ctx.dom : '';
  if (!/<style\b/i.test(dom)) return { verdict: 'pass' };
  return {
    verdict: 'fail',
    detail: 'inline <style> block present in the rendered HTML; ship style-src \'unsafe-inline\' would be required for it to render (watchpost run4 class defect, w-2026-08-24-003). Serve the stylesheet from a same-origin route and reference it via <link rel="stylesheet">.',
  };
}

/**
 * AC-1131-3 landed-path refusal: when the driver reports the browser's
 * final URL path after any redirect chain resolves, and the request was
 * for an authenticated route, the landed path MUST equal the requested
 * route path. Cures the class of harness where a broken session lane
 * silently caused every authenticated-route assertion to run against a
 * styled /login (Playwright's page.goto follows redirects by default,
 * so the resolved response is 200 from the redirect target and the
 * downstream styled/CSP assertions pass against the wrong surface).
 * Watchpost partial-acceptance w-2026-08-24-003 / AC-1601-14; ported
 * into the SPA blueprint TAC-209 v1.0.1.
 *
 * The invariant is opt-in: when the driver does NOT populate
 * `ctx.landedPath` the invariant passes (older drivers keep working).
 * Once the SPA-blueprint drivers report `landedPath` this becomes a
 * hard block-severity refusal.
 */
function checkAuthenticatedLandsOnRequestedPath(ctx) {
  if (typeof ctx.landedPath !== 'string' || ctx.landedPath.length === 0) return { verdict: 'pass' };
  if (ctx.authenticated === false) return { verdict: 'pass' };
  const routes = ctx.fbs?.designStage?.navModel?.routes ?? [];
  const routeSpec = routes.find((r) => r.path === ctx.routePath);
  // If the FBS enumerates the route and marks it authRequired=false, the
  // landed-path refusal does not fire (a public route is allowed to
  // redirect to any other public surface by design).
  if (routeSpec && routeSpec.authRequired === false && ctx.authenticated !== true) return { verdict: 'pass' };
  if (ctx.landedPath === ctx.routePath) return { verdict: 'pass' };
  return {
    verdict: 'fail',
    detail: `authenticated navigation landed on '${ctx.landedPath}' (requested '${ctx.routePath}'); a silent redirect chain to another surface (e.g. a session-broken 302 to /login) validated the redirect target's styled state instead of the requested route (AC-1131-3 pathMismatch; watchpost AC-1601-14, w-2026-08-24-003).`,
  };
}

function topLevelChildTagSequence(dom) {
  // Extract the tag-name sequence of direct children of <body>. Cheap
  // regex-based; deliberately conservative (misses nested body-siblings
  // in unusual documents but catches the two-shells watchpost pattern).
  const bodyMatch = /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(dom);
  const source = bodyMatch ? bodyMatch[1] : dom;
  const tags = [];
  const re = /<([a-zA-Z][a-zA-Z0-9-]*)\b/g;
  let m;
  let depth = 0;
  let index = 0;
  while ((m = re.exec(source)) !== null) {
    if (depth === 0 && index === m.index) tags.push(m[1].toLowerCase());
    // Depth tracking is imprecise for self-closing tags; the check
    // exists as a coarse divergence signal, not a formal parser.
    if (source[m.index + 1] !== '/') depth += 1;
    // Advance index heuristically to next top-level opening.
    const closeIdx = source.indexOf(`</${m[1]}>`, m.index);
    if (closeIdx < 0) break;
    depth = Math.max(0, depth - 1);
    index = closeIdx + `</${m[1]}>`.length;
    re.lastIndex = index;
  }
  return tags;
}

function arraysEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

function escapeForRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
