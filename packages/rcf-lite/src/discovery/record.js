// Journey record IO for the UX intake gate (REQ-189, TAC-4142,
// ADR-4142). Owns the single on-disk record at
// rcf/discovery/journey.json: constants naming the subtree, a local
// JSON schema validator (rcf-lite-local until rcf-schemas 0.7 lifts
// the FBS journeyStepIds[] field), and a canonical-JSON writer that
// is the ONLY path onto the file.
//
// FBS-210 scope: readJourneyRecord returns null for a tree with no
// record (the grandfathered state) and the record body for an
// existing one; writeJourneyRecord validates in-memory first and then
// writes with trailing newline and 2-space indent (same convention as
// src/define/ledgers.js). FBS-211 later adds the --ui declaration;
// FBS-213 adds the pure discovery check; FBS-214 adds the review
// stamp hash. This module leaves ui, declaredAt, declaredBy,
// declaredVia and review as nullable so later verbs can set them
// without a schema bump.
//
// Node built-ins only.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/** Project-root-relative discovery subtree. The walker never descends
 *  into it (loader subdirFor returns null for 'discovery'); the test
 *  helpers skipping rcf/define/ and rcf/discovery/ cite this constant
 *  as the single source of truth. */
export const DISCOVERY_RELATIVE_DIR = 'rcf/discovery';

/** Project-root-relative path of the record file. */
export const JOURNEY_FILE = 'rcf/discovery/journey.json';

/** Project-root-relative directory for wireframe files (consumed by
 *  FBS-213's wireframe checks; FBS-210 writes nothing here). */
export const WIREFRAMES_DIR = 'rcf/discovery/wireframes';

/** Step kinds the line grammar admits. */
export const STEP_KINDS = /** @type {const} */ (['entry', 'step', 'exit', 'interruption']);

/** UI declaration enum (null before any verb sets it). */
export const UI_VALUES = /** @type {const} */ (['none', 'light', 'central']);

/** declaredVia enum: 'init' is rcf init's seed (FBS-211); 'declare'
 *  is `rcf discover journey declare` (FBS-211); 'intake' is
 *  `rcf discover intake --ui` (FBS-211). FBS-210's add/import leave
 *  the field unchanged. */
export const DECLARED_VIA_VALUES = /** @type {const} */ (['init', 'declare', 'intake']);

const JNY_RE = /^JNY-\d{3,}$/;
const JNY_STEP_RE = /^JNY-\d{3,}-\d{3,}$/;
const SCR_RE = /^SCR-\d{3,}$/;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Local schema version. Lifted into rcf-schemas on 0.7. */
export const SCHEMA_VERSION = 1;

/** Error thrown by the record's own validation. */
export class JourneyRecordError extends Error {
  /**
   * @param {string} message
   * @param {object} [opts]
   * @param {string} [opts.filePath]
   * @param {string} [opts.code]
   * @param {string} [opts.pointer]
   */
  constructor(message, opts = {}) {
    super(message);
    this.name = 'JourneyRecordError';
    this.filePath = opts.filePath ?? JOURNEY_FILE;
    this.code = opts.code ?? 'validation';
    if (opts.pointer) this.pointer = opts.pointer;
  }
}

/**
 * Produce an empty-but-valid record. Used by callers that need to
 * seed a brand-new tree. FBS-211's declare / init / intake flows use
 * this; FBS-210's add verb falls back on it when the file is absent
 * so that a new project can author a journey before declaring the UI
 * posture (the ui field stays null; FBS-213's D0 then fails
 * discovery:declared with a plain reason until declare runs).
 *
 * @returns {JourneyRecord}
 */
export function emptyJourneyRecord() {
  return {
    version: SCHEMA_VERSION,
    ui: null,
    declaredAt: null,
    declaredBy: null,
    declaredReason: null,
    declaredVia: null,
    asBuilt: false,
    screens: [],
    journeys: [],
    review: null,
  };
}

/**
 * Validate a record body against the local schema. Throws
 * JourneyRecordError with a JSON pointer on the first failure; return
 * value is the input body on success (never a clone - callers are
 * responsible for not mutating validated data).
 *
 * additionalProperties-false enforcement is explicit: every key that
 * is not in the known field set is a failure. The pointer uses the
 * JSON-pointer form the ledger loader uses so error strings read the
 * same across the two sidecars.
 *
 * @param {unknown} body
 * @returns {JourneyRecord}
 */
