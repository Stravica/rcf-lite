// FBS-204: command-page tables (TAC-4135, ADR-4139).
//
// One node:test case per acceptance criterion of US-18003
// (AC-18003-1..8). The suite exercises the pure HTML-string renderers
// in src/view/readiness/tables.js and the splitter in
// src/view/readiness/composite-id.js. Tests use small synthetic
// fixtures where edge cases drive the assertion, and the live
// rcf-lite tree (via renderModelToPage) for the end-to-end render
// AC-18003-7 pins (no shell command text anywhere on the panel).
//
// Node 24 built-ins only; no em-dashes anywhere.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  renderQuestionsTable,
  renderBlockingTable,
  buildQuestionRows,
  buildBlockingRows,
  entityDomId,
} from '../../src/view/readiness/tables.js';
import { splitCompositeId } from '../../src/view/readiness/composite-id.js';
import { renderReadinessPanel } from '../../src/view/readiness.js';
import { renderModelToPage } from '../../src/view/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');

function sampleQuestions() {
  return [
    {
      id: 'Q-D1-brief-sinceFreeze-brief:ledger',
      itemId: 'brief:ledger',
      stage: 'D1',
      check: 'brief:sinceFreeze',
      ask: 'The brief is empty. Hand me your document, or tell me in a few sentences what this is for.',
      hint: 'Answer with a document or a few sentences.',
      context: { sourceSpan: 'tree' },
    },
    {
      id: 'Q-D1-brief-profile-profile:surface',
      itemId: 'profile:surface',
      stage: 'D1',
      check: 'brief:profile',
      ask: 'Where will you look at what we produce: a web page, the running app, or a code review diff?',
      hint: 'Pick viewer, runningApp or prDiff.',
      context: { profileField: 'surface' },
    },
    {
      id: 'Q-D4-stories-reqHasUs-REQ-012',
      itemId: 'REQ-012',
      stage: 'D4',
      check: 'stories:reqHasUs',
      ask: 'Who uses this, and what do they do with it?',
      hint: 'One sentence is enough.',
      context: { sourceSpan: 'REQ-012' },
    },
  ];
}

function sampleStages() {
  return [
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
          persona: 'productOwner',
          question: 'Has the owner captured what changed since the last freeze?',
          failing: [
            { id: 'brief:ledger', why: 'brief ledger holds no statements' },
          ],
        },
      ],
    },
    {
      stage: 'D3',
      gate: 'define.shapes',
      state: 'failing',
      checks: [
        {
          name: 'shapes:tacHasInterface',
          ok: false,
          over: 'tree',
          pass: 1,
          total: 2,
          persona: 'engineer',
          question: 'Does every TAC in scope carry at least one interface?',
          failing: [
            { id: 'TAC-4122-define-gates:checkPersona', why: 'no interfaces entry' },
            { id: 'AC-060-3:userID', why: 'composite finding id over AC-060-3' },
          ],
        },
      ],
    },
  ];
}

function failingReadiness(stages, questions) {
  return {
    tree: {
      frozen: false,
      frozenAt: null,
      treeHash: null,
      currentTreeHash: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
      buildAt: null,
      fbsTotal: 0,
    },
    delta: { changed: [], added: [], removed: [], briefSince: [], impacted: [], impactedFbs: [] },
    stages,
    nextAction: null,
    coverage: { tree: { pass: 0, total: 0 }, delta: [] },
    decisions: [],
    freezeable: false,
    levels: {
      intentComplete: { ok: false, blockedBy: [{ stage: 'D1', gate: 'define.brief', check: 'brief:sinceFreeze', persona: 'productOwner', over: 'tree', failingCount: 1, ids: ['brief:ledger'], question: 'Has the owner captured what changed since the last freeze?' }], nextAction: null },
      readyToBuild: { ok: false, blockedBy: [
        { stage: 'D1', gate: 'define.brief', check: 'brief:sinceFreeze', persona: 'productOwner', over: 'tree', failingCount: 1, ids: ['brief:ledger'], question: 'Has the owner captured what changed since the last freeze?' },
        { stage: 'D3', gate: 'define.shapes', check: 'shapes:tacHasInterface', persona: 'engineer', over: 'tree', failingCount: 2, ids: ['TAC-4122-define-gates:checkPersona', 'AC-060-3:userID'], question: 'Does every TAC in scope carry at least one interface?' },
      ], nextAction: null },
    },
    personas: {
      productOwner: { blockers: [{ stage: 'D1', gate: 'define.brief', check: 'brief:sinceFreeze', persona: 'productOwner', over: 'tree', failingCount: 1, ids: ['brief:ledger'], question: 'Has the owner captured what changed since the last freeze?' }], nextAction: null },
      engineer: { blockers: [{ stage: 'D3', gate: 'define.shapes', check: 'shapes:tacHasInterface', persona: 'engineer', over: 'tree', failingCount: 2, ids: ['TAC-4122-define-gates:checkPersona', 'AC-060-3:userID'], question: 'Does every TAC in scope carry at least one interface?' }], nextAction: null },
    },
    questions,
  };
}

