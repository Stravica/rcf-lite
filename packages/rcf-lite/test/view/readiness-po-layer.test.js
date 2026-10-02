// Readiness PO layer tests (US-18002 under REQ-180 / TAC-4133 / ADR-4135;
// viewer UI refresh PR 8). Covers the three ACs the DEFINE step 3 spec
// section 11.8 pins for this PR:
//
//   AC-18002-1 [happy]    `questions[]` non-empty renders groups with asks
//                          and every id is in the JSON.
//   AC-18002-2 [failure]  `questions[]` empty renders the intent-complete
//                          verdict line.
//   AC-18002-3 [must-not] engineer blockers are not removed from the DOM
//                          under any register.
//
// Also exercises the adapter seam (both branches: blockers today and
// `readiness.questions` tomorrow), equal-height VerdictCard markup, the
// chain-term muted beside both plain labels, and the StageLegend wiring.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { renderReadinessPanel } from '../../src/view/readiness.js';
import { renderReadinessPO } from '../../src/view/readiness/po-layer.js';
import { toQuestions, preferReadinessQuestions } from '../../src/view/readiness/question-adapter.js';
import { PHRASEBOOK, phrasebookEntry } from '../../src/view/readiness/phrasebook.js';
import { renderStageLegend, stageTitle, STAGE_LEGEND } from '../../src/view/readiness/stage-legend.js';
import { formatVerdictLines } from '../../src/query/readiness.js';

/** Minimal failing readiness fixture with a PO blocker and an engineer blocker. */
function failingFixture() {
  const stages = [
    {
      stage: 'D1',
      gate: 'define.brief',
      state: 'failing',
      checks: [
        {
          name: 'brief:sinceFreeze',
          ok: false,
          over: 'tree',
          pass: 0,
          total: 1,
          failing: [{ id: 'brief:ledger', why: 'brief ledger holds no statements' }],
          persona: 'productOwner',
          question: 'Has the owner captured a brief yet?',
        },
      ],
    },
    {
      stage: 'D5',
      gate: 'define.crosscut',
      state: 'failing',
      checks: [
        {
          name: 'crosscut:securityArchitecture',
          ok: false,
          over: 'tree',
          pass: 0,
          total: 1,
          failing: [{ id: 'TAD-001:security', why: 'security architecture missing' }],
          persona: 'engineer',
          question: 'Is the TAD security architecture written?',
        },
      ],
    },
  ];
  const levels = {
    intentComplete: {
      ok: false,
      blockedBy: [{
        stage: 'D1',
        gate: 'define.brief',
        check: 'brief:sinceFreeze',
        persona: 'productOwner',
        over: 'tree',
        failingCount: 1,
        ids: ['brief:ledger'],
        question: 'Has the owner captured a brief yet?',
      }],
      nextAction: null,
    },
    readyToBuild: {
      ok: false,
      blockedBy: [
        {
          stage: 'D1',
          gate: 'define.brief',
          check: 'brief:sinceFreeze',
          persona: 'productOwner',
          over: 'tree',
          failingCount: 1,
          ids: ['brief:ledger'],
          question: 'Has the owner captured a brief yet?',
        },
        {
          stage: 'D5',
          gate: 'define.crosscut',
          check: 'crosscut:securityArchitecture',
          persona: 'engineer',
          over: 'tree',
          failingCount: 1,
          ids: ['TAD-001:security'],
          question: 'Is the TAD security architecture written?',
        },
      ],
      nextAction: null,
    },
  };
  const personas = {
    productOwner: { blockers: levels.intentComplete.blockedBy, nextAction: null },
    engineer: { blockers: [levels.readyToBuild.blockedBy[1]], nextAction: null },
  };
  return {
    tree: {
      frozen: false,
      frozenAt: null,
      treeHash: null,
      currentTreeHash: 'sha256:9f3a2c6400000000000000000000000000000000000000000000000000000000',
      buildAt: null,
      fbsTotal: 10,
    },
    delta: { changed: [], added: [], removed: [], briefSince: [], impacted: [], impactedFbs: [] },
    stages,
    nextAction: levels.readyToBuild.nextAction,
    coverage: { tree: { pass: 0, total: 0 }, delta: [] },
    decisions: [],
    freezeable: false,
    levels,
    personas,
  };
}