export function validateJourneyRecord(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new JourneyRecordError('journey.json: body must be a JSON object.', { pointer: '/' });
  }
  const rec = /** @type {Record<string, unknown>} */ (body);
  const allowedTop = new Set([
    'version', 'ui', 'declaredAt', 'declaredBy', 'declaredReason', 'declaredVia', 'asBuilt',
    'screens', 'journeys', 'review',
  ]);
  for (const key of Object.keys(rec)) {
    if (!allowedTop.has(key)) {
      throw new JourneyRecordError(`journey.json: unknown top-level field '${key}'.`, { pointer: `/${key}` });
    }
  }
  if (rec.version !== SCHEMA_VERSION) {
    throw new JourneyRecordError(`journey.json: version must be ${SCHEMA_VERSION} (got ${JSON.stringify(rec.version)}).`, { pointer: '/version' });
  }
  if (rec.ui !== null && !UI_VALUES.includes(/** @type {any} */ (rec.ui))) {
    throw new JourneyRecordError(`journey.json: ui must be null or one of ${UI_VALUES.join(', ')}.`, { pointer: '/ui' });
  }
  if (rec.declaredAt !== null && typeof rec.declaredAt !== 'string') {
    throw new JourneyRecordError('journey.json: declaredAt must be a string or null.', { pointer: '/declaredAt' });
  }
  if (rec.declaredBy !== null && typeof rec.declaredBy !== 'string') {
    throw new JourneyRecordError('journey.json: declaredBy must be a string or null.', { pointer: '/declaredBy' });
  }
  if (rec.declaredReason !== null && typeof rec.declaredReason !== 'string') {
    throw new JourneyRecordError('journey.json: declaredReason must be a string or null.', { pointer: '/declaredReason' });
  }
  if (rec.declaredVia !== null && !DECLARED_VIA_VALUES.includes(/** @type {any} */ (rec.declaredVia))) {
    throw new JourneyRecordError(`journey.json: declaredVia must be null or one of ${DECLARED_VIA_VALUES.join(', ')}.`, { pointer: '/declaredVia' });
  }
  if (typeof rec.asBuilt !== 'boolean') {
    throw new JourneyRecordError('journey.json: asBuilt must be a boolean.', { pointer: '/asBuilt' });
  }
  if (!Array.isArray(rec.screens)) {
    throw new JourneyRecordError('journey.json: screens must be an array.', { pointer: '/screens' });
  }
  if (!Array.isArray(rec.journeys)) {
    throw new JourneyRecordError('journey.json: journeys must be an array.', { pointer: '/journeys' });
  }
  const screenIds = new Set();
  const screenSlugs = new Set();
  for (let i = 0; i < rec.screens.length; i += 1) {
    validateScreen(rec.screens[i], `/screens/${i}`, screenIds, screenSlugs);
  }
  const journeyIds = new Set();
  const journeySlugs = new Set();
  for (let i = 0; i < rec.journeys.length; i += 1) {
    validateJourney(rec.journeys[i], `/journeys/${i}`, journeyIds, journeySlugs, screenIds);
  }
  if (rec.review !== null) {
    validateReview(rec.review, '/review');
  }
  return /** @type {JourneyRecord} */ (body);
}

const SCREEN_ALLOWED = new Set(['id', 'slug', 'title', 'wireframe', 'references']);