// AC-18003-1 ----------------------------------------------------------
test('AC-18003-1 happy: readinessquestions is nonempty', () => {
  const rows = buildQuestionRows(sampleQuestions());
  assert.equal(rows.length, 3);
  // Each row carries QuestionRow.number (1-based), ask, locationHref,
  // settles, state, group (as sortable column, not heading).
  assert.deepEqual(rows.map((r) => r.number), [1, 2, 3]);
  for (const r of rows) {
    assert.equal(typeof r.ask, 'string');
    assert.ok(r.ask.length > 0, 'ask must be non-empty');
    // AC-18003-1 "opens the item in full context": document itemIds
    // use the bare-hash form so the router switches to the owning
    // tab; non-document itemIds use the readiness sub=questions form.
    if (/^(REQ|AC|US|TAC|TS|TC|FBS|ADR|TAD|CN|PRD)-/.test(r.itemId)) {
      assert.equal(r.locationHref, `#${r.itemId}`, `document itemId expects bare hash: ${r.itemId}`);
    } else {
      assert.ok(r.locationHref.startsWith('#tab=readiness&sub=questions&entity='),
        `non-doc itemId expects readiness hash: got ${r.locationHref}`);
    }
    assert.equal(typeof r.settles, 'string');
    assert.ok(r.settles.length > 0);
    assert.equal(r.state, 'open');
    assert.equal(typeof r.group, 'string');
  }
  const html = renderQuestionsTable({ rows });
  // ONE table (not many) with one tbody row per question. Group is a
  // sortable column rather than a heading: no <h4>/<h3> per group,
  // but a th with data-rcf-sortable.
  const tableMatches = html.match(/<table/g) || [];
  assert.equal(tableMatches.length, 1, 'exactly one questions table');
  const tbodyRows = html.match(/<tr[\s\S]*?<\/tr>/g) || [];
  // One header row + one row per question.
  assert.equal(tbodyRows.length, 1 + rows.length);
  assert.match(html, /<th scope="col" data-rcf-col="group" data-rcf-sortable="yes">Group<\/th>/);
  // group label appears as a cell value, not a heading element.
  assert.ok(!/<h4[^>]*>Your document<\/h4>|<h4[^>]*>Brief<\/h4>|<h4[^>]*>Requirement REQ-012<\/h4>/.test(html));
});

