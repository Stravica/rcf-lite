// Journey minting (REQ-189, TAC-4142, AC-18902-1, AC-18902-2, AC-18902-7).
//
// Pure function over an in-memory record + a JourneyDraft. Returns a
// NEW record (does not mutate the input) with:
//
//   - the Journey minted at JNY-nnn, keyed by slug: an existing
//     journey of the same slug keeps its id, a new slug mints the
//     next number, numbers of retired slugs are NEVER reused (that is
//     the ledger discipline: once a JNY-nnn is minted its number is
//     retired forever).
//   - Journey.steps each at JNY-<j-nnn>-nnn, keyed by step slug:
//     unchanged slugs keep their id, a new slug mints the next step
//     number, retired step numbers never reuse.
//   - Screens accumulated across all journeys at SCR-nnn, keyed by
//     slug: a new screen slug mints the next SCR-nnn.
//   - never accepts a hand-supplied JNY, JNY-step or SCR id (AC-18902-7).
//
// The "retired numbers never reused" rule is the only invariant that
// needs more than slug lookup: mintJourney tracks a per-journey
// stepHighWaterMark on the Journey object so that even after a slug
// is removed, the next new slug on that journey mints
// stepHighWaterMark + 1.
//
// Node built-ins only; no imports needed.

const JNY_RE = /^JNY-\d{3,}$/;
const JNY_STEP_RE = /^JNY-\d{3,}-\d{3,}$/;
const SCR_RE = /^SCR-\d{3,}$/;

export class MintError extends Error {
  constructor(message) {
    super(message);
    this.name = 'MintError';
    this.code = 'mint';
  }
}

/**
 * Mint one draft into a record. The record may be the empty record
 * emptyJourneyRecord() produced, or a loaded existing record.
 *
 * @param {object} args
 * @param {import('./record.js').JourneyRecord} args.record
 * @param {import('./grammar.js').JourneyDraft} args.draft
 * @returns {{ record: import('./record.js').JourneyRecord, mintedJourney: import('./record.js').Journey, newSlugs: {screens: string[], steps: string[], journey: boolean} }}
 */