function validateScreen(screen, pointer, idSet, slugSet) {
  if (screen === null || typeof screen !== 'object' || Array.isArray(screen)) {
    throw new JourneyRecordError(`journey.json: screen at ${pointer} must be an object.`, { pointer });
  }
  const s = /** @type {Record<string, unknown>} */ (screen);
  for (const key of Object.keys(s)) {
    if (!SCREEN_ALLOWED.has(key)) {
      throw new JourneyRecordError(`journey.json: screen at ${pointer} has unknown field '${key}'.`, { pointer: `${pointer}/${key}` });
    }
  }
  if (typeof s.id !== 'string' || !SCR_RE.test(s.id)) {
    throw new JourneyRecordError(`journey.json: screen id at ${pointer}/id must match SCR-nnn (got ${JSON.stringify(s.id)}).`, { pointer: `${pointer}/id` });
  }
  if (idSet.has(s.id)) {
    throw new JourneyRecordError(`journey.json: duplicate screen id ${s.id} at ${pointer}.`, { pointer: `${pointer}/id` });
  }
  idSet.add(s.id);
  if (typeof s.slug !== 'string' || !SLUG_RE.test(s.slug)) {
    throw new JourneyRecordError(`journey.json: screen slug at ${pointer}/slug must be lower-case kebab (got ${JSON.stringify(s.slug)}).`, { pointer: `${pointer}/slug` });
  }
  if (slugSet.has(s.slug)) {
    throw new JourneyRecordError(`journey.json: duplicate screen slug ${s.slug} at ${pointer}.`, { pointer: `${pointer}/slug` });
  }
  slugSet.add(s.slug);
  if (s.title !== null && typeof s.title !== 'string') {
    throw new JourneyRecordError(`journey.json: screen title at ${pointer}/title must be a string or null.`, { pointer: `${pointer}/title` });
  }
  if (s.wireframe !== null) {
    if (typeof s.wireframe !== 'string') {
      throw new JourneyRecordError(`journey.json: screen wireframe at ${pointer}/wireframe must be a repo-relative path or null.`, { pointer: `${pointer}/wireframe` });
    }
    if (/^(?:https?:|\/\/|mailto:|data:)/i.test(s.wireframe)) {
      throw new JourneyRecordError(`journey.json: screen wireframe at ${pointer}/wireframe is a URL (${s.wireframe}); wireframes are files under rcf/discovery/wireframes/, not links. Mid-fi links belong on Screen.references.`, { pointer: `${pointer}/wireframe` });
    }
  }
  if (!Array.isArray(s.references)) {
    throw new JourneyRecordError(`journey.json: screen references at ${pointer}/references must be an array.`, { pointer: `${pointer}/references` });
  }
  for (let r = 0; r < s.references.length; r += 1) {
    if (typeof s.references[r] !== 'string') {
      throw new JourneyRecordError(`journey.json: screen reference at ${pointer}/references/${r} must be a string.`, { pointer: `${pointer}/references/${r}` });
    }
  }
}

const JOURNEY_ALLOWED = new Set(['id', 'slug', 'actor', 'goal', 'source', 'steps', 'interruptions', 'stepHighWaterMark']);