// AC-18003-2 ----------------------------------------------------------
test('AC-18003-2 edge: a question whose itemid is not a document id a b', () => {
  const rows = buildQuestionRows(sampleQuestions());
  // AC-18003-2 constrains the href only for non-document itemIds.
  // AC-18003-1's "opens the item in full context" is satisfied for
  // document itemIds (REQ-012) by a bare-hash href (#REQ-012) which
  // resolveHash's bare-hash path uses to switch to the owning tab.
  for (const r of rows) {
    if (/^(REQ|AC|US|TAC|TS|TC|FBS|ADR|TAD|CN|PRD)-/.test(r.itemId)) {
      assert.equal(r.locationHref, `#${r.itemId}`, `document itemId expects bare hash: ${r.itemId}`);
    } else {
      const expected = `#tab=readiness&sub=questions&entity=${encodeURIComponent(r.itemId)}`;
      assert.equal(r.locationHref, expected, `non-doc itemId locationHref mismatch: ${r.itemId}`);
    }
  }
  const html = renderQuestionsTable({ rows });
  // Non-document itemIds (brief:ledger, profile:surface) carry a
  // row-side data-rcf-entity so findByReadinessEntity resolves them.
  assert.match(html, /data-rcf-entity="brief:ledger"/);
  assert.match(html, /data-rcf-entity="profile:surface"/);
  // The row's id is the entityDomId slug, which the router can also
  // land on when the entity holds characters invalid in a DOM id.
  assert.ok(html.includes(`id="${entityDomId('brief:ledger')}"`));
  assert.ok(html.includes(`id="${entityDomId('profile:surface')}"`));
  // AC-18003-2 non-doc hrefs: escapeHtml renders `&` as `&amp;` in the
  // HTML, so the regex must match the entity-encoded form. The loop
  // asserts the anchor carries a non-empty entity and never emits a
  // raw colon that would break the hash.
  const nonDocAnchors = [...html.matchAll(/href="#tab=readiness&amp;sub=questions&amp;entity=([^"]+)"/g)];
  assert.ok(nonDocAnchors.length >= 2, 'expected at least two non-doc hrefs (brief:ledger, profile:surface)');
  for (const m of nonDocAnchors) {
    assert.doesNotMatch(m[1], /^$/, 'empty entity in anchor');
    assert.doesNotMatch(m[1], /:/, 'raw colon in encoded entity');
  }
  // Document itemIds (REQ-012) emit a bare-hash href that resolveHash
  // routes to the Requirements tab.
  assert.match(html, /href="#REQ-012"/);
});

// AC-18003-3 ----------------------------------------------------------
test('AC-18003-3 happy: every failing check across stages', () => {
  const stages = sampleStages();
  const rows = buildBlockingRows(stages);
  // One row per failing item across every failing check across stages,
  // uncapped.
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((r) => r.stage), ['D1', 'D3', 'D3']);
  for (const r of rows) {
    assert.equal(typeof r.why, 'string');
    assert.ok(r.why.length > 0);
    assert.equal(typeof r.resolved, 'string');
    assert.ok(r.resolved.length > 0);
  }
  const html = renderBlockingTable({ rows });
  const tableMatches = html.match(/<table/g) || [];
  assert.equal(tableMatches.length, 1, 'exactly one blocking table');
  // A row for every failing id (no cap).
  for (const r of rows) {
    assert.ok(html.includes(`data-rcf-raw-id="${r.rawId}"`), `missing row for ${r.rawId}`);
  }
  // FilterBar by stage AND persona present.
  assert.match(html, /data-rcf-filterbar="readiness-blocking"/);
  assert.match(html, /data-filter-key="stage"/);
  assert.match(html, /data-filter-key="persona"/);
});

