// Readiness PO phrasebook (viewer UI refresh PR 8, TAC-4133).
//
// One entry per row of the viewer UI refresh design doc section 8's PO
// question table, keyed by check id. Every entry carries the plain
// product-owner wording: `heading` (the PO's question), `ask` (the
// exact ask), `hint` (what kind of answer settles it) and an optional
// `optional` flag for decisions-with-a-default (they do not hold up
// the hand-over).
//
// The phrasebook ships now so the Remi pilot does not wait on DEFINE
// step 3 PR 2's `computeQuestions`. When that shape lands, the
// adapter in `question-adapter.js` switches source via a feature
// detect; the phrasebook stays as the fallback for any blocker whose
// check does not carry a precomputed question.
//
// Strings never contain em-dashes (per the brief and the register
// scan AC-18202-3 the chain pack reserves). Keep this file as plain
// data; no logic.

/**
 * @typedef {object} PhrasebookEntry
 * @property {string} heading       plain question for the PO
 * @property {string} ask           the exact sentence to answer
 * @property {string} hint          what shape of answer settles it
 * @property {boolean} [optional]   decisions-with-a-default rows do not hold up the hand-over
 */

/** @type {Record<string, PhrasebookEntry>} */
export const PHRASEBOOK = {
  'brief:sinceFreeze': {
    heading: 'What is this project for?',
    ask: 'The brief is empty. Hand me your document, or tell me in a few sentences what this is for.',
    hint: 'Answer with a document or a few sentences.',
  },
  'brief:profile': {
    heading: 'How you want to review and who is writing this?',
    ask: 'Where will you look at what we produce (a web page, the running app, or a code review diff), and are you the product owner or an engineer?',
    hint: 'Pick a review surface and a register.',
  },
  'brief:profile:surface': {
    heading: 'Where will you look at what we produce?',
    ask: 'A web page, the running app, or a code review diff?',
    hint: 'Pick one.',
  },
  'brief:profile:register': {
    heading: 'Who is writing this?',
    ask: 'Are you the product owner or an engineer?',
    hint: 'Pick one.',
  },
  'brief:kinds': {
    heading: 'What kind of statement is this?',
    ask: 'Something the product must do, a rule, a person, a thing it tracks, another system, a screen, out of scope, or a question?',
    hint: 'Pick a kind for the statement your document opens with.',
  },
  'brief:openQuestions': {
    heading: 'Your document asks a question.',
    ask: 'Answer now, or record a decision with options and a default?',
    hint: 'Give an answer, or list the options.',
  },
  'skeleton:resolvedBy': {
    heading: 'Does this statement become a requirement?',
    ask: 'Your document carries a capability statement with no home yet. Is this its own requirement, part of an existing one, or something else (a person, a record, another system, a screen, or out of scope)?',
    hint: 'Its own requirement, part of an existing one, something else, or out of scope.',
  },
  'skeleton:reqIntent': {
    heading: 'A requirement needs a plain description.',
    ask: 'What must the product do here, and which part does it belong to?',
    hint: 'One or two plain sentences, and the area.',
  },
  'stories:reqHasUs': {
    heading: 'Who uses this, and what do they do with it?',
    ask: 'Say it as: as a who, I want what, so that why.',
    hint: 'One sentence is enough; the first acceptance criterion is drafted for you.',
  },
  'decisions:wellFormed': {
    heading: 'A decision has no options or default yet.',
    ask: 'What are the choices, and which would you pick?',
    hint: 'List two or three options and name a default.',
    optional: true,
  },
};

/**
 * Look up a phrasebook entry for a check id. Returns a conservative
 * fallback that names the check id when nothing is on file, so a new
 * check added since the design doc still renders a question (the
 * viewer never omits a blocker from the DOM).
 *
 * @param {string} checkId
 * @param {string} [itemId]   id of the failing item (for the fallback)
 * @returns {PhrasebookEntry}
 */
export function phrasebookEntry(checkId, itemId) {
  const entry = PHRASEBOOK[checkId];
  if (entry) return entry;
  const subject = itemId ? ` for ${itemId}` : '';
  return {
    heading: `Something needs an answer${subject}.`,
    ask: `Your tree carries an item from the check ${checkId} that is waiting on you${subject}. Tell me what the right next step is in a sentence.`,
    hint: `No phrasebook entry for ${checkId} yet; answer in plain words and the next session will refine it.`,
  };
}