function validateJourney(journey, pointer, idSet, slugSet, screenIds) {
  if (journey === null || typeof journey !== 'object' || Array.isArray(journey)) {
    throw new JourneyRecordError(`journey.json: journey at ${pointer} must be an object.`, { pointer });
  }
  const j = /** @type {Record<string, unknown>} */ (journey);
  for (const key of Object.keys(j)) {
    if (!JOURNEY_ALLOWED.has(key)) {
      throw new JourneyRecordError(`journey.json: journey at ${pointer} has unknown field '${key}'.`, { pointer: `${pointer}/${key}` });
    }
  }
  if (typeof j.id !== 'string' || !JNY_RE.test(j.id)) {
    throw new JourneyRecordError(`journey.json: journey id at ${pointer}/id must match JNY-nnn (got ${JSON.stringify(j.id)}).`, { pointer: `${pointer}/id` });
  }
  if (idSet.has(j.id)) {
    throw new JourneyRecordError(`journey.json: duplicate journey id ${j.id} at ${pointer}.`, { pointer: `${pointer}/id` });
  }
  idSet.add(j.id);
  if (typeof j.slug !== 'string' || !SLUG_RE.test(j.slug)) {
    throw new JourneyRecordError(`journey.json: journey slug at ${pointer}/slug must be lower-case kebab (got ${JSON.stringify(j.slug)}).`, { pointer: `${pointer}/slug` });
  }
  if (slugSet.has(j.slug)) {
    throw new JourneyRecordError(`journey.json: duplicate journey slug ${j.slug} at ${pointer}.`, { pointer: `${pointer}/slug` });
  }
  slugSet.add(j.slug);
  if (j.actor !== null && typeof j.actor !== 'string') {
    throw new JourneyRecordError(`journey.json: journey actor at ${pointer}/actor must be a string or null.`, { pointer: `${pointer}/actor` });
  }
  if (j.goal !== null && typeof j.goal !== 'string') {
    throw new JourneyRecordError(`journey.json: journey goal at ${pointer}/goal must be a string or null.`, { pointer: `${pointer}/goal` });
  }
  if (typeof j.source !== 'string' || j.source.length === 0) {
    throw new JourneyRecordError(`journey.json: journey source at ${pointer}/source must be a non-empty string (the authored file path).`, { pointer: `${pointer}/source` });
  }
  if ('stepHighWaterMark' in j) {
    if (typeof j.stepHighWaterMark !== 'number' || !Number.isInteger(j.stepHighWaterMark) || j.stepHighWaterMark < 0) {
      throw new JourneyRecordError(`journey.json: journey stepHighWaterMark at ${pointer}/stepHighWaterMark must be a non-negative integer (got ${JSON.stringify(j.stepHighWaterMark)}).`, { pointer: `${pointer}/stepHighWaterMark` });
    }
  }
  if (!Array.isArray(j.steps)) {
    throw new JourneyRecordError(`journey.json: journey steps at ${pointer}/steps must be an array.`, { pointer: `${pointer}/steps` });
  }
  const stepIds = new Set();
  const stepSlugs = new Set();
  for (let i = 0; i < j.steps.length; i += 1) {
    validateStep(j.steps[i], `${pointer}/steps/${i}`, stepIds, stepSlugs, screenIds, j.id);
  }
  for (let i = 0; i < j.steps.length; i += 1) {
    const step = /** @type {Record<string, unknown>} */ (j.steps[i]);
    const next = /** @type {unknown[]} */ (step.next);
    for (let n = 0; n < next.length; n += 1) {
      if (typeof next[n] !== 'string' || !stepIds.has(next[n])) {
        throw new JourneyRecordError(`journey.json: step next at ${pointer}/steps/${i}/next/${n} must name a step id in this journey (got ${JSON.stringify(next[n])}).`, { pointer: `${pointer}/steps/${i}/next/${n}` });
      }
    }
    if (step.returnsTo !== null && (typeof step.returnsTo !== 'string' || !stepIds.has(step.returnsTo))) {
      throw new JourneyRecordError(`journey.json: step returnsTo at ${pointer}/steps/${i}/returnsTo must name a step id in this journey or null.`, { pointer: `${pointer}/steps/${i}/returnsTo` });
    }
  }
  if (j.interruptions !== null && j.interruptions !== undefined) {
    if (typeof j.interruptions !== 'object' || Array.isArray(j.interruptions)) {
      throw new JourneyRecordError(`journey.json: journey interruptions at ${pointer}/interruptions must be an object or null.`, { pointer: `${pointer}/interruptions` });
    }
    const interr = /** @type {Record<string, unknown>} */ (j.interruptions);
    for (const [entry, value] of Object.entries(interr)) {
      if (typeof entry !== 'string' || entry.length === 0) {
        throw new JourneyRecordError(`journey.json: interruption key at ${pointer}/interruptions must be a non-empty string.`, { pointer: `${pointer}/interruptions` });
      }
      if (typeof value === 'string') {
        if (!stepIds.has(value) && !/^notApplicable:/.test(value)) {
          throw new JourneyRecordError(`journey.json: interruption '${entry}' at ${pointer}/interruptions must name a step id in this journey or 'notApplicable:<reason>' (got ${JSON.stringify(value)}).`, { pointer: `${pointer}/interruptions/${entry}` });
        }
      } else {
        throw new JourneyRecordError(`journey.json: interruption '${entry}' at ${pointer}/interruptions must be a string.`, { pointer: `${pointer}/interruptions/${entry}` });
      }
    }
  }
}

const STEP_ALLOWED = new Set(['id', 'slug', 'kind', 'screenId', 'label', 'next', 'returnsTo']);