// AC-18003-4 ----------------------------------------------------------
test('AC-18003-4 edge: a composite failing id such as ac0603userid or t', () => {
  assert.deepEqual(splitCompositeId('AC-060-3:userID'), { docId: 'AC-060-3', fragment: 'userID' });
  assert.deepEqual(splitCompositeId('TAC-4122-define-gates:checkPersona'), { docId: 'TAC-4122-define-gates', fragment: 'checkPersona' });
  // first-colon split keeps the remainder when it contains more colons.
  assert.deepEqual(splitCompositeId('TAD-001:security:foo'), { docId: 'TAD-001', fragment: 'security:foo' });
  // no colon: docId=whole id, fragment=''
  assert.deepEqual(splitCompositeId('REQ-012'), { docId: 'REQ-012', fragment: '' });
  // defensive
  assert.deepEqual(splitCompositeId(''), { docId: '', fragment: '' });
  assert.deepEqual(splitCompositeId(null), { docId: '', fragment: '' });
  // Blocking row carries docId / fragment / href.
  const stages = sampleStages();
  const rows = buildBlockingRows(stages);
  const row = rows.find((r) => r.rawId === 'AC-060-3:userID');
  assert.ok(row, 'row for AC-060-3:userID present');
  assert.equal(row.docId, 'AC-060-3');
  assert.equal(row.fragment, 'userID');
  assert.equal(row.href, '#AC-060-3');
  const html = renderBlockingTable({ rows });
  // Dave ruling 2026-10-08: composite ids render as a prefix link
  // (resolvable doc id) with the full composite in data-rcf-raw-id.
  // The fragment is NOT visible text.
  assert.match(html, /<a href="#AC-060-3"[^>]*>AC-060-3<\/a>/);
  assert.match(html, /data-rcf-raw-id="AC-060-3:userID"/);
  assert.match(html, /data-rcf-raw-id="TAC-4122-define-gates:checkPersona"/);
  // The suffix fragment "userID" and "checkPersona" are NOT rendered
  // as visible text; they only live in data-rcf-raw-id / data-rcf-fragment.
  const visibleHtml = html.replace(/\s[a-z0-9-]+="[^"]*"/gi, '');
  assert.doesNotMatch(visibleHtml, /:userID/);
  assert.doesNotMatch(visibleHtml, /:checkPersona/);
});

