// WCAG 2.1 AA contrast audit helpers (US-207, TS-236). Pure static
// analysis of the view stylesheet: parses CSS blocks, resolves the
// `--sv-*` custom-property blocks for the light (`:root`) and dark
// (`:root[data-theme="dark"]`) token sets, enumerates rules that set
// `color` with every reachable background, and computes WCAG relative-
// luminance contrast ratios. The caller (test/view/contrast-aa.test.js)
// asserts the thresholds (>= 4.5:1 text, >= 3:1 large text and non-text
// UI boundaries per WCAG 1.4.3 and 1.4.11).
//
// Deliberately lightweight: no full CSS parser, no cascade resolver,
// no DOM. The audit walks declared pairs in-place (same rule block
// declares `color` and `background[-color]`; state rules merged over
// their base rule first), and for colour-only rules computes the ratio
// against three reachable surfaces (the page canvas `--sv-canvas`, the
// shell surface `--sv-surface` and the raised surface `--sv-raised`),
// asserting the worst case and marking the pair as `approximate`.
// Border and outline colours are paired against the adjacent surface
// at the 3:1 non-text threshold. That matches the US-207 brief: approximate pairs
// are reported, not skipped, and the test asserts the worst-case ratio.
//
// Only the colour tokens the viewer actually uses are resolved; non-
// `--sv-*` custom properties fall through unresolved (test records as
// approximate so a reviewer can rule). Gradients, images and rgba(...)
// over an unknown surface are recorded as approximate too.

const LARGE_TEXT_SELECTOR_HINTS = [
  'h1', 'h2.', 'h2 ', 'h2{', 'h2:', '.hero', 'tab-heading', 'rcf-lookup-heading',
];
const UI_BOUNDARY_SELECTOR_HINTS = [
  'border', 'outline', 'svg', 'icon', 'rcf-search-icon', '.dot', 'mark', 'stroke',
  'rcf-conn-pill', 'ring',
];
// Decorative or non-text-bearing selectors we exclude from the audit:
// they either paint no text that a user ever reads (dot swatches,
// chart surfaces, pure-fill brand marks) or are shared palette fills
// that other rules re-pair with foregrounds.
const DECORATIVE_SELECTOR_HINTS = [
  '.dot', '.app-footer .ver', '::placeholder', '::marker',
];

/**
 * Strip CSS /* ... *\/ comments; stable across the whole file.
 * @param {string} css
 * @returns {string}
 */
export function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/**
 * Walk the CSS top-level and @media blocks and yield `{ selector,
 * declarations, context }` records for every rule block. @media
 * contexts are the media query string; non-media rules carry a null
 * context. This is a brace-balanced walk, not a full parser, which is
 * fine for the single hand-authored stylesheet under test.
 *
 * @param {string} css
 * @returns {Array<{ selectors: string[], decls: Record<string,string>, context: string | null, raw: string }>}
 */
export function extractRules(css) {
  const stripped = stripComments(css);
  const rules = [];
  walkBlock(stripped, 0, stripped.length, null, rules);
  return rules;
}

function walkBlock(src, start, end, context, out) {
  let i = start;
  while (i < end) {
    // skip whitespace
    while (i < end && /\s/.test(src[i])) i += 1;
    if (i >= end) break;
    // find next '{'
    let braceAt = -1;
    let depth = 0;
    let j = i;
    while (j < end) {
      const c = src[j];
      if (c === '{') { braceAt = j; break; }
      if (c === ';' || c === '}') break;
      j += 1;
    }
    if (braceAt === -1) {
      // orphan tokens (empty line, declarations outside a block, etc.)
      i = j + 1;
      continue;
    }
    const prelude = src.slice(i, braceAt).trim();
    // Find matching close.
    let k = braceAt + 1;
    depth = 1;
    while (k < end && depth > 0) {
      const c = src[k];
      if (c === '{') depth += 1;
      else if (c === '}') depth -= 1;
      k += 1;
    }
    const bodyStart = braceAt + 1;
    const bodyEnd = k - 1;
    if (prelude.startsWith('@media')) {
      // recurse into @media block with its context string
      walkBlock(src, bodyStart, bodyEnd, prelude, out);
    } else if (prelude.startsWith('@keyframes') || prelude.startsWith('@supports') || prelude.startsWith('@font-face') || prelude.startsWith('@page') || prelude.startsWith('@property')) {
      // Skip these: keyframe stop frames have selectors like `0%` that
      // don't carry style we audit for pair-wise contrast.
      // @supports should technically recurse but the stylesheet does
      // not use it in a way that affects colour-only rules.
    } else {
      const body = src.slice(bodyStart, bodyEnd);
      const decls = parseDeclarations(body);
      const selectors = splitSelectorList(prelude);
      out.push({ selectors, decls, context, raw: body.trim() });
    }
    i = k;
  }
}