function validateStep(step, pointer, idSet, slugSet, screenIds, journeyId) {
  if (step === null || typeof step !== 'object' || Array.isArray(step)) {
    throw new JourneyRecordError(`journey.json: step at ${pointer} must be an object.`, { pointer });
  }
  const s = /** @type {Record<string, unknown>} */ (step);
  for (const key of Object.keys(s)) {
    if (!STEP_ALLOWED.has(key)) {
      throw new JourneyRecordError(`journey.json: step at ${pointer} has unknown field '${key}'.`, { pointer: `${pointer}/${key}` });
    }
  }
  if (typeof s.id !== 'string' || !JNY_STEP_RE.test(s.id)) {
    throw new JourneyRecordError(`journey.json: step id at ${pointer}/id must match JNY-nnn-nnn (got ${JSON.stringify(s.id)}).`, { pointer: `${pointer}/id` });
  }
  const expectedPrefix = `${journeyId}-`;
  if (!s.id.startsWith(expectedPrefix)) {
    throw new JourneyRecordError(`journey.json: step id ${s.id} at ${pointer} must share its parent journey's prefix (${expectedPrefix}).`, { pointer: `${pointer}/id` });
  }
  if (idSet.has(s.id)) {
    throw new JourneyRecordError(`journey.json: duplicate step id ${s.id} at ${pointer}.`, { pointer: `${pointer}/id` });
  }
  idSet.add(s.id);
  if (typeof s.slug !== 'string' || !SLUG_RE.test(s.slug)) {
    throw new JourneyRecordError(`journey.json: step slug at ${pointer}/slug must be lower-case kebab (got ${JSON.stringify(s.slug)}).`, { pointer: `${pointer}/slug` });
  }
  if (slugSet.has(s.slug)) {
    throw new JourneyRecordError(`journey.json: duplicate step slug ${s.slug} at ${pointer}.`, { pointer: `${pointer}/slug` });
  }
  slugSet.add(s.slug);
  if (typeof s.kind !== 'string' || !STEP_KINDS.includes(/** @type {any} */ (s.kind))) {
    throw new JourneyRecordError(`journey.json: step kind at ${pointer}/kind must be one of ${STEP_KINDS.join(', ')} (got ${JSON.stringify(s.kind)}).`, { pointer: `${pointer}/kind` });
  }
  if (typeof s.screenId !== 'string' || !SCR_RE.test(s.screenId)) {
    throw new JourneyRecordError(`journey.json: step screenId at ${pointer}/screenId must match SCR-nnn (got ${JSON.stringify(s.screenId)}).`, { pointer: `${pointer}/screenId` });
  }
  if (!screenIds.has(s.screenId)) {
    throw new JourneyRecordError(`journey.json: step screenId at ${pointer}/screenId names ${s.screenId}, which is not a declared screen.`, { pointer: `${pointer}/screenId` });
  }
  if (s.label !== null && typeof s.label !== 'string') {
    throw new JourneyRecordError(`journey.json: step label at ${pointer}/label must be a string or null.`, { pointer: `${pointer}/label` });
  }
  if (!Array.isArray(s.next)) {
    throw new JourneyRecordError(`journey.json: step next at ${pointer}/next must be an array of step ids.`, { pointer: `${pointer}/next` });
  }
  if (!('returnsTo' in s)) {
    throw new JourneyRecordError(`journey.json: step at ${pointer} must carry returnsTo (null when the step is not an interruption).`, { pointer: `${pointer}/returnsTo` });
  }
}

const REVIEW_ALLOWED = new Set(['state', 'by', 'note', 'at', 'wireframeHashes']);

function validateReview(review, pointer) {
  if (typeof review !== 'object' || Array.isArray(review)) {
    throw new JourneyRecordError(`journey.json: review at ${pointer} must be an object or null.`, { pointer });
  }
  const r = /** @type {Record<string, unknown>} */ (review);
  for (const key of Object.keys(r)) {
    if (!REVIEW_ALLOWED.has(key)) {
      throw new JourneyRecordError(`journey.json: review at ${pointer} has unknown field '${key}'.`, { pointer: `${pointer}/${key}` });
    }
  }
  if (r.state !== 'reviewed') {
    throw new JourneyRecordError(`journey.json: review state at ${pointer}/state must be 'reviewed' (got ${JSON.stringify(r.state)}).`, { pointer: `${pointer}/state` });
  }
}

/**
 * Read the record from a project root. Returns null when the file is
 * absent (the grandfathered state); throws JourneyRecordError on
 * parse or schema failure.
 *
 * @param {string} projectRoot
 * @returns {Promise<JourneyRecord | null>}
 */
