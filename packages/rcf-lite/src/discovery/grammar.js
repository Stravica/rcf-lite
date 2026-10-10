// Journey-source parsers for the UX intake gate (REQ-189, TAC-4142,
// AC-18902-1/3/5). Two parsers, one draft shape:
//
//   parseJourneyLines(text, source)   - the line grammar authored by
//                                       a product owner or an engineer
//   parseJourneyMap(text, source)     - the ux-designer prose shape
//                                       (H2 heading per step, Screen:,
//                                       Goes to:)
//
// Both return the same JourneyDraft so mint.js is one path. Grammar
// failures throw GrammarError naming the file, the 1-based line
// number and the offending rule (AC-18902-5).
//
// FBS-210 scope: parseJourneyMap consumes the Screen: and Goes to:
// lines of each H2 block. The prose shape authored by the ux-designer
// role also uses Sees: and Can do: bullets; those are IGNORED (TAC
// P3-1 fold-in: a BUILD reviewer should not look for them) because
// they are prose context, not grammar. If a future release wants a
// check against them, the parser gains a new rule and FBS-211 or a
// successor binds it; nothing in FBS-210 or ADR-4142 requires it.
//
// Node built-ins only.

import { existsSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export class GrammarError extends Error {
  /**
   * @param {string} message
   * @param {object} opts
   * @param {string} opts.source
   * @param {number} opts.line - 1-based
   * @param {string} opts.rule
   */
  constructor(message, { source, line, rule }) {
    super(`${source}:${line}: ${message} (rule: ${rule})`);
    this.name = 'GrammarError';
    this.source = source;
    this.line = line;
    this.rule = rule;
    this.code = 'grammar';
  }
}

/**
 * @typedef {object} StepDraft
 * @property {string} slug
 * @property {'entry'|'step'|'exit'|'interruption'} kind
 * @property {string} screenSlug
 * @property {string | null} label
 * @property {string[]} nextSlugs          step slugs this step links to
 * @property {string | null} returnsToSlug step slug on interruption, null otherwise
 */

/**
 * @typedef {object} JourneyDraft
 * @property {string} journeySlug
 * @property {string | null} title
 * @property {string | null} actor
 * @property {string | null} goal
 * @property {string} source
 * @property {StepDraft[]} steps
 * @property {Record<string, string> | null} interruptions
 */

const STEP_KINDS = new Set(['entry', 'step', 'exit', 'interruption']);

/**
 * Line grammar. The format (TAC-4142 interfaces[journey line grammar]):
 *
 *   # Journey: <title>
 *   actor: <string>
 *   goal: <string>
 *   - <entry|step|exit|interruption> <step-slug> @<screen-slug> <label...>
 *   - interruption <slug> @<screen-slug> <label> -> returns <step-slug>
 *   interruptions: <entry>=<step-slug>, <entry>=notApplicable:<reason>, ...
 *
 * - Blank lines and lines starting with # (other than the Journey:
 *   heading) are ignored.
 * - A step line's `label` is optional; everything after the screen
 *   slug (minus the `-> returns ...` tail on interruptions) becomes
 *   the label.
 * - A step with no `next` field is terminal in file order; `next`
 *   between non-interruption steps is derived by file order on
 *   mint. interruption steps carry `returnsTo` from `-> returns ...`.
 * - The journeySlug is derived from the Journey: title; if the title
 *   is a single kebab token it is used verbatim, otherwise it is a
 *   slug-ified form.
 *
 * @param {string} text
 * @param {string} source - the authored path (for error messages and the Journey.source field)
 * @returns {JourneyDraft}
 */
export function parseJourneyLines(text, source) {
  const lines = text.split(/\r?\n/);
  let title = null;
  let actor = null;
  let goal = null;
  const steps = /** @type {StepDraft[]} */ ([]);
  const slugSeen = new Set();
  /** @type {Record<string,string>|null} */
  let interruptions = null;

  for (let i = 0; i < lines.length; i += 1) {
    const lineNo = i + 1;
    const raw = lines[i];
    const line = raw.trim();
    if (line.length === 0) continue;
    if (line.startsWith('#')) {
      const m = /^#\s*Journey:\s*(.+?)\s*$/.exec(line);
      if (m) {
        if (title !== null) {
          throw new GrammarError(`duplicate '# Journey:' heading`, { source, line: lineNo, rule: 'single-journey-heading' });
        }
        title = m[1];
        continue;
      }
      // Any other # line is treated as a comment and skipped.
      continue;
    }
    if (/^actor:/i.test(line)) {
      actor = line.slice(line.indexOf(':') + 1).trim() || null;
      continue;
    }
    if (/^goal:/i.test(line)) {
      goal = line.slice(line.indexOf(':') + 1).trim() || null;
      continue;
    }
    if (/^interruptions:/i.test(line)) {
      const body = line.slice(line.indexOf(':') + 1).trim();
      interruptions = parseInterruptionsLine(body, source, lineNo);
      continue;
    }
    if (line.startsWith('-')) {
      steps.push(parseStepLine(line, source, lineNo, slugSeen));
      continue;
    }
    throw new GrammarError(`line not recognised (expected '# Journey:', 'actor:', 'goal:', 'interruptions:' or a '- <kind> <slug> @<screen-slug> ...' step)`, { source, line: lineNo, rule: 'line-shape' });
  }
  if (steps.length === 0) {
    throw new GrammarError(`no step lines found`, { source, line: lines.length || 1, rule: 'at-least-one-step' });
  }
  if (title === null) {
    throw new GrammarError(`missing '# Journey: <title>' heading`, { source, line: 1, rule: 'journey-heading' });
  }
  const journeySlug = toSlug(title);
  if (!SLUG_RE.test(journeySlug)) {
    throw new GrammarError(`journey title '${title}' does not slug to a valid kebab-slug (got '${journeySlug}')`, { source, line: 1, rule: 'journey-slug' });
  }
  const draft = {
    journeySlug,
    title,
    actor,
    goal,
    source,
    steps,
    interruptions,
  };
  return linkByFileOrder(draft);
}

function parseStepLine(line, source, lineNo, slugSeen) {
  // Strip the leading '-' and any space.
  const body = line.replace(/^-\s*/, '');
  // Split on whitespace for the first three tokens.
  const tokens = body.split(/\s+/);
  if (tokens.length < 3) {
    throw new GrammarError(`step line must be '- <kind> <slug> @<screen-slug> [label]'`, { source, line: lineNo, rule: 'step-shape' });
  }
  const kind = tokens[0];
  if (!STEP_KINDS.has(kind)) {
    throw new GrammarError(`missing or unknown kind '${kind}' (expected one of entry, step, exit, interruption)`, { source, line: lineNo, rule: 'step-kind' });
  }
  const slug = tokens[1];
  if (!SLUG_RE.test(slug)) {
    throw new GrammarError(`step slug '${slug}' must be lower-case kebab`, { source, line: lineNo, rule: 'step-slug' });
  }
  if (slugSeen.has(slug)) {
    throw new GrammarError(`duplicate step slug '${slug}'`, { source, line: lineNo, rule: 'step-slug-unique' });
  }
  slugSeen.add(slug);
  const atTok = tokens[2];
  if (!atTok.startsWith('@')) {
    throw new GrammarError(`missing @screen-slug (expected the third token to start with '@')`, { source, line: lineNo, rule: 'step-screen' });
  }
  const screenSlug = atTok.slice(1);
  if (!SLUG_RE.test(screenSlug)) {
    throw new GrammarError(`screen slug '${screenSlug}' must be lower-case kebab`, { source, line: lineNo, rule: 'screen-slug' });
  }
  // Everything after the first three tokens is the label (may be empty).
  let rest = tokens.slice(3).join(' ').trim();
  let returnsToSlug = null;
  if (kind === 'interruption') {
    // interruption lines MUST carry a `-> returns <step-slug>` tail.
    const m = /^(.*?)->\s*returns\s+(\S+)\s*$/.exec(rest);
    if (!m) {
      throw new GrammarError(`interruption step must end with '-> returns <step-slug>'`, { source, line: lineNo, rule: 'interruption-returns' });
    }
    rest = m[1].trim();
    returnsToSlug = m[2].trim();
    if (!SLUG_RE.test(returnsToSlug)) {
      throw new GrammarError(`interruption returns slug '${returnsToSlug}' must be lower-case kebab`, { source, line: lineNo, rule: 'returns-slug' });
    }
  }
  const label = rest.length > 0 ? rest : null;
  return { slug, kind, screenSlug, label, nextSlugs: [], returnsToSlug };
}

function parseInterruptionsLine(body, source, lineNo) {
  /** @type {Record<string,string>} */
  const out = {};
  if (body.length === 0) return out;
  const pairs = body.split(',').map((s) => s.trim()).filter(Boolean);
  for (const pair of pairs) {
    const eq = pair.indexOf('=');
    if (eq <= 0) {
      throw new GrammarError(`interruptions pair '${pair}' must be '<entry>=<step-slug>' or '<entry>=notApplicable:<reason>'`, { source, line: lineNo, rule: 'interruptions-pair' });
    }
    const entry = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (entry.length === 0 || value.length === 0) {
      throw new GrammarError(`interruptions pair '${pair}' has an empty side`, { source, line: lineNo, rule: 'interruptions-pair' });
    }
    out[entry] = value;
  }
  return out;
}

function linkByFileOrder(draft) {
  // Build next edges: for each step except the last non-interruption,
  // link to the following non-interruption step in file order. An
  // interruption contributes no next edge (it uses returnsTo).
  const seqIndexes = /** @type {number[]} */ ([]);
  for (let i = 0; i < draft.steps.length; i += 1) {
    if (draft.steps[i].kind !== 'interruption') seqIndexes.push(i);
  }
  for (let s = 0; s < seqIndexes.length - 1; s += 1) {
    const fromIdx = seqIndexes[s];
    const toIdx = seqIndexes[s + 1];
    draft.steps[fromIdx].nextSlugs = [draft.steps[toIdx].slug];
  }
  return draft;
}

/**
 * Prose-shape parser. The format (TAC-4142 interfaces[journey-map
 * prose shape]):
 *
 *   # <any heading>              (optional context, ignored)
 *   ## <step title 1>
 *     Screen: wf-NN-slug
 *     Goes to: wf-NN-slug
 *     Goes to: wf-NN-slug
 *   ## <step title 2>
 *     Screen: wf-NN-slug
 *     [no Goes to -> exit]
 *   ...
 *   Interruptions:
 *     lostEmail: wf-NN-slug
 *     closedTab: notApplicable, inline save
 *
 * - The first H2 is the entry; an H2 whose block has no Goes to line
 *   is an exit; any other H2 is a plain step.
 * - Each wf-NN-slug names a screen (and, when a file of the same stem
 *   with .md or .html lives beside the source, that file is the
 *   screen's wireframe).
 * - Sees: and Can do: lines (produced by the ux-designer role
 *   template) are prose context, not grammar: this parser does not
 *   consume them. If a wireframe or a check cares about them later a
 *   dedicated rule will land; FBS-210 names them here so a BUILD
 *   reviewer does not invent one.
 *
 * The returned draft is the same shape parseJourneyLines produces,
 * so mint.js has one path.
 *
 * @param {string} text
 * @param {string} source - the authored path (absolute when the caller needs the wireframe side-car check to resolve files on disk)
 * @param {object} [opts]
 * @param {(absPath: string) => boolean} [opts.wireframeExists] - test seam; defaults to a real existsSync check beside the source
 * @param {string} [opts.displaySource] - the path quoted in GrammarError messages; defaults to `source`. Callers whose `source` is absolute (for the wireframe check) pass the repo-relative path here so errors read the same as the add verb's.
 * @returns {JourneyDraft}
 */
export function parseJourneyMap(text, source, opts = {}) {
  const existsFn = opts.wireframeExists ?? defaultWireframeExists(source);
  const displaySource = typeof opts.displaySource === 'string' && opts.displaySource.length > 0
    ? opts.displaySource
    : source;
  const lines = text.split(/\r?\n/);
  let title = null;
  const blocks = /** @type {Array<{heading: string, headingLine: number, screenSlug: string|null, screenLine: number, goesTo: Array<{slug:string, line:number}>}>} */ ([]);
  /** @type {Record<string,string>|null} */
  let interruptions = null;
  let inInterruptions = false;
  const slugSeen = new Set();

  for (let i = 0; i < lines.length; i += 1) {
    const lineNo = i + 1;
    const raw = lines[i];
    const line = raw.trim();
    if (line.length === 0) continue;
    const h1 = /^#\s+(.+)$/.exec(line);
    const h2 = /^##\s+(.+)$/.exec(line);
    if (h2) {
      const headingText = h2[1].trim();
      const slug = toSlug(headingText);
      if (!SLUG_RE.test(slug)) {
        throw new GrammarError(`H2 heading '${headingText}' does not slug to a valid kebab-slug`, { source: displaySource, line: lineNo, rule: 'h2-slug' });
      }
      if (slugSeen.has(slug)) {
        throw new GrammarError(`duplicate H2 heading '${headingText}' (slug ${slug})`, { source: displaySource, line: lineNo, rule: 'h2-unique' });
      }
      slugSeen.add(slug);
      blocks.push({ heading: headingText, headingLine: lineNo, screenSlug: null, screenLine: -1, goesTo: [] });
      inInterruptions = false;
      continue;
    }
    if (h1) {
      if (title === null) title = h1[1].trim();
      inInterruptions = false;
      continue;
    }
    if (/^interruptions:/i.test(line)) {
      inInterruptions = true;
      // Inline form 'Interruptions: a=1, b=2': consume the tail.
      const inline = line.slice(line.indexOf(':') + 1).trim();
      if (inline.length > 0) {
        interruptions = parseInterruptionsLine(inline, displaySource, lineNo);
      } else if (interruptions === null) {
        interruptions = {};
      }
      continue;
    }
    if (inInterruptions && /^-\s+/.test(line)) {
      const entry = line.replace(/^-\s+/, '');
      const colon = entry.indexOf(':');
      if (colon <= 0) {
        throw new GrammarError(`interruption bullet '${entry}' must be '<entry>: <wf-NN-slug or notApplicable, reason>'`, { source: displaySource, line: lineNo, rule: 'interruption-bullet' });
      }
      const key = entry.slice(0, colon).trim();
      const val = entry.slice(colon + 1).trim();
      const value = /^notApplicable\s*,\s*(.+)$/i.exec(val);
      interruptions = interruptions ?? {};
      if (value) {
        interruptions[key] = `notApplicable:${value[1].trim()}`;
      } else {
        interruptions[key] = val;
      }
      continue;
    }
    const screenM = /^Screen:\s*(\S+)\s*$/i.exec(line);
    if (screenM) {
      if (blocks.length === 0) {
        throw new GrammarError(`'Screen:' line before any H2 heading`, { source: displaySource, line: lineNo, rule: 'screen-outside-step' });
      }
      const slug = screenM[1];
      if (!SLUG_RE.test(slug)) {
        throw new GrammarError(`screen slug '${slug}' must be lower-case kebab`, { source: displaySource, line: lineNo, rule: 'screen-slug' });
      }
      const block = blocks[blocks.length - 1];
      if (block.screenSlug !== null) {
        throw new GrammarError(`H2 block for '${block.heading}' has more than one 'Screen:' line`, { source: displaySource, line: lineNo, rule: 'single-screen' });
      }
      block.screenSlug = slug;
      block.screenLine = lineNo;
      inInterruptions = false;
      continue;
    }
    const goesM = /^Goes to:\s*(\S+)\s*$/i.exec(line);
    if (goesM) {
      if (blocks.length === 0) {
        throw new GrammarError(`'Goes to:' line before any H2 heading`, { source: displaySource, line: lineNo, rule: 'goes-outside-step' });
      }
      const slug = goesM[1];
      if (!SLUG_RE.test(slug)) {
        throw new GrammarError(`Goes to slug '${slug}' must be lower-case kebab`, { source: displaySource, line: lineNo, rule: 'goes-slug' });
      }
      blocks[blocks.length - 1].goesTo.push({ slug, line: lineNo });
      inInterruptions = false;
      continue;
    }
    // Prose context (Sees:, Can do:, free text, bullets outside the
    // interruptions block): intentionally ignored. See the module
    // comment for the fold-in reason.
  }
  if (blocks.length === 0) {
    throw new GrammarError(`no H2 step headings found`, { source: displaySource, line: 1, rule: 'at-least-one-step' });
  }
  const effectiveTitle = title ?? toTitleFromSource(source);
  const journeySlug = toSlug(effectiveTitle);
  if (!SLUG_RE.test(journeySlug)) {
    throw new GrammarError(`journey title '${effectiveTitle}' does not slug to a valid kebab-slug`, { source: displaySource, line: 1, rule: 'journey-slug' });
  }
  // Build steps: screen slug is derived from the Screen: line; nextSlugs
  // are the step slugs whose screenSlug matches a Goes to screen slug.
  // The entry/step/exit classification: first H2 is entry; blocks with
  // no Goes to are exits; everything else is a plain step.
  const stepIndexByScreenSlug = new Map();
  const steps = /** @type {StepDraft[]} */ ([]);
  for (let b = 0; b < blocks.length; b += 1) {
    const block = blocks[b];
    if (block.screenSlug === null) {
      throw new GrammarError(`H2 block for '${block.heading}' is missing its 'Screen:' line`, { source: displaySource, line: block.headingLine, rule: 'step-screen' });
    }
    const kind = b === 0 ? 'entry' : (block.goesTo.length === 0 ? 'exit' : 'step');
    const slug = toSlug(block.heading);
    steps.push({ slug, kind, screenSlug: block.screenSlug, label: block.heading, nextSlugs: [], returnsToSlug: null });
    stepIndexByScreenSlug.set(block.screenSlug, slug);
  }
  for (let b = 0; b < blocks.length; b += 1) {
    const block = blocks[b];
    const nextSlugs = [];
    for (const g of block.goesTo) {
      const target = stepIndexByScreenSlug.get(g.slug);
      if (!target) {
        throw new GrammarError(`'Goes to: ${g.slug}' names a screen that no H2 block declares`, { source: displaySource, line: g.line, rule: 'goes-target' });
      }
      nextSlugs.push(target);
    }
    steps[b].nextSlugs = nextSlugs;
  }
  // Resolve prose interruption values: the ux-designer prose shape
  // authors a catalogue bullet as '<entry>: <wf-NN-slug or notApplicable, reason>',
  // naming a screen slug (what the designer sees on the page). mint.js
  // only maps step slugs onto step ids, so screen slugs must be
  // rewritten to the step slug whose screenSlug matches before the
  // draft leaves this parser. A screen named by Interruptions that no
  // H2 block declares is a grammar failure (same shape as goes-target).
  if (interruptions) {
    for (const [entry, value] of Object.entries(interruptions)) {
      if (typeof value !== 'string') continue;
      if (value.startsWith('notApplicable:')) continue;
      // Already a step slug (a block heading slug-ified): leave as-is
      // so a prose source authored with step slugs still mints.
      if (steps.some((s) => s.slug === value)) continue;
      const target = stepIndexByScreenSlug.get(value);
      if (!target) {
        throw new GrammarError(`Interruptions bullet '${entry}: ${value}' names a screen or step that no H2 block declares`, { source: displaySource, line: 1, rule: 'interruption-target' });
      }
      interruptions[entry] = target;
    }
  }
  // Wireframe side-car check. For each screen slug named in any
  // Screen: or Goes to: line, if a file of the same stem with .md,
  // .html or .png lives beside the authored source, that path is the
  // screen's wireframe. The parser only records the path on the first
  // step whose screenSlug it is; mint.js attaches it to the Screen.
  const wireframePaths = new Map();
  const seenSlugs = new Set();
  const checkSlug = (slug) => {
    if (seenSlugs.has(slug)) return;
    seenSlugs.add(slug);
    const found = existsFn(slug);
    if (found) wireframePaths.set(slug, found);
  };
  for (const step of steps) checkSlug(step.screenSlug);

  const draft = {
    journeySlug,
    title: effectiveTitle,
    actor: null,
    goal: null,
    source,
    steps,
    interruptions,
  };
  // Attach wireframe side-car on the draft so mint.js can read it.
  // The field is non-enumerable so JSON serialisation of a draft (for
  // --dry-run tracing) does not drag an unexpected key.
  Object.defineProperty(draft, '__wireframeBySlug', {
    value: wireframePaths,
    enumerable: false,
    writable: false,
    configurable: false,
  });
  return draft;
}

function defaultWireframeExists(sourcePath) {
  const srcDir = dirname(sourcePath);
  return (slug) => {
    for (const ext of ['.md', '.html', '.png']) {
      const candidate = join(srcDir, `${slug}${ext}`);
      if (existsSync(candidate)) return candidate;
    }
    return null;
  };
}

function toSlug(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function toTitleFromSource(sourcePath) {
  const slash = Math.max(sourcePath.lastIndexOf('/'), sourcePath.lastIndexOf('\\'));
  const base = sourcePath.slice(slash + 1).replace(/\.[^.]+$/, '');
  return base.length > 0 ? base : 'journey';
}
