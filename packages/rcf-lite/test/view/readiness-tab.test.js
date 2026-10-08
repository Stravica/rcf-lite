// Readiness tab tests (US-18001 and US-18101 under REQ-180 / REQ-181 /
// TAC-4127-readiness-view, ADR-4127; w-2026-10-01-dave-003 PR C).
// Exercises the rendered HTML string of the Readiness tabpanel; the
// renderer is pure so the tests build a `ReadinessResult` fixture by
// hand and assert the DOM shape. One end-to-end case walks the live
// tree, invokes `renderPage` through `renderModelToPage`, and
// cross-checks the ids on the tab against the CLI `--json` output.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { renderPage } from '../../src/view/html-page.js';
import { renderReadinessPanel, pickRegister } from '../../src/view/readiness.js';
import { pill } from '../../src/view/components/pill.js';
import { findingsList } from '../../src/view/components/findings-list.js';
import { renderModelToPage } from '../../src/view/index.js';
import { formatVerdictLines } from '../../src/query/readiness.js';
import { buildTreeModel } from '../../src/view/tree-model.js';
import { walkTree } from '#core/store';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');

/**
 * Build a crafted ReadinessResult fixture covering the shapes the tab
 * cares about: both verdict levels false, one PO blocker, one
 * engineer blocker, mixed stage states and a loaded freeze record.
 */
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
          question: 'Has the product owner captured what changed since the last freeze?',
        },
      ],
    },
    {
      stage: 'D3',
      gate: 'define.shapes',
      state: 'acknowledged',
      checks: [
        {
          name: 'shapes:tacHasInterface',
          ok: false,
          over: 'tree',
          pass: 1,
          total: 2,
          failing: [{ id: 'TAC-9999', why: 'no interfaces' }],
          persona: 'engineer',
          question: 'Does every TAC in scope carry at least one interface?',
        },
      ],
      reason: 'acknowledged by operator for the current tree hash',
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
        question: 'Has the product owner captured what changed since the last freeze?',
      }],
      nextAction: {
        stage: 'D1',
        check: 'brief:sinceFreeze',
        ids: ['brief:ledger'],
        command: 'rcf define readiness --level intent --check brief',
      },
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
          question: 'Has the product owner captured what changed since the last freeze?',
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
      nextAction: {
        stage: 'D1',
        check: 'brief:sinceFreeze',
        ids: ['brief:ledger'],
        command: 'rcf define readiness --check brief',
      },
    },
  };
  const personas = {
    productOwner: {
      blockers: levels.intentComplete.blockedBy,
      nextAction: levels.intentComplete.nextAction,
    },
    engineer: {
      blockers: [levels.readyToBuild.blockedBy[1]],
      nextAction: {
        stage: 'D5',
        check: 'crosscut:securityArchitecture',
        ids: ['TAD-001:security'],
        command: 'rcf define readiness --check crosscut',
      },
    },
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

// ---- AC-18001-1 tab order and PRD rename --------------------------------

test('readiness tab: AC-18001-1 tab order and PRD rename', async () => {
  const result = await walkTree({ projectRoot: repoRoot });
  const model = buildTreeModel(result);
  const html = renderPage(model);
  // First tab button is Readiness.
  const firstTab = html.match(/<button type="button" role="tab" data-tab="(\w+)"[^>]*>([^<]+)<\/button>/);
  assert.ok(firstTab);
  assert.equal(firstTab[1], 'readiness');
  assert.equal(firstTab[2], 'Readiness');
  // Second tab button is PRD (data-tab=overview preserved).
  const secondTabMatch = /<button type="button" role="tab" data-tab="overview"[^>]*>PRD<\/button>/;
  assert.match(html, secondTabMatch);
  // Overview panel body (PRD content) still carries the PRD-001 article.
  assert.match(html, /id="tab-overview"[\s\S]*?<article id="PRD-001"/);
});

// ---- AC-18001-2 verdict pill labels equal CLI formatVerdictLines -------

test('readiness tab: AC-18001-2 verdict pill labels equal formatVerdictLines', () => {
  const result = failingFixture();
  const expected = formatVerdictLines(result);
  const html = renderReadinessPanel(result, { profile: null, freezeRecord: null });
  // The two labels appear inside the pill spans.
  assert.ok(html.includes(expected.intentComplete),
    `verdict intent label missing: ${expected.intentComplete}`);
  assert.ok(html.includes(expected.readyToBuild),
    `verdict build label missing: ${expected.readyToBuild}`);
  // Both verdict pills share the shared pill shape.
  assert.match(html, /class="rcf-pill rcf-pill--level-verdict-intent/);
  assert.match(html, /class="rcf-pill rcf-pill--level-verdict-build/);
});

// ---- AC-18001-3 PO blocker ids appear in the questions table ---------
//
// Amended 2026-10-08 under FBS-204 (ADR-4139). The former blocker
// cards + findings-list wrapper are gone; the questions table owns
// the PO surface and each PO blocker id appears as a row (data-rcf-entity
// matching the itemId) with the id as an anchor link into the document
// tabs (`<a href="#tab=readiness&sub=questions&entity=<itemId>">`).
test('readiness tab: AC-18001-3 PO blocker ids appear in the questions table', () => {
  const result = failingFixture();
  const html = renderReadinessPanel(result, { profile: null });
  // Each PO blocker id has a row carrying data-rcf-entity.
  for (const b of result.personas.productOwner.blockers) {
    for (const id of b.ids) {
      assert.ok(
        html.includes(`data-rcf-entity="${id}"`),
        `questions table missing a row for PO blocker id ${id}`,
      );
      // The id also appears as an anchor link into the document tabs
      // (the location column renders an <a href="#tab=readiness..."
      // ...>itemId</a>).
      const anchorPattern = new RegExp(`<a href="#tab=readiness[^"]*entity=[^"]*"[^>]*>${id.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}</a>`);
      assert.match(html, anchorPattern, `no anchor link for PO blocker id ${id} in the questions table`);
    }
  }
  // The retired card markers are gone from the PO surface (the engineer
  // body still carries the per-stage findings-list under renderStageDetail;
  // the PO layer stops using findings-list for blockers specifically).
  assert.doesNotMatch(html, /class="rcf-readiness-blocker"/);
});

// ---- AC-18001-4 register orders the pair of tables ---------------------
//
// Amended 2026-10-08 under FBS-204 (ADR-4139; Dave ruling). The
// persona-group details markup is retired; the register orders the
// pair of command-page tables. With a profile register of
// productOwner, the questions table precedes the blocking table.
// (The "both carry every blocker id" claim is AC-18001-5's job and
// is tested there; the questions table is PO-only by design.)
test('readiness tab: AC-18001-4 register orders the questions and blocking tables', () => {
  const result = failingFixture();
  const htmlPo = renderReadinessPanel(result, { profile: 'register: productOwner' });
  const qIdxPo = htmlPo.indexOf('data-rcf-table="questions"');
  const bIdxPo = htmlPo.indexOf('data-rcf-table="blocking"');
  assert.ok(qIdxPo !== -1 && bIdxPo !== -1, 'both tables present on productOwner render');
  assert.ok(qIdxPo < bIdxPo, 'productOwner: questions table before blocking table');

  // The engineer register's reverse order is AC-18003-8's claim; the
  // test for it lives in test/view/readiness-tables.test.js. This test
  // owns only the productOwner-register ordering.
});

// ---- AC-18001-5 no blocker id is omitted from the DOM -------------------

test('readiness tab: AC-18001-5 no blocker id is omitted from the DOM', () => {
  const result = failingFixture();
  for (const profile of ['register: productOwner', 'register: engineer', null]) {
    const html = renderReadinessPanel(result, { profile });
    for (const b of result.personas.productOwner.blockers) {
      for (const id of b.ids) {
        assert.ok(html.includes(id), `missing PO id ${id} under register=${profile}`);
      }
    }
    for (const b of result.personas.engineer.blockers) {
      for (const id of b.ids) {
        assert.ok(html.includes(id), `missing engineer id ${id} under register=${profile}`);
      }
    }
  }
});

// ---- AC-18001-6 freeze state in plain words, no freeze control --------
//
// Amended 2026-10-08 under FBS-204 (ADR-4139, AC-18003-7). The viewer
// is read-only now: no "Freeze now" button, no CLI command text. The
// freeze state block names the failing gates from
// `levels.readyToBuild.blockedBy` in plain words.
test('readiness tab: AC-18001-6 freeze state names failing gates in plain words, no freeze control', () => {
  const result = failingFixture();
  const html = renderReadinessPanel(result, { profile: null });
  // The replacement block.
  assert.match(html, /class="rcf-readiness-freeze-state" data-rcf-freezeable="no"/);
  // Plain-words framing.
  assert.match(html, /Not ready to freeze/);
  // Scope the gate-name check to the freeze-state block (P2-#9): the
  // broader panel also carries chain ids whose rendering already
  // asserts other ACs. The claim here is specifically that THIS
  // block names the failing gates.
  const freezeStart = html.indexOf('class="rcf-readiness-freeze-state"');
  assert.ok(freezeStart !== -1, 'freeze-state block present');
  const afterOpen = html.indexOf('>', freezeStart) + 1;
  // Find the matching </section> that closes the freeze-state block.
  // The block is a self-contained section without nested sections; a
  // conservative close is the next </section> after the opening tag.
  const freezeEnd = html.indexOf('</section>', afterOpen);
  assert.ok(freezeEnd > afterOpen, 'freeze-state block closes cleanly');
  const freezeBlock = html.slice(freezeStart, freezeEnd);
  // Both unique failing gates named verbatim within the freeze-state
  // block, in `<code>` for scanability.
  assert.ok(freezeBlock.includes('<code>define.brief</code>'), 'define.brief gate not named inside freeze-state');
  assert.ok(freezeBlock.includes('<code>define.crosscut</code>'), 'define.crosscut gate not named inside freeze-state');
  // No freeze control, no "Freeze now" surface, no command text,
  // panel-wide (ADR-4139, AC-18003-7).
  assert.doesNotMatch(html, /class="rcf-readiness-freeze-now__btn"/);
  assert.doesNotMatch(html, /Freeze now/);
  assert.doesNotMatch(html, /rcf define freeze/);
});

// ---- AC-18001-7 every id on the tab appears in the --json for the same tree

test('readiness tab: AC-18001-7 every id on the tab appears in the CLI --json for the same tree', () => {
  // Spawn the readiness CLI (--json) on the live tree, render the panel
  // against the parsed JSON, walk the id anchors and assert each is in
  // the JSON. The CLI reads the same walker + computeReadiness, so this
  // is the parity check.
  const binPath = resolve(repoRoot, 'bin/rcf.js');
  const run = spawnSync('node', [binPath, 'define', 'readiness', '--json'], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 60000,
  });
  assert.equal(run.status, 0, `readiness --json failed: ${run.stderr}`);
  const envelope = JSON.parse(run.stdout);
  const result = envelope.result ?? envelope.payload ?? envelope;
  const html = renderReadinessPanel(result, { profile: null, freezeRecord: envelope.freezeRecord ?? null });
  // Collect every anchor id from the Readiness tab (hrefs that start with `#`).
  const anchors = [...html.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]);
  // Decode each. The viewer anchor pipeline is HTML-escape (findings-list)
  // or encodeURIComponent (next-action and stage:check anchors), so a raw
  // href may carry HTML entities (&lt; &gt; &amp;) or URL percent escapes.
  // DEFINE step 3 PR 5 (ADR-4131) is the first slice whose findings ids
  // contain `<` and `>` (the dogfood tree's cliCommand interface names
  // like `rcf define ledger <name> update <id>`); HTML-decode before the
  // URL-decode so the parity comparison sees the raw tree id, which is
  // what the --json haystack carries.
  const htmlDecode = (s) => s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
  // FBS-204: the questions table link scheme is
  // `#tab=readiness&sub=questions&entity=<itemId>` and the blocking
  // table link scheme is `#<docId>` (plus `#<entityDomId>` for a
  // composite row with no doc counterpart). Pull the itemId out of a
  // readiness route and keep bare anchors as-is; the internal section
  // anchors (`rcf-readiness-*`) still pass through.
  const extractEntity = (a) => {
    const decoded = decodeURIComponent(htmlDecode(a));
    if (decoded.startsWith('rcf-readiness-')) return decoded;
    if (decoded.startsWith('tab=')) {
      const m = decoded.match(/[&?]entity=([^&]+)/);
      return m ? m[1] : null; // tab-switch anchor with no entity: skip
    }
    return decoded;
  };
  const ids = anchors.map(extractEntity).filter((x) => x != null);
  // Flatten the JSON into a stringified haystack; every id must appear.
  const haystack = JSON.stringify(result);
  for (const id of ids) {
    if (id.startsWith('rcf-readiness-')) continue; // internal section anchor
    if (id.startsWith('rcf-readiness-check-')) continue;
    if (id.startsWith('rcf-readiness-row-')) continue; // FBS-204 row DOM id
    assert.ok(haystack.includes(id), `id ${id} on the tab is absent from the --json`);
  }
});

// ---- AC-18101-1 pill emits one shape with per-value vocabulary classes --

test('readiness tab: AC-18101-1 pill emits one shape with per-value vocabulary classes', () => {
  // Gate state.
  const gateMarkup = pill({ value: 'passed', variant: 'gate-state' });
  assert.match(gateMarkup, /^<span class="rcf-pill rcf-pill--gate-state rcf-pill--passed">passed<\/span>$/);
  // Level verdict.
  const verdictMarkup = pill({ value: 'yes', variant: 'level-verdict' });
  assert.match(verdictMarkup, /^<span class="rcf-pill rcf-pill--level-verdict rcf-pill--yes">yes<\/span>$/);
  // Persona.
  const personaMarkup = pill({ value: 'productOwner', variant: 'persona' });
  assert.match(personaMarkup, /^<span class="rcf-pill rcf-pill--persona rcf-pill--productowner">productOwner<\/span>$/);
  // AC class.
  const acMarkup = pill({ value: 'happy', variant: 'ac-class' });
  assert.match(acMarkup, /^<span class="rcf-pill rcf-pill--ac-class rcf-pill--happy">happy<\/span>$/);
});

// ---- AC-18101-2 findingsList is byte-identical across call sites --------

test('readiness tab: AC-18101-2 findingsList is byte-identical across call sites', () => {
  const inputs = {
    heading: 'Missing stories',
    count: 2,
    items: [
      { id: 'REQ-001', why: 'no user stories under this REQ' },
      { id: 'REQ-002', why: 'no user stories under this REQ' },
    ],
  };
  const a = findingsList(inputs);
  const b = findingsList(inputs);
  assert.equal(a, b);
  // Produces the shape the spec pins.
  assert.match(a, /^<div class="rcf-findings-list"><h4>Missing stories <span class="rcf-findings-list__count">2<\/span><\/h4><ul><li><a href="#REQ-001">REQ-001<\/a>: no user stories under this REQ<\/li>/);
});

// ---- AC-18101-3 existing Product Map and Requirements tests retain their expectations

test('readiness tab: AC-18101-3 existing Product Map and Requirements tests retain their expectations', () => {
  // This AC is enforced by the untouched existing test files; the
  // positive assertion here is that renderReadinessPanel does not emit
  // any `pm-mini` / Product-Map or `doc-req` / Requirements markup
  // (so the shared components the Readiness tab uses cannot drift the
  // other tabs' render by accident).
  const result = failingFixture();
  const html = renderReadinessPanel(result, { profile: null });
  assert.ok(!html.includes('pm-mini'));
  assert.ok(!html.includes('doc-req-wrap'));
  // Also check pickRegister is pure and the two personae are visible.
  assert.equal(pickRegister('register: productOwner\n'), 'productOwner');
  assert.equal(pickRegister('register: engineer\n'), 'engineer');
  assert.equal(pickRegister(''), 'unstated');
  assert.equal(pickRegister(null), 'unstated');
});

// ---- Fix-round P1: blocker findings list carries the `why` per id -----

test('readiness tab: fix-round P1 blocker findingsList carries the why per id', () => {
  const result = failingFixture();
  const html = renderReadinessPanel(result, { profile: 'register: productOwner' });
  // The PO blocker's single id `brief:ledger` has the matching
  // `why: 'brief ledger holds no statements'` on stages[].checks[].failing[].
  // Spec §5 block 5: the findings list carries id -> why pairs.
  assert.match(
    html,
    /<a href="#brief:ledger">brief:ledger<\/a>: brief ledger holds no statements<\/li>/,
    'PO blocker findings list is missing the matching why',
  );
  // Engineer blocker id -> why.
  assert.match(
    html,
    /<a href="#TAD-001:security">TAD-001:security<\/a>: security architecture missing<\/li>/,
    'engineer blocker findings list is missing the matching why',
  );
});

// ---- Fix-round P1: renderDocDiff renders real hashes, not (absent) ----

test('readiness tab: fix-round P1 document-level diff renders frozen and current short hashes', () => {
  // Build a minimal readiness result with one changed and one added
  // document in the delta, plus a freezeRecord that carries matching
  // docHashes. The renderer must emit a diff component with the short
  // hashes rather than the (absent)/(absent) placeholder.
  const result = {
    tree: {
      frozen: true,
      frozenAt: '2026-10-01T00:00:00.000Z',
      treeHash: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
      currentTreeHash: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
      buildAt: null,
      fbsTotal: 0,
    },
    delta: {
      changed: ['REQ-001'],
      added: ['REQ-002'],
      removed: [],
      briefSince: [],
      impacted: [],
      impactedFbs: [],
      currentDocHashes: {
        'REQ-001': 'sha256:abc1234000000000000000000000000000000000000000000000000000000000',
        'REQ-002': 'sha256:deadbeef00000000000000000000000000000000000000000000000000000000',
      },
    },
    stages: [],
    nextAction: null,
    coverage: { tree: { pass: 0, total: 0 }, delta: [] },
    decisions: [],
    freezeable: false,
    levels: {
      intentComplete: { ok: true, blockedBy: [], nextAction: null },
      readyToBuild: { ok: true, blockedBy: [], nextAction: null },
    },
    personas: {
      productOwner: { blockers: [], nextAction: null },
      engineer: { blockers: [], nextAction: null },
    },
  };
  const freezeRecord = {
    frozenAt: '2026-10-01T00:00:00.000Z',
    treeHash: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
    docHashes: {
      'REQ-001': 'sha256:0101010100000000000000000000000000000000000000000000000000000000',
    },
    briefStatements: 0,
  };
  const html = renderReadinessPanel(result, { profile: null, freezeRecord });
  // The diff block renders for each changed/added entry.
  const diffCount = (html.match(/class="rcf-diff"/g) || []).length;
  assert.ok(diffCount >= 2, `expected at least 2 diff blocks, found ${diffCount}`);
  // Changed REQ-001 shows both the frozen short hash and the current
  // short hash — real content, not (absent)/(absent).
  assert.ok(html.includes('sha256:0101010'), 'changed doc missing frozen short hash');
  assert.ok(html.includes('sha256:abc1234'), 'changed doc missing current short hash');
  // Added REQ-002 shows only the current short hash and a "not in the frozen tree" note.
  assert.ok(html.includes('sha256:deadbee'), 'added doc missing current short hash');
  assert.match(html, /not in the frozen tree/);
  // Must not be the pre-fix placeholder (both sides absent).
  const absentCount = (html.match(/\(absent\)/g) || []).length;
  assert.equal(absentCount, 0, 'diff should not render (absent) when hashes are present');
});

// ---- Fix-round P2: delta coverage filters empty rows -------------------

test('readiness tab: fix-round P2 delta coverage filters empty rows', () => {
  const base = failingFixture();
  // Replace delta coverage with a mix of empty and meaningful rows.
  const result = {
    ...base,
    coverage: {
      tree: { pass: 10, total: 10 },
      delta: [
        { reqId: 'REQ-001', pass: 2, total: 2 },  // meaningful
        { reqId: null, scope: null, pass: null, total: null },  // empty
        { reqId: '', pass: '', total: '' },  // empty
      ],
    },
  };
  const html = renderReadinessPanel(result, { profile: null });
  // Meaningful row present.
  assert.ok(html.includes('REQ-001: 2 / 2'), 'meaningful delta coverage row missing');
  // Empty "delta: / " row suppressed.
  assert.ok(!html.includes('delta: / '), 'empty delta coverage row leaked through');
  assert.ok(!html.includes('<li>: </li>'), 'blank li should not render');

  // When no meaningful row survives at all, fall back to the empty
  // placeholder "No per-REQ delta coverage.".
  const resultAllEmpty = {
    ...base,
    coverage: {
      tree: { pass: 10, total: 10 },
      delta: [
        { reqId: null, pass: null, total: null },
        { reqId: '', pass: null, total: null },
      ],
    },
  };
  const htmlAllEmpty = renderReadinessPanel(resultAllEmpty, { profile: null });
  assert.match(htmlAllEmpty, /No per-REQ delta coverage\./);
});