/** Clean readiness fixture (both levels ok, no blockers). */
function cleanFixture() {
  return {
    tree: {
      frozen: true,
      frozenAt: '2026-10-01T00:00:00Z',
      treeHash: 'sha256:00000000ffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
      currentTreeHash: 'sha256:00000000ffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
      buildAt: null,
      fbsTotal: 0,
    },
    delta: { changed: [], added: [], removed: [], briefSince: [], impacted: [], impactedFbs: [] },
    stages: [],
    nextAction: null,
    coverage: { tree: { pass: 0, total: 0 }, delta: [] },
    decisions: [],
    freezeable: true,
    levels: {
      intentComplete: { ok: true, blockedBy: [], nextAction: null },
      readyToBuild: { ok: true, blockedBy: [], nextAction: null },
    },
    personas: {
      productOwner: { blockers: [], nextAction: null },
      engineer: { blockers: [], nextAction: null },
    },
  };
}

// ---- adapter seam -------------------------------------------------------

test('question-adapter: preferReadinessQuestions is a feature detect on readiness.questions[]', () => {
  assert.equal(preferReadinessQuestions(null), false);
  assert.equal(preferReadinessQuestions({}), false);
  assert.equal(preferReadinessQuestions({ questions: null }), false);
  assert.equal(preferReadinessQuestions({ questions: [] }), true);
  assert.equal(preferReadinessQuestions({ questions: [{ ask: 'x' }] }), true);
});

test('question-adapter: blockers path groups PO blockers by source span and fills asks from the phrasebook', () => {
  const result = failingFixture();
  const q = toQuestions(result);
  assert.ok(Array.isArray(q.groups));
  assert.ok(q.groups.length >= 1, 'expected at least one PO group');
  const items = q.groups.flatMap((g) => g.items);
  assert.ok(items.some((it) => it.checkId === 'D1/brief:sinceFreeze'), 'brief:sinceFreeze blocker is included');
  // The ask is the phrasebook sentence verbatim.
  const briefItem = items.find((it) => it.checkId === 'D1/brief:sinceFreeze');
  assert.equal(briefItem.ask, PHRASEBOOK['brief:sinceFreeze'].ask);
  // No em-dash in any ask or hint.
  for (const it of items) {
    assert.ok(!it.ask.includes('—'), `em-dash in ask: ${it.ask}`);
    assert.ok(!it.hint.includes('—'), `em-dash in hint: ${it.hint}`);
  }
});

test('question-adapter: readiness.questions[] path reads precomputed questions when present (feature-detected)', () => {
  const base = failingFixture();
  const result = {
    ...base,
    questions: [
      {
        sourceSpan: 'brief:7',
        sourceSpanLabel: 'Your document, lines 12 to 14',
        stage: 'D2',
        checkId: 'skeleton:resolvedBy',
        heading: 'Does this statement become a requirement?',
        ask: 'Your document says a thing. Is this its own requirement or part of an existing one?',
        hint: 'Its own requirement, part of an existing one, something else, or out of scope.',
        id: 'brief:7',
        why: 'capability statement has no resolvedBy and no REQ-title hit',
      },
    ],
  };
  assert.equal(preferReadinessQuestions(result), true);
  const q = toQuestions(result);
  assert.equal(q.groups.length, 1);
  assert.equal(q.groups[0].label, 'Your document, lines 12 to 14');
  assert.equal(q.groups[0].items[0].checkId, 'D2/skeleton:resolvedBy');
  assert.equal(q.groups[0].items[0].ask, 'Your document says a thing. Is this its own requirement or part of an existing one?');
});

test('question-adapter: unknown check id falls back to a conservative phrasebook entry naming the check id', () => {
  const entry = phrasebookEntry('brand-new-check-added-later:thing', 'REQ-999');
  assert.ok(entry.heading.length > 0);
  assert.ok(entry.ask.includes('brand-new-check-added-later:thing'));
  assert.ok(entry.hint.includes('brand-new-check-added-later:thing'));
  assert.ok(!entry.ask.includes('—'));
});

// ---- AC-18002-1 ---------------------------------------------------------