// AC-18003-5 ----------------------------------------------------------
test('AC-18003-5 happy: a question row', () => {
  const rows = buildQuestionRows(sampleQuestions());
  const r = rows[0];
  // briefHandle is one line holding itemId and ask; no command text.
  assert.equal(r.briefHandle, `${r.itemId}: ${r.ask}`);
  assert.doesNotMatch(r.briefHandle, /pnpm rcf|rcf define|rcf audit|`/);
  const html = renderQuestionsTable({ rows });
  // Copy button labelled "Copy for your agent", wired through
  // data-rcf-copy-for (page-init.js reads data-rcf-copy-text and fires
  // the shared toast).
  assert.match(html, /<button type="button" class="rcf-cmd-copy" data-rcf-copy-for="brief:ledger"/);
  assert.match(html, /data-rcf-copy-text="brief:ledger: /);
  assert.match(html, /Copy for your agent/);
  // No command text in the handle attribute values.
  for (const m of html.matchAll(/data-rcf-copy-text="([^"]+)"/g)) {
    assert.doesNotMatch(m[1], /pnpm rcf|rcf define|rcf audit/);
  }
});

// AC-18003-6 ----------------------------------------------------------
test('AC-18003-6 failure: readiness could not be computed the readiness ob', () => {
  const html = renderReadinessPanel(null, { profile: null, freezeRecord: null });
  // The placeholder renders.
  assert.match(html, /Readiness could not be computed/);
  // No table is rendered (neither questions nor blocking).
  assert.doesNotMatch(html, /<table/);
  assert.doesNotMatch(html, /rcf-cmd-table/);
});

// AC-18003-7 ----------------------------------------------------------
test('AC-18003-7 must-not: no shell command text, chain ids as prefix link with full id in data attribute', async () => {
  // Synthetic failing tree: panel has no shell command text and no
  // Run / Freeze-now affordance (Dave ruling 2026-10-08 amended AC).
  const synthetic = failingReadiness(sampleStages(), sampleQuestions());
  for (const profile of [null, 'register: productOwner', 'register: engineer']) {
    const html = renderReadinessPanel(synthetic, { profile, freezeRecord: null });
    assert.doesNotMatch(html, /pnpm rcf/, `pnpm rcf present under profile=${profile}`);
    assert.doesNotMatch(html, /rcf define/, `rcf define present under profile=${profile}`);
    assert.doesNotMatch(html, /rcf audit/, `rcf audit present under profile=${profile}`);
    assert.doesNotMatch(html, /Freeze now/, `Freeze now present under profile=${profile}`);
    assert.doesNotMatch(html, /Run <code>/, `Run <code> present under profile=${profile}`);
    // No write control: no un-disabled form, no POST reference.
    assert.doesNotMatch(html, /method="post"/i);
  }
  // Live rcf-lite tree: run the real renderer and apply Dave's amended
  // AC-18003-7 strictly. The P3 carry-in from the FBS-204 gate re-
  // widens the scope to the WHOLE readiness panel in FBS-206 - the
  // For-engineers DocRow and stage-detail block are gone (AC-18005-4),
  // so there is no legacy surface to carve out. The command-page
  // surface IS the whole panel now.
  const built = await renderModelToPage({ projectRoot: repoRoot });
  const panelStart = built.contentHtml.indexOf('id="tab-readiness"');
  const panelEnd = built.contentHtml.indexOf('id="tab-overview"');
  assert.ok(panelStart !== -1 && panelEnd > panelStart, 'readiness and overview tabpanels found in order');
  const panel = built.contentHtml.slice(panelStart, panelEnd);
  // Panel wrapper is present (FBS-206 renderReadinessPanel emits a
  // <div class="rcf-readiness-panel"> around the strip + sub-panels).
  assert.match(panel, /class="rcf-readiness-panel"/, 'rcf-readiness-panel wrapper present');
  // Strip HTML attribute values so the visible-text scan does not
  // count text that only lives in attributes (data-* carries chain ids
  // verbatim as Dave's ruling requires).
  const visiblePanel = panel.replace(/\s[a-z0-9-]+="[^"]*"/gi, '');
  assert.doesNotMatch(visiblePanel, /pnpm rcf/, 'visible pnpm rcf text leaked into the panel');
  assert.doesNotMatch(visiblePanel, /rcf define/, 'visible rcf define text leaked into the panel');
  assert.doesNotMatch(visiblePanel, /rcf audit/, 'visible rcf audit text leaked into the panel');
  assert.doesNotMatch(visiblePanel, /Freeze now/, 'Freeze now leaked into the panel');
  assert.doesNotMatch(visiblePanel, /Run <code>/, 'viewer prints a Run <code> line');
  // No <code> element in the whole panel carries a shell command
  // (Dave's ruling text; panel-wide for the <code> ban).
  const codeCmdPattern = /<code[^>]*>\s*(?:pnpm rcf|rcf define|rcf audit)[^<]*<\/code>/;
  assert.doesNotMatch(panel, codeCmdPattern, 'viewer emits a shell command in a <code> element');
  assert.doesNotMatch(panel, /class="rcf-readiness-freeze-now__btn"/, 'Freeze now button leaked');
  // Full composite ids remain in the DOM via data-rcf-raw-id so
  // AC-18002-3 ("no id leaves the DOM") still holds. The whole panel
  // carries at least one composite id as a raw-id attribute (the
  // live rcf-lite tree has composite blocker ids like
  // `brief:ledger` and chain-id entity keys).
  assert.match(panel, /data-rcf-raw-id="[^"]*:[^"]*"/, 'at least one composite id present in data-rcf-raw-id across the panel');
});

// AC-18003-8 ----------------------------------------------------------
test('AC-18003-8 happy: the profile register is engineer', () => {
  const synthetic = failingReadiness(sampleStages(), sampleQuestions());
  const engHtml = renderReadinessPanel(synthetic, { profile: 'register: engineer', freezeRecord: null });
  const idxBlockingEng = engHtml.indexOf('data-rcf-table="blocking"');
  const idxQuestionsEng = engHtml.indexOf('data-rcf-table="questions"');
  assert.ok(idxBlockingEng !== -1 && idxQuestionsEng !== -1, 'both tables in DOM');
  assert.ok(idxBlockingEng < idxQuestionsEng, 'engineer register: blocking before questions');

  for (const profile of ['register: productOwner', null, '']) {
    const html = renderReadinessPanel(synthetic, { profile, freezeRecord: null });
    const idxB = html.indexOf('data-rcf-table="blocking"');
    const idxQ = html.indexOf('data-rcf-table="questions"');
    assert.ok(idxB !== -1 && idxQ !== -1, `both tables in DOM for profile=${profile}`);
    assert.ok(idxQ < idxB, `profile=${profile}: questions must precede blocking`);
  }
});