// Split a selector list on top-level commas only, so
// `:where(a, button, input):focus-visible` stays one selector.
function splitSelectorList(prelude) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const c of prelude) {
    if (c === '(' || c === '[') depth += 1;
    else if (c === ')' || c === ']') depth = Math.max(0, depth - 1);
    if (c === ',' && depth === 0) { if (cur.trim()) out.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function parseDeclarations(body) {
  const decls = {};
  // Split by `;` but keep braces balanced (not expected here, but safe).
  const parts = body.split(';');
  for (const part of parts) {
    const t = part.trim();
    if (!t) continue;
    const colonAt = t.indexOf(':');
    if (colonAt === -1) continue;
    const name = t.slice(0, colonAt).trim();
    const value = t.slice(colonAt + 1).trim();
    if (!name || value === undefined) continue;
    decls[name] = value;
  }
  return decls;
}

/**
 * Build a {tokenName -> hex} map for either `light` or `dark` by
 * reading the two `:root` blocks the viewer stylesheet declares. The
 * resolver chases `var(--x)` aliases to concrete hex / rgb values with
 * a small depth bound.
 *
 * @param {string} css
 * @param {'light' | 'dark'} theme
 * @returns {Map<string, string>}
 */
export function buildTokenMap(css, theme) {
  const rules = extractRules(css);
  const tokens = new Map();
  for (const r of rules) {
    const selectorMatches = r.selectors.some((s) => {
      if (theme === 'light') {
        return s === ':root' || s === ':root[data-theme="light"]';
      }
      // dark: either the explicit [data-theme="dark"] block OR the
      // @media (prefers-color-scheme: dark) block scoped to :root
      // without an explicit theme attribute.
      if (s === ':root[data-theme="dark"]') return true;
      if (s === ':root:not([data-theme="light"]):not([data-theme="dark"])'
          && r.context && /prefers-color-scheme:\s*dark/.test(r.context)) return true;
      return false;
    });
    if (!selectorMatches) continue;
    for (const [name, value] of Object.entries(r.decls)) {
      if (name.startsWith('--')) {
        tokens.set(name, value);
      }
    }
  }
  // Resolve `var(--x)` chains to a concrete colour string.
  const resolved = new Map();
  for (const [name, value] of tokens.entries()) {
    resolved.set(name, resolveVar(value, tokens, 8));
  }
  return resolved;
}

function resolveVar(value, tokens, depth) {
  if (!value) return value;
  if (depth <= 0) return value;
  const trimmed = value.trim();
  const m = trimmed.match(/^var\(\s*(--[a-z0-9-]+)\s*(?:,\s*([^)]+))?\)$/i);
  if (m) {
    const key = m[1];
    const fallback = m[2];
    const got = tokens.get(key);
    if (got != null) return resolveVar(got, tokens, depth - 1);
    if (fallback) return resolveVar(fallback.trim(), tokens, depth - 1);
    return trimmed;
  }
  return trimmed;
}

/**
 * Resolve a CSS color value expression to an {r,g,b,a} tuple over the
 * given token map. Returns null when the value cannot be reduced to a
 * concrete colour (gradients, images, rgba over unknown surfaces).
 *
 * @param {string} value
 * @param {Map<string, string>} tokens
 * @returns {{ r: number, g: number, b: number, a: number } | null}
 */
export function resolveColour(value, tokens) {
  if (!value) return null;
  let v = value.trim();
  if (v === 'inherit' || v === 'currentColor' || v === 'currentcolor' || v === 'initial' || v === 'unset') return null;
  if (v === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  // var() chain
  if (/^var\(/i.test(v)) v = resolveVar(v, tokens, 8).trim();
  // reject gradients / images / url()
  if (/^(linear|radial|conic|repeating-|image\()/i.test(v)) return null;
  if (/^url\(/i.test(v)) return null;
  // background: shorthand with multiple tokens -> pick the first colour-looking token
  if (/\s/.test(v) && !/^(rgb|rgba|hsl|hsla)\(/i.test(v)) {
    // Example: `0 0 1px rgba(0,0,0,0.1), linear-gradient(...)` or `#fff url(x)`
    const parts = splitBackgroundValue(v);
    // A single part equal to the input (e.g. `color-mix(in srgb, ...)`)
    // cannot be reduced further; recursing would never terminate.
    if (parts.length === 1 && parts[0] === v) return null;
    for (const p of parts) {
      const r = resolveColour(p, tokens);
      if (r) return r;
    }
    return null;
  }
  // hex
  const hex = parseHex(v);
  if (hex) return hex;
  // rgb/rgba
  const rgb = v.match(/^rgba?\(([^)]+)\)$/i);
  if (rgb) {
    const nums = rgb[1].split(/[,\s/]+/).filter(Boolean).map((s) => s.trim());
    if (nums.length >= 3) {
      const r = clamp255(parseFloat(nums[0]));
      const g = clamp255(parseFloat(nums[1]));
      const b = clamp255(parseFloat(nums[2]));
      const a = nums.length >= 4 ? parsePct(nums[3]) : 1;
      if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) return { r, g, b, a };
    }
    return null;
  }
  // hsl/hsla
  const hsl = v.match(/^hsla?\(([^)]+)\)$/i);
  if (hsl) {
    const nums = hsl[1].split(/[,\s/]+/).filter(Boolean).map((s) => s.trim());
    if (nums.length >= 3) {
      const h = parseFloat(nums[0]);
      const s = parsePct(nums[1]);
      const l = parsePct(nums[2]);
      const a = nums.length >= 4 ? parsePct(nums[3]) : 1;
      const rgbArr = hslToRgb(h, s, l);
      return { r: rgbArr[0], g: rgbArr[1], b: rgbArr[2], a };
    }
    return null;
  }
  // Named colours we actually use.
  const named = NAMED_COLOURS[v.toLowerCase()];
  if (named) return parseHex(named);
  return null;
}

function parseHex(v) {
  const s = v.trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(s)) {
    const r = parseInt(s[0] + s[0], 16);
    const g = parseInt(s[1] + s[1], 16);
    const b = parseInt(s[2] + s[2], 16);
    return { r, g, b, a: 1 };
  }
  if (/^[0-9a-fA-F]{4}$/.test(s)) {
    const r = parseInt(s[0] + s[0], 16);
    const g = parseInt(s[1] + s[1], 16);
    const b = parseInt(s[2] + s[2], 16);
    const a = parseInt(s[3] + s[3], 16) / 255;
    return { r, g, b, a };
  }
  if (/^[0-9a-fA-F]{6}$/.test(s)) {
    const r = parseInt(s.slice(0, 2), 16);
    const g = parseInt(s.slice(2, 4), 16);
    const b = parseInt(s.slice(4, 6), 16);
    return { r, g, b, a: 1 };
  }
  if (/^[0-9a-fA-F]{8}$/.test(s)) {
    const r = parseInt(s.slice(0, 2), 16);
    const g = parseInt(s.slice(2, 4), 16);
    const b = parseInt(s.slice(4, 6), 16);
    const a = parseInt(s.slice(6, 8), 16) / 255;
    return { r, g, b, a };
  }
  return null;
}

function clamp255(n) {
  if (!Number.isFinite(n)) return NaN;
  if (n < 0) return 0;
  if (n > 255) return 255;
  return Math.round(n);
}

function parsePct(v) {
  if (typeof v !== 'string') return v;
  const t = v.trim();
  if (t.endsWith('%')) return Math.max(0, Math.min(100, parseFloat(t))) / 100;
  return Math.max(0, Math.min(1, parseFloat(t)));
}

function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r1 = 0, g1 = 0, b1 = 0;
  if (hp < 1) { r1 = c; g1 = x; }
  else if (hp < 2) { r1 = x; g1 = c; }
  else if (hp < 3) { g1 = c; b1 = x; }
  else if (hp < 4) { g1 = x; b1 = c; }
  else if (hp < 5) { r1 = x; b1 = c; }
  else { r1 = c; b1 = x; }
  const m = l - c / 2;
  return [Math.round((r1 + m) * 255), Math.round((g1 + m) * 255), Math.round((b1 + m) * 255)];
}

function splitBackgroundValue(v) {
  const out = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < v.length; i += 1) {
    const c = v[i];
    if (c === '(') depth += 1;
    else if (c === ')') depth = Math.max(0, depth - 1);
    else if (depth === 0 && (c === ' ' || c === ',')) {
      if (i > start) out.push(v.slice(start, i).trim());
      start = i + 1;
    }
  }
  if (start < v.length) out.push(v.slice(start).trim());
  return out.filter(Boolean);
}