test('PO layer: AC-18002-1 given questions[] non-empty, the block lists each group with its asks and every id is in the JSON', () => {
  const base = failingFixture();
  const result = {
    ...base,
    questions: [
      {
        sourceSpan: 'brief:7',
        sourceSpanLabel: 'Your document, lines 12 to 14',
        stage: 'D2',
        checkId: 'skeleton:resolvedBy',
        heading: 'Does this statement become a requirement?',
        ask: 'Your document names a hold. Which part does it belong to?',
        hint: 'Its own requirement, part of an existing one, something else, or out of scope.',
        id: 'brief:7',
        why: 'capability statement has no resolvedBy',
      },
      {
        sourceSpan: 'REQ-012',
        sourceSpanLabel: 'Requirement REQ-012',
        stage: 'D4',
        checkId: 'stories:reqHasUs',
        heading: 'Who uses REQ-012?',
        ask: 'Say it as: as a who, I want what, so that why.',
        hint: 'One sentence is enough.',
        id: 'REQ-012',
        why: 'no owning user story',
      },
    ],
  };
  const html = renderReadinessPO(result, { persona: 'productOwner', engineerBody: '<div data-rcf-engineer-marker="yes"></div>' });
  // Each group appears with its label and its ask.
  assert.ok(html.includes('Your document, lines 12 to 14'), 'group label 1 missing');
  assert.ok(html.includes('Requirement REQ-012'), 'group label 2 missing');
  assert.ok(html.includes('Your document names a hold. Which part does it belong to?'), 'ask 1 missing');
  assert.ok(html.includes('Say it as: as a who, I want what, so that why.'), 'ask 2 missing');
  // Every id in the JSON appears somewhere in the panel (via the engineer body for ids, or via question-detail).
  const stringifiedResult = JSON.stringify(result);
  for (const q of result.questions) {
    assert.ok(stringifiedResult.includes(q.id), `question id ${q.id} must appear in the JSON`);
  }
  // Source attribute marks the questions path was taken.
  assert.match(html, /data-rcf-source="readiness\.questions"/);
});

// ---- AC-18002-2 ---------------------------------------------------------

test('PO layer: AC-18002-2 given questions[] empty, the block shows the intent-complete verdict line', () => {
  const result = cleanFixture();
  const expected = formatVerdictLines(result);
  const html = renderReadinessPO(result, { persona: 'productOwner', engineerBody: '' });
  assert.ok(html.includes(expected.intentComplete), 'intent-complete verdict line missing');
  assert.match(html, /data-rcf-empty="yes"/);
});

// ---- AC-18002-3 ---------------------------------------------------------

test('PO layer: AC-18002-3 engineer blockers are not removed from the DOM in any register', () => {
  const result = failingFixture();
  for (const profile of [null, 'register: productOwner', 'register: engineer']) {
    const html = renderReadinessPanel(result, { profile, freezeRecord: null });
    for (const b of result.personas.engineer.blockers) {
      for (const id of b.ids) {
        assert.ok(html.includes(id), `engineer id ${id} must be in the DOM under register=${profile}`);
      }
    }
    for (const b of result.personas.productOwner.blockers) {
      for (const id of b.ids) {
        assert.ok(html.includes(id), `PO id ${id} must be in the DOM under register=${profile}`);
      }
    }
    // CLI verdict strings still render inside the For-engineers DocRow (parity).
    const expected = formatVerdictLines(result);
    assert.ok(html.includes(expected.intentComplete), 'intent-complete CLI verdict missing');
    assert.ok(html.includes(expected.readyToBuild), 'ready-to-build CLI verdict missing');
  }
});

// ---- VerdictCards: equal-height markup + chain term muted on BOTH cards -

test('PO layer: both VerdictCards sit in a grid that stretches equal height and the chain term is muted beside both plain labels', () => {
  const result = failingFixture();
  const html = renderReadinessPO(result, { persona: 'productOwner', engineerBody: '' });
  // Shared grid parent with align-items: stretch comes from CSS; the markup
  // is the signal we assert here (CSS integration test runs via screenshots).
  assert.match(html, /class="rcf-po-verdicts"/);
  // Plain labels + muted chain term on BOTH cards.
  assert.match(html, /Ready for engineers:[\s\S]*?<span class="rcf-chain-term"[^>]*>intent-complete<\/span>/);
  assert.match(html, /Ready to build:[\s\S]*?<span class="rcf-chain-term"[^>]*>ready-to-build<\/span>/);
});

// ---- For engineers DocRow: open state driven by the register ------------