export function mintJourney({ record, draft }) {
  if (!record || !Array.isArray(record.screens) || !Array.isArray(record.journeys)) {
    throw new MintError('mintJourney: record must be a validated JourneyRecord (loader output or emptyJourneyRecord()).');
  }
  // Deep-copy only the arrays we touch (keep top-level pointers stable
  // for callers that compare record === oldRecord references).
  const screens = record.screens.map((s) => ({ ...s, references: [...s.references] }));
  const journeys = record.journeys.map((j) => ({
    ...j,
    steps: j.steps.map((st) => ({ ...st, next: [...st.next] })),
    interruptions: j.interruptions ? { ...j.interruptions } : null,
  }));

  const newScreenSlugs = [];
  const newStepSlugs = [];

  // Pass 1: screens. Resolve every screenSlug referenced by the draft
  // (step.screenSlug plus any nested wireframe mapping) to a Screen
  // id, minting SCR-nnn for new slugs. The highest existing SCR
  // number sets the floor for new mints (ledger discipline).
  const screenBySlug = new Map(screens.map((s) => [s.slug, s]));
  const screenHighWater = screens.reduce(
    (max, s) => Math.max(max, parseScrNumber(s.id)),
    0,
  );
  let nextScreenNum = screenHighWater;

  /** @type {Map<string,string>} */
  const draftWireframes = draft.__wireframeBySlug instanceof Map
    ? draft.__wireframeBySlug
    : new Map();

  const referencedSlugs = new Set();
  for (const step of draft.steps) referencedSlugs.add(step.screenSlug);

  for (const slug of referencedSlugs) {
    let screen = screenBySlug.get(slug);
    if (!screen) {
      nextScreenNum += 1;
      const id = `SCR-${String(nextScreenNum).padStart(3, '0')}`;
      screen = {
        id,
        slug,
        title: null,
        wireframe: null,
        references: [],
      };
      screens.push(screen);
      screenBySlug.set(slug, screen);
      newScreenSlugs.push(slug);
    }
    // Attach a wireframe side-car if the draft resolved one and the
    // Screen has none yet. Wireframe paths are repo-relative and never
    // a URL. The grammar already refuses URL screen slugs; the record
    // validator refuses URL wireframe paths. Store the path as the
    // grammar passed it (callers are responsible for making it
    // repo-relative; the CLI does so).
    const wf = draftWireframes.get(slug);
    if (wf && screen.wireframe === null) {
      screen.wireframe = wf;
    }
  }

  // Pass 2: the journey itself. Mint JNY-nnn by slug.
  const journeyHighWater = journeys.reduce(
    (max, j) => Math.max(max, parseJnyNumber(j.id)),
    0,
  );
  let existing = journeys.find((j) => j.slug === draft.journeySlug);
  let mintedNew = false;
  if (!existing) {
    const num = journeyHighWater + 1;
    existing = {
      id: `JNY-${String(num).padStart(3, '0')}`,
      slug: draft.journeySlug,
      actor: draft.actor ?? null,
      goal: draft.goal ?? null,
      source: draft.source,
      steps: [],
      interruptions: draft.interruptions ?? null,
    };
    journeys.push(existing);
    mintedNew = true;
  } else {
    // Re-mint: update actor/goal/source/interruptions from the draft.
    existing.actor = draft.actor ?? null;
    existing.goal = draft.goal ?? null;
    existing.source = draft.source;
    existing.interruptions = draft.interruptions ?? existing.interruptions ?? null;
  }

  // Pass 3: steps. Mint JNY-nnn-nnn by slug within this journey.
  // Preserve ids for unchanged slugs; mint fresh for new slugs using
  // the stepHighWaterMark discipline so retired numbers never reuse.
  //
  // stepHighWaterMark lives on the Journey (optional on first mint).
  // We seed it from (a) the recorded field when present, (b) the
  // highest extant step id otherwise, and update it after minting new
  // step ids. A slug removed from a later draft never pulls the mark
  // down; the invariant holds across any number of re-mints.
  const existingStepBySlug = new Map(existing.steps.map((s) => [s.slug, s]));
  const extantHigh = existing.steps.reduce(
    (max, s) => Math.max(max, parseStepNumber(s.id)),
    0,
  );
  const recordedHigh = typeof existing.stepHighWaterMark === 'number'
    ? existing.stepHighWaterMark
    : 0;
  let nextStepNum = Math.max(extantHigh, recordedHigh);
  const newSteps = /** @type {import('./record.js').JourneyStep[]} */ ([]);
  const slugToId = new Map();
  for (const stepDraft of draft.steps) {
    const prior = existingStepBySlug.get(stepDraft.slug);
    let id;
    if (prior) {
      id = prior.id;
    } else {
      nextStepNum += 1;
      id = `${existing.id}-${String(nextStepNum).padStart(3, '0')}`;
      newStepSlugs.push(stepDraft.slug);
    }
    slugToId.set(stepDraft.slug, id);
    newSteps.push({
      id,
      slug: stepDraft.slug,
      kind: stepDraft.kind,
      screenId: screenBySlug.get(stepDraft.screenSlug).id,
      label: stepDraft.label ?? null,
      next: [], // resolved below once slugToId is complete
      returnsTo: null, // resolved below
    });
  }
  // Resolve next/returnsTo slug references to ids now the slugToId map
  // is complete.
  for (let i = 0; i < draft.steps.length; i += 1) {
    const sd = draft.steps[i];
    newSteps[i].next = sd.nextSlugs.map((slug) => {
      const id = slugToId.get(slug);
      if (!id) {
        throw new MintError(`step '${sd.slug}' names next step slug '${slug}', which is not a step in this journey.`);
      }
      return id;
    });
    if (sd.returnsToSlug) {
      const id = slugToId.get(sd.returnsToSlug);
      if (!id) {
        throw new MintError(`step '${sd.slug}' names returnsTo slug '${sd.returnsToSlug}', which is not a step in this journey.`);
      }
      newSteps[i].returnsTo = id;
    }
  }
  existing.steps = newSteps;
  // Carry the high-water forward so a later re-mint of this journey
  // cannot reuse a number this mint produced, even if the slug is
  // removed from the authored source. The field is set unconditionally
  // (even on first mint) so writers can rely on its presence.
  existing.stepHighWaterMark = nextStepNum;

  // If the draft carries interruptions keyed by step slug, resolve
  // the values that look like step slugs to step ids.
  if (draft.interruptions) {
    /** @type {Record<string,string>} */
    const resolved = {};
    for (const [entry, value] of Object.entries(draft.interruptions)) {
      if (typeof value === 'string' && value.startsWith('notApplicable:')) {
        resolved[entry] = value;
      } else if (typeof value === 'string' && slugToId.has(value)) {
        resolved[entry] = slugToId.get(value);
      } else {
        // Pass through unchanged; the record validator will refuse an
        // id that is neither a step id nor notApplicable:.
        resolved[entry] = value;
      }
    }
    existing.interruptions = resolved;
  }

  const nextRecord = {
    ...record,
    screens,
    journeys,
  };
  return {
    record: nextRecord,
    mintedJourney: existing,
    newSlugs: {
      screens: newScreenSlugs,
      steps: newStepSlugs,
      journey: mintedNew,
    },
  };
}

/**
 * Refuse a draft that carries a hand-supplied JNY, JNY-step or SCR
 * id anywhere. mintJourney only ever reads slugs; this check catches
 * a caller that tries to smuggle an id through on a non-draft shape
 * (defence in depth for AC-18902-7).
 *
 * @param {unknown} draft
 */
export function refuseHandSuppliedIds(draft) {
  if (!draft || typeof draft !== 'object') return;
  const seen = /** @type {Set<unknown>} */ (new Set());
  const stack = [draft];
  while (stack.length > 0) {
    const node = stack.pop();
    if (node === null || typeof node !== 'object') continue;
    if (seen.has(node)) continue;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const v of node) stack.push(v);
      continue;
    }
    for (const [k, v] of Object.entries(node)) {
      if (k === 'id' && typeof v === 'string' && (JNY_RE.test(v) || JNY_STEP_RE.test(v) || SCR_RE.test(v))) {
        throw new MintError(`refused: draft carries a hand-supplied id '${v}'. Ids are minted by rcf-lite; drafts carry slugs only.`);
      }
      if (typeof v === 'object' && v !== null) stack.push(v);
    }
  }
}

function parseJnyNumber(id) {
  const m = /^JNY-(\d+)$/.exec(id);
  return m ? Number(m[1]) : 0;
}

function parseStepNumber(id) {
  const m = /^JNY-\d+-(\d+)$/.exec(id);
  return m ? Number(m[1]) : 0;
}

function parseScrNumber(id) {
  const m = /^SCR-(\d+)$/.exec(id);
  return m ? Number(m[1]) : 0;
}