export async function readJourneyRecord(projectRoot) {
  const filePath = join(projectRoot, JOURNEY_FILE);
  let raw;
  try {
    raw = await readFile(filePath, 'utf8');
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') return null;
    throw new JourneyRecordError(
      `Failed to read ${JOURNEY_FILE}: ${/** @type {Error} */ (err).message}`,
      { code: 'ioFailure' },
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new JourneyRecordError(
      `${JOURNEY_FILE} parse failed: ${/** @type {Error} */ (err).message}`,
      { code: 'parseFailure' },
    );
  }
  // FBS-211 (ADR-4145): a record written by main at e2a80f08 (FBS-210)
  // has no declaredReason field. Normalise an absent declaredReason to
  // null on read so a main-shape record passes the FBS-211 schema. The
  // writer path keeps the strict shape - validateJourneyRecord still
  // refuses an undefined declaredReason, so a bad write cannot land.
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      && !Object.prototype.hasOwnProperty.call(parsed, 'declaredReason')) {
    parsed.declaredReason = null;
  }
  return validateJourneyRecord(parsed);
}

/**
 * Write the record. Validates in-memory first; a bad body never
 * lands as JSON. Returns the absolute file path. The directory is
 * created on first write.
 *
 * The on-disk form is a 2-space-indented JSON object with a trailing
 * newline, matching the ledger-sidecar convention
 * (src/define/ledgers.js saveLedger). This is the "canonical-JSON
 * writer" named in ADR-4120 and the TAC: the formatting is
 * deterministic byte-for-byte, so --dry-run (FBS-210 AC-6) can
 * guarantee the file is byte-identical before and after.
 *
 * @param {object} args
 * @param {string} args.projectRoot
 * @param {unknown} args.record
 * @returns {Promise<{ filePath: string }>}
 */
export async function writeJourneyRecord({ projectRoot, record }) {
  const validated = validateJourneyRecord(record);
  const filePath = join(projectRoot, JOURNEY_FILE);
  await mkdir(dirname(filePath), { recursive: true });
  const canonical = `${JSON.stringify(validated, null, 2)}\n`;
  await writeFile(filePath, canonical, 'utf8');
  return { filePath };
}

/**
 * Serialise a record to the exact byte string writeJourneyRecord
 * would write. Pure, no io; used by --dry-run to prove the planned
 * write is a no-op without touching disk.
 *
 * @param {unknown} record
 * @returns {string}
 */
export function serialiseJourneyRecord(record) {
  const validated = validateJourneyRecord(record);
  return `${JSON.stringify(validated, null, 2)}\n`;
}

/**
 * @typedef {object} Screen
 * @property {string} id              SCR-nnn
 * @property {string} slug            kebab
 * @property {string | null} title
 * @property {string | null} wireframe  repo-relative path under rcf/discovery/wireframes, never a URL
 * @property {string[]} references    mid-fi URLs; never satisfy any check
 */

/**
 * @typedef {object} JourneyStep
 * @property {string} id              JNY-nnn-nnn
 * @property {string} slug
 * @property {'entry'|'step'|'exit'|'interruption'} kind
 * @property {string} screenId        SCR-nnn
 * @property {string | null} label
 * @property {string[]} next          step ids within this journey
 * @property {string | null} returnsTo step id within this journey (interruption only)
 */

/**
 * @typedef {object} Journey
 * @property {string} id              JNY-nnn
 * @property {string} slug
 * @property {string | null} actor
 * @property {string | null} goal
 * @property {string} source          repo-relative authored path
 * @property {JourneyStep[]} steps
 * @property {Record<string, string> | null} interruptions
 */

/**
 * @typedef {object} ReviewStamp
 * @property {'reviewed'} state
 * @property {string} [by]
 * @property {string} [note]
 * @property {{ time: string, hash: string }} [at]
 * @property {Record<string, string>} [wireframeHashes]
 */

/**
 * @typedef {object} JourneyRecord
 * @property {number} version
 * @property {'none'|'light'|'central'|null} ui
 * @property {string | null} declaredAt
 * @property {string | null} declaredBy
 * @property {string | null} declaredReason
 * @property {'init'|'declare'|'intake'|null} declaredVia
 * @property {boolean} asBuilt
 * @property {Screen[]} screens
 * @property {Journey[]} journeys
 * @property {ReviewStamp | null} review
 */