// A tiny subset of CSS named colours that could appear in third-party
// snippets or inline SVG; `.min.js` vendored assets are excluded.
const NAMED_COLOURS = {
  black: '#000000',
  white: '#ffffff',
};

/**
 * WCAG relative luminance (sRGB).
 * https://www.w3.org/TR/WCAG20/#relativeluminancedef
 *
 * @param {{ r: number, g: number, b: number }} rgb
 * @returns {number}
 */
export function luminance(rgb) {
  const srgb = [rgb.r, rgb.g, rgb.b].map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];
}

/**
 * WCAG contrast ratio between two opaque colours. For a semi-transparent
 * foreground over an opaque background, the caller must composite first.
 *
 * @param {{ r: number, g: number, b: number }} a
 * @param {{ r: number, g: number, b: number }} b
 * @returns {number}
 */
export function contrastRatio(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Composite an rgba foreground over an opaque rgb background.
 * @param {{ r:number, g:number, b:number, a:number }} fg
 * @param {{ r:number, g:number, b:number }} bg
 */
export function composite(fg, bg) {
  if (fg.a == null || fg.a >= 1) return { r: fg.r, g: fg.g, b: fg.b };
  const a = fg.a;
  return {
    r: Math.round(fg.r * a + bg.r * (1 - a)),
    g: Math.round(fg.g * a + bg.g * (1 - a)),
    b: Math.round(fg.b * a + bg.b * (1 - a)),
  };
}

/**
 * Infer a WCAG state tag from a selector. The classifier is deliberately
 * forgiving (one selector can carry multiple state hints) so the
 * reported state names the most meaningful one. Default is `default`.
 *
 * @param {string} selector
 * @returns {string}
 */
export function stateOf(selector) {
  if (/:focus-visible/.test(selector)) return 'focus-visible';
  if (/:focus/.test(selector)) return 'focus';
  if (/:active/.test(selector)) return 'active';
  if (/:hover/.test(selector)) return 'hover';
  if (/:disabled|\[aria-disabled="true"\]/.test(selector)) return 'disabled';
  if (/\[aria-pressed="true"\]/.test(selector)) return 'aria-pressed';
  if (/\[aria-selected="true"\]/.test(selector)) return 'aria-selected';
  if (/\.is-active\b/.test(selector)) return 'is-active';
  return 'default';
}

/**
 * Threshold the pair must clear. 3:1 for selectors that paint a non-
 * text UI boundary (icon stroke, focus ring, border) OR large text
 * (headings, hero text); 4.5:1 for everything else.
 *
 * @param {string} selector
 * @param {Record<string,string>} decls
 * @returns {{ ratio: number, kind: 'text' | 'large-text' | 'ui-boundary' }}
 */
export function thresholdFor(selector, decls) {
  const lower = selector.toLowerCase();
  for (const hint of UI_BOUNDARY_SELECTOR_HINTS) {
    if (lower.includes(hint)) return { ratio: 3, kind: 'ui-boundary' };
  }
  for (const hint of LARGE_TEXT_SELECTOR_HINTS) {
    if (lower.includes(hint)) return { ratio: 3, kind: 'large-text' };
  }
  // Explicit large text: font-size >= 24px, or font-size >= 18.66px
  // combined with font-weight >= 700.
  const fs = decls && decls['font-size'];
  const fw = decls && decls['font-weight'];
  if (fs) {
    const m = /^(\d+(?:\.\d+)?)(px|rem)/.exec(fs);
    if (m) {
      const num = parseFloat(m[1]);
      const px = m[2] === 'rem' ? num * 16 : num;
      if (px >= 24) return { ratio: 3, kind: 'large-text' };
      if (px >= 18.66 && fw && parseInt(fw, 10) >= 700) return { ratio: 3, kind: 'large-text' };
    }
  }
  return { ratio: 4.5, kind: 'text' };
}

/**
 * Does the selector string refer to a decorative, non-text, non-
 * boundary rule we exclude from the audit? Keeps the report small so
 * failures are the ones that matter.
 *
 * @param {string} selector
 * @returns {boolean}
 */
export function isDecorative(selector) {
  const s = selector.toLowerCase();
  for (const hint of DECORATIVE_SELECTOR_HINTS) {
    if (s.includes(hint)) return true;
  }
  return false;
}

/**
 * Enumerate every (fg, bg, state, theme) pair the stylesheet asks the
 * browser to paint, plus every border and outline colour against the
 * surface it sits on.
 *
 * Text pairs. A default-state rule that declares `color` is paired with
 * its own `background` / `background-color`; if neither is declared (or
 * it is transparent / unresolvable) the pair is computed against the
 * three ancestor-surface candidates and marked `approximate`. A state
 * rule (hover, focus, focus-visible, active, aria-pressed, aria-
 * selected, is-active, disabled) is first MERGED over its base
 * selector's declarations (PR 291 landing review F2): a state that only
 * changes the background is paired with the colour the base declares
 * (the original `.rcf-search-btn:hover` defect). A colour of `inherit`,
 * `currentColor` or an unresolvable `var(..., inherit)` falls back to
 * the page ink declared on `body`, marked approximate.
 *
 * Boundary pairs. Every `border` / `border-*` / `border-color` and
 * `outline` / `outline-color` colour is paired at the 3:1 non-text
 * threshold (WCAG 1.4.11) against the adjacent surface: outside the
 * element (ancestor candidates, worst case) for borders and for
 * outlines with a non-negative offset; the element's own merged
 * background for an outline drawn inside (negative `outline-offset`).
 * Boundary pairs carry `asserted`: focus indicators (outlines), state-
 * rule borders and form-field borders are asserted; a default-state
 * border on any other element is a decorative hairline or a component
 * whose identity is carried by its text or fill, which WCAG 1.4.11 does
 * not require to reach 3:1, so it is reported with `asserted: false`
 * (advisory) and listed in the report rather than dropped.
 *
 * State rules whose base cannot be found are merged over nothing,
 * marked approximate, and listed in `unresolvedBases`.
 *
 * @param {string} css
 * @returns {{
 *   light: Array<PairRecord>,
 *   dark: Array<PairRecord>,
 *   lightTokens: Map<string,string>,
 *   darkTokens: Map<string,string>,
 *   unresolvedBases: string[],
 *   approximateBases: Array<{ selector: string, base: string }>,
 * }}
 *
 * @typedef {object} PairRecord
 * @property {string} selector
 * @property {string} state
 * @property {string} theme
 * @property {'text' | 'border' | 'outline'} pairType
 * @property {string} fg
 * @property {string} bg
 * @property {number | null} ratio
 * @property {number} threshold
 * @property {'text' | 'large-text' | 'ui-boundary'} kind
 * @property {boolean} pass
 * @property {boolean} asserted
 * @property {boolean} approximate
 * @property {string | null} baseSelector
 * @property {string | null} note
 */
export function enumeratePairs(css) {
  const lightTokens = buildTokenMap(css, 'light');
  const darkTokens = buildTokenMap(css, 'dark');
  const rules = extractRules(css);
  const index = buildSelectorIndex(rules);
  const bodyDecls = mergedDecls(index, 'body', null) || {};
  const inkExpr = bodyDecls['color'] || 'var(--sv-ink)';
  const light = [];
  const dark = [];
  const unresolvedBases = [];
  const approximateBases = [];
  for (const rule of rules) {
    for (const selector of rule.selectors) {
      if (isDecorative(selector)) continue;
      // Skip the token blocks (they declare colour tokens, not paint
      // real elements).
      if (selector === ':root' || /^:root\b/.test(selector)) continue;
      const own = rule.decls;
      const state = stateOf(selector);
      const ownTouchesText = own['color'] != null || own['background'] != null || own['background-color'] != null;
      const ownBoundaries = boundaryDeclsOf(own);
      if (!ownTouchesText && ownBoundaries.length === 0) continue;
      let effective = own;
      let baseSelector = null;
      let baseApprox = false;
      if (state !== 'default') {
        const found = findBase(index, selector, rule.context);
        if (found) {
          baseSelector = found.base;
          baseApprox = found.approximate;
          effective = { ...found.decls, ...own };
          if (found.approximate) approximateBases.push({ selector, base: found.base });
        } else {
          baseApprox = true;
          unresolvedBases.push(selector);
        }
      }
      const scope = themeScopeOf(selector);
      const thText = thresholdFor(selector, effective);
      const themesToVisit = [];
      if (scope === 'light' || scope === 'any') themesToVisit.push(['light', lightTokens, light]);
      if (scope === 'dark' || scope === 'any') themesToVisit.push(['dark', darkTokens, dark]);
      const ctx = { selector, state, baseSelector };
      for (const [themeName, tokens, bucket] of themesToVisit) {
        const before = bucket.length;
        // ---- text pair ----
        // A state rule always yields the merged text pair it paints in
        // that state, even when it only changes a border or an outline,
        // so every declared state is audited.
        const wantsText = state === 'default' ? own['color'] != null : true;
        if (wantsText) {
          let fgExpr = effective['color'];
          let fg = fgExpr != null ? resolveColour(fgExpr, tokens) : null;
          let fgNote = null;
          if (!fg) {
            // inherit / currentColor / var(--undeclared, inherit) / not
            // declared: the element paints the inherited page ink.
            fgNote = fgExpr == null ? 'fg inherited' : `fg ${fgExpr} -> inherited`;
            fgExpr = inkExpr;
            fg = resolveColour(inkExpr, tokens);
          }
          if (fg && !(fg.a != null && fg.a === 0)) {
            const bgOwn = effective['background-color'] || effective['background'];
            let bgResolved = null;
            if (bgOwn) bgResolved = resolveColour(bgOwn, tokens);
            const bgIsTransparent = bgResolved && bgResolved.a === 0;
            const approx = baseApprox || fgNote != null;
            const noteJoin = (n) => [fgNote, n].filter(Boolean).join('; ') || null;
            if (bgOwn && bgResolved && !bgIsTransparent && bgResolved.a === 1) {
              pushPair(bucket, selector, state, themeName, fgExpr, bgOwn, fg, bgResolved, thText, approx, noteJoin(null), tokens);
            } else if (bgOwn && bgResolved && bgResolved.a > 0 && bgResolved.a < 1) {
              pushApproxOverCandidates(bucket, selector, state, themeName, fgExpr, bgOwn, fg, bgResolved, thText, tokens, noteJoin('bg semi-transparent'));
            } else {
              const note = !bgOwn ? 'bg inherited'
                : bgIsTransparent ? 'bg transparent -> inherited'
                : 'bg unresolved';
              pushApprox(bucket, selector, state, themeName, fgExpr, bgOwn ?? '(inherited)', fg, thText, tokens, noteJoin(note));
            }
          }
        }
        // ---- boundary pairs (borders, outlines) ----
        for (const b of ownBoundaries) {
          pushBoundary(bucket, ctx, themeName, tokens, effective, b, baseApprox);
        }
        for (let i = before; i < bucket.length; i += 1) {
          const p = bucket[i];
          if (p.pairType == null) p.pairType = 'text';
          if (p.asserted == null) p.asserted = true;
          if (p.baseSelector === undefined) p.baseSelector = baseSelector;
        }
      }
    }
  }
  return { light, dark, lightTokens, darkTokens, unresolvedBases, approximateBases };
}

const STATE_TOKEN_SRC = ':focus-visible|:focus-within|:focus|:active|:hover|:disabled|\\[aria-pressed="true"\\]|\\[aria-selected="true"\\]|\\[aria-disabled="true"\\]|\\.is-active\\b';

/**
 * Remove every state pseudo-class / attribute / class from a selector,
 * including `:not(<state>)` wrappers, leaving the base element selector.
 * @param {string} selector
 * @returns {string}
 */
export function stripStates(selector) {
  return normaliseSelector(selector
    .replace(new RegExp(`:not\\((?:${STATE_TOKEN_SRC})\\)`, 'g'), '')
    .replace(new RegExp(STATE_TOKEN_SRC, 'g'), ''));
}

function normaliseSelector(s) {
  return s.replace(/\s*([>+~])\s*/g, ' $1 ').replace(/\s+/g, ' ').trim();
}

function buildSelectorIndex(rules) {
  const index = new Map();
  rules.forEach((r, order) => {
    for (const s of r.selectors) {
      const key = normaliseSelector(s);
      if (!index.has(key)) index.set(key, []);
      index.get(key).push({ decls: r.decls, context: r.context, order });
    }
  });
  return index;
}

function mergedDecls(index, key, context) {
  const entries = index.get(key);
  if (!entries) return null;
  const usable = entries.filter((e) => e.context == null || e.context === context);
  if (usable.length === 0) return null;
  const out = {};
  for (const e of usable) Object.assign(out, e.decls);
  return out;
}

// Split a selector into its compound parts at top-level combinators.
function compoundsOf(selector) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const c of selector) {
    if (c === '(' || c === '[') depth += 1;
    else if (c === ')' || c === ']') depth = Math.max(0, depth - 1);
    if (depth === 0 && (c === ' ' || c === '>' || c === '+' || c === '~')) {
      if (cur.trim()) out.push(cur.trim());
      cur = '';
      continue;
    }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/**
 * Find the base rule for a state selector. Order: the exact selector
 * with the states stripped; then the same with leading ancestor
 * compounds dropped one at a time (`.tools .x:hover` -> `.x`); then the
 * nearest ancestor-qualified rule in the stylesheet whose last compound
 * matches (`.x:hover` -> `.tools .x`). Steps two and three are marked
 * approximate.
 */
function findBase(index, selector, context) {
  const stripped = stripStates(selector);
  if (!stripped) return null;
  const exact = mergedDecls(index, stripped, context);
  if (exact && stripped !== normaliseSelector(selector)) return { base: stripped, decls: exact, approximate: false };
  const parts = compoundsOf(stripped);
  for (let i = 1; i < parts.length; i += 1) {
    const key = normaliseSelector(parts.slice(i).join(' '));
    const d = mergedDecls(index, key, context);
    if (d) return { base: key, decls: d, approximate: true };
  }
  const last = parts[parts.length - 1];
  if (!last) return null;
  let best = null;
  for (const [key, entries] of index.entries()) {
    if (key === normaliseSelector(selector)) continue;
    if (stateOf(key) !== 'default') continue;
    const kParts = compoundsOf(key);
    if (kParts[kParts.length - 1] !== last) continue;
    const order = entries[entries.length - 1].order;
    if (!best || order > best.order) best = { key, order };
  }
  if (best) return { base: best.key, decls: mergedDecls(index, best.key, context) || {}, approximate: true };
  return null;
}

const BORDER_PROPS = [
  'border', 'border-color',
  'border-top', 'border-right', 'border-bottom', 'border-left',
  'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
  'border-block', 'border-inline', 'border-block-start', 'border-block-end', 'border-inline-start', 'border-inline-end',
];
const OUTLINE_PROPS = ['outline', 'outline-color'];
// Form fields: the element names, or a class ending in -input / -select
// / -textarea (`.rcf-lookup-input`, `.pm-status-select`), but not
// `-selector`.
const FORM_FIELD_RE = /(^|[\s>+~(,])(input|select|textarea)(?![\w-])|-(input|select|textarea)(?![\w-])/;

function boundaryDeclsOf(decls) {
  const out = [];
  for (const prop of [...BORDER_PROPS, ...OUTLINE_PROPS]) {
    const v = decls[prop];
    if (v == null) continue;
    out.push({ prop, value: v, type: OUTLINE_PROPS.includes(prop) ? 'outline' : 'border' });
  }
  return out;
}

// Pick the colour out of a border / outline value. Returns null for
// `none` / `hidden` / zero-width / no colour (currentColor is resolved
// by the caller against the element's colour).
function boundaryColourExpr(value) {
  const parts = splitBackgroundValue(value.replace(/\s*!important\s*$/, ''));
  if (parts.some((p) => p === 'none' || p === 'hidden')) return null;
  if (parts.length > 0 && parts.every((p) => /^0(px|rem|em)?$/.test(p))) return null;
  if (parts.some((p) => /^0(px|rem|em)?$/.test(p)) && parts.length > 1) return null;
  for (const p of parts) {
    if (/^(solid|dashed|dotted|double|groove|ridge|inset|outset|thin|medium|thick|auto)$/.test(p)) continue;
    if (/^-?\d/.test(p)) continue;
    if (p === 'currentColor' || p === 'currentcolor') return 'currentColor';
    return p;
  }
  return null;
}

function pushBoundary(bucket, ctx, theme, tokens, effective, b, baseApprox) {
  const { selector, state, baseSelector } = ctx;
  let expr = boundaryColourExpr(b.value);
  if (!expr) return;
  if (expr === 'currentColor') expr = effective['color'] || 'var(--sv-ink)';
  const colour = resolveColour(expr, tokens);
  if (!colour || colour.a === 0) return;
  const lower = selector.toLowerCase();
  const isFormField = FORM_FIELD_RE.test(lower);
  const asserted = b.type === 'outline' || state !== 'default' || isFormField;
  const th = { ratio: 3, kind: 'ui-boundary' };
  // Outline drawn inside the element (negative offset) sits on the
  // element's own background; everything else sits on the surface
  // outside the element.
  const offset = effective['outline-offset'];
  const inside = b.type === 'outline' && offset != null && /^-/.test(offset.trim());
  const ownBgExpr = effective['background-color'] || effective['background'];
  const ownBg = ownBgExpr ? resolveColour(ownBgExpr, tokens) : null;
  let rec;
  if (inside && ownBg && ownBg.a === 1) {
    const flat = composite(colour, ownBg);
    const ratio = contrastRatio(flat, ownBg);
    rec = { bg: ownBgExpr, fgResolved: toHex(flat), bgResolved: toHex(ownBg), ratio, approximate: baseApprox };
  } else {
    const worst = worstOverCandidates(colour, tokens);
    if (!worst) return;
    rec = { bg: `(adjacent) ~ ${worst.c.bgExpr}`, fgResolved: toHex(worst.flat), bgResolved: toHex(worst.c.bg), ratio: worst.ratio, approximate: true };
  }
  bucket.push({
    selector,
    state,
    theme,
    pairType: b.type,
    fg: `${b.prop}: ${b.value}`,
    bg: rec.bg,
    fgResolved: rec.fgResolved,
    bgResolved: rec.bgResolved,
    ratio: rec.ratio,
    threshold: th.ratio,
    kind: th.kind,
    pass: rec.ratio >= th.ratio - 1e-6,
    asserted,
    approximate: rec.approximate,
    baseSelector,
    note: asserted ? null : 'advisory: default-state border, not required by WCAG 1.4.11',
  });
}

function surfaceCandidates(tokens) {
  return [
    { name: 'canvas', bgExpr: 'var(--sv-canvas)', bg: resolveColour('var(--sv-canvas)', tokens) },
    { name: 'surface', bgExpr: 'var(--sv-surface)', bg: resolveColour('var(--sv-surface)', tokens) },
    { name: 'raised', bgExpr: 'var(--sv-raised)', bg: resolveColour('var(--sv-raised)', tokens) },
  ].filter((c) => c.bg);
}

function worstOverCandidates(fg, tokens) {
  let worst = null;
  for (const c of surfaceCandidates(tokens)) {
    const flat = composite(fg, c.bg);
    const r = contrastRatio(flat, c.bg);
    if (worst == null || r < worst.ratio) worst = { ratio: r, c, flat };
  }
  return worst;
}

/**
 * Infer the theme scope from the selector prefix. Selectors prefixed
 * with `html[data-theme="dark"]` or `:root[data-theme="dark"]` only
 * paint in dark; `[data-theme="light"]` only in light; the default is
 * both.
 *
 * @param {string} selector
 * @returns {'light' | 'dark' | 'any'}
 */
export function themeScopeOf(selector) {
  if (/\[data-theme="dark"\]/.test(selector)) return 'dark';
  if (/\[data-theme="light"\]/.test(selector)) return 'light';
  if (/\[data-theme=dark\]/.test(selector)) return 'dark';
  if (/\[data-theme=light\]/.test(selector)) return 'light';
  if (/:not\(\[data-theme="dark"\]\)/.test(selector)) return 'light';
  if (/:not\(\[data-theme="light"\]\)/.test(selector)) return 'dark';
  return 'any';
}

function pushApproxOverCandidates(bucket, selector, state, theme, fgExpr, bgExpr, fg, bgSemi, th, tokens, note) {
  const candidates = [
    { name: 'canvas', bgExpr: 'var(--sv-canvas)', bg: resolveColour('var(--sv-canvas)', tokens) },
    { name: 'surface', bgExpr: 'var(--sv-surface)', bg: resolveColour('var(--sv-surface)', tokens) },
    { name: 'raised', bgExpr: 'var(--sv-raised)', bg: resolveColour('var(--sv-raised)', tokens) },
  ].filter((c) => c.bg);
  let worst = null;
  for (const c of candidates) {
    // Composite the semi-transparent bg over the candidate surface, then
    // composite the fg over that composite.
    const effectiveBg = composite(bgSemi, c.bg);
    const flatFg = composite(fg, effectiveBg);
    const r = contrastRatio(flatFg, effectiveBg);
    if (worst == null || r < worst.ratio) {
      worst = { ratio: r, c, effectiveBg, flatFg };
    }
  }
  if (!worst) return;
  const pass = worst.ratio >= th.ratio - 1e-6;
  bucket.push({
    selector,
    state,
    theme,
    fg: fgExpr,
    bg: `${bgExpr} over ${worst.c.bgExpr}`,
    fgResolved: toHex(worst.flatFg),
    bgResolved: toHex(worst.effectiveBg),
    ratio: worst.ratio,
    threshold: th.ratio,
    kind: th.kind,
    pass,
    approximate: true,
    note,
  });
}

function pushPair(bucket, selector, state, theme, fgExpr, bgExpr, fg, bg, th, approx, note, tokens) {
  // Composite semi-transparent fg over bg.
  const flatFg = composite(fg, bg);
  const ratio = contrastRatio(flatFg, bg);
  const pass = ratio >= th.ratio - 1e-6;
  bucket.push({
    selector,
    state,
    theme,
    fg: fgExpr,
    bg: bgExpr,
    fgResolved: toHex(flatFg),
    bgResolved: toHex(bg),
    ratio,
    threshold: th.ratio,
    kind: th.kind,
    pass,
    approximate: approx,
    note,
  });
}

function pushApprox(bucket, selector, state, theme, fgExpr, bgExpr, fg, th, tokens, note) {
  const candidates = [
    { name: 'canvas', bgExpr: 'var(--sv-canvas)', bg: resolveColour('var(--sv-canvas)', tokens) },
    { name: 'surface', bgExpr: 'var(--sv-surface)', bg: resolveColour('var(--sv-surface)', tokens) },
    { name: 'raised', bgExpr: 'var(--sv-raised)', bg: resolveColour('var(--sv-raised)', tokens) },
  ].filter((c) => c.bg);
  let worst = null;
  for (const c of candidates) {
    const flat = composite(fg, c.bg);
    const r = contrastRatio(flat, c.bg);
    if (worst == null || r < worst.ratio) worst = { ratio: r, c, flat };
  }
  if (!worst) return;
  const pass = worst.ratio >= th.ratio - 1e-6;
  bucket.push({
    selector,
    state,
    theme,
    fg: fgExpr,
    bg: `${bgExpr} ~ ${worst.c.bgExpr}`,
    fgResolved: toHex(worst.flat),
    bgResolved: toHex(worst.c.bg),
    ratio: worst.ratio,
    threshold: th.ratio,
    kind: th.kind,
    pass,
    approximate: true,
    note,
  });
}

function toHex(rgb) {
  if (!rgb) return 'n/a';
  const h = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${h(rgb.r)}${h(rgb.g)}${h(rgb.b)}`;
}

/**
 * Render a Markdown table of pair records.
 * @param {string} title
 * @param {Array<PairRecord>} pairs
 */
export function renderReportSection(title, pairs) {
  const lines = [];
  lines.push(`## ${title}`);
  lines.push('');
  lines.push('| selector | state | theme | fg | bg | fg (resolved) | bg (resolved) | ratio | threshold | kind | pass | note |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const p of pairs) {
    lines.push(`| \`${escapePipes(p.selector)}\` | ${p.state} | ${p.theme} | \`${escapePipes(p.fg)}\` | \`${escapePipes(p.bg)}\` | ${p.fgResolved} | ${p.bgResolved} | ${p.ratio.toFixed(2)}:1 | ${p.threshold}:1 | ${p.kind} | ${p.pass ? 'yes' : 'NO'}${p.approximate ? ' (approx)' : ''} | ${p.note ?? ''} |`);
  }
  return lines.join('\n');
}

function escapePipes(s) {
  return String(s).replace(/\|/g, '\\|');
}