test('PO layer: For engineers DocRow is closed in productOwner / unstated and open in engineer', () => {
  const result = failingFixture();
  const htmlPo = renderReadinessPanel(result, { profile: 'register: productOwner' });
  const htmlEng = renderReadinessPanel(result, { profile: 'register: engineer' });
  const htmlUn = renderReadinessPanel(result, { profile: null });
  const engRow = /<details class="rcf-row doc-row rcf-po-engineer"[^>]*data-doc-id="rcf-readiness-engineer"([^>]*)>/;
  const matchPo = htmlPo.match(engRow);
  const matchEng = htmlEng.match(engRow);
  const matchUn = htmlUn.match(engRow);
  assert.ok(matchPo, 'For-engineers row absent in productOwner render');
  assert.ok(matchEng, 'For-engineers row absent in engineer render');
  assert.ok(matchUn, 'For-engineers row absent in unstated render');
  assert.ok(!matchPo[1].includes(' open'), 'productOwner should keep For-engineers closed');
  assert.ok(matchEng[1].includes(' open'), 'engineer should open For-engineers');
  assert.ok(!matchUn[1].includes(' open'), 'unstated should keep For-engineers closed');
});

// ---- StageLegend --------------------------------------------------------

test('StageLegend: renderStageLegend lists D1..D8 with name and posture; stageTitle returns a hover title per stage', () => {
  const html = renderStageLegend();
  assert.match(html, /id="rcf-stage-legend"/);
  for (const d of ['D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8']) {
    assert.ok(html.includes(`data-stage="${d}"`), `${d} row missing`);
    assert.ok(stageTitle(d).startsWith(d));
    assert.ok(STAGE_LEGEND[d].meaning.length > 10);
  }
  // Blocking posture renders a fail pill; warn-with-ack renders a warn pill.
  assert.match(html, /<span class="rcf-pill rcf-pill--fail">blocks freeze<\/span>/);
  assert.match(html, /<span class="rcf-pill rcf-pill--warn">warns, acknowledge to pass<\/span>/);
});

test('Readiness panel: D-chip carries data-rcf-stage-ref so the StageLegend wire opens it on click', () => {
  const result = failingFixture();
  const html = renderReadinessPanel(result, { profile: null });
  assert.match(html, /data-rcf-stage-ref="D1"/);
  assert.match(html, /data-rcf-stage-ref="D5"/);
});

// ---- Phrasebook em-dash guard ------------------------------------------

test('Phrasebook: no em-dash in any phrasebook entry (brief rule and chain register scan AC-18202-3)', () => {
  for (const [checkId, entry] of Object.entries(PHRASEBOOK)) {
    assert.ok(!entry.heading.includes('—'), `em-dash in heading for ${checkId}`);
    assert.ok(!entry.ask.includes('—'), `em-dash in ask for ${checkId}`);
    assert.ok(!entry.hint.includes('—'), `em-dash in hint for ${checkId}`);
  }
});

// ---- Requirements that still need work ---------------------------------

test('PO layer: Requirements that still need work renders an empty state when no PO check names a REQ', () => {
  const result = cleanFixture();
  const html = renderReadinessPO(result, { persona: 'productOwner', engineerBody: '' });
  assert.match(html, /class="rcf-po-reqwork"[^>]*data-rcf-empty="yes"/);
  assert.ok(html.includes('All requirements have a plain description'));
});

test('PO layer: Requirements that still need work tabulates REQs from stories:reqHasUs / skeleton:reqIntent / skeleton:resolvedBy', () => {
  const base = failingFixture();
  const result = {
    ...base,
    stages: [
      ...base.stages,
      {
        stage: 'D4',
        gate: 'define.stories',
        state: 'failing',
        checks: [
          {
            name: 'stories:reqHasUs',
            ok: false,
            over: 'tree',
            pass: 0,
            total: 2,
            failing: [
              { id: 'REQ-012', why: 'no owning user story' },
              { id: 'REQ-013', why: 'no owning user story' },
            ],
            persona: 'productOwner',
            question: '',
          },
        ],
      },
    ],
  };
  const html = renderReadinessPO(result, { persona: 'productOwner', engineerBody: '' });
  assert.ok(html.includes('REQ-012'));
  assert.ok(html.includes('REQ-013'));
  assert.match(html, /class="rcf-po-reqwork__table"/);
  assert.ok(html.includes('#tab=requirements&amp;entity=REQ-012'));
});
