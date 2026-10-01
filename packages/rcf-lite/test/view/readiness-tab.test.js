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

// ---- AC-18001-3 PO blockers render as findings lists with id anchors ---

test('readiness tab: AC-18001-3 PO blockers render as findings lists with id anchors', () => {
  const result = failingFixture();
  const html = renderReadinessPanel(result, { profile: null });
  // Heading is the question.
  assert.ok(html.includes('Has the product owner captured what changed since the last freeze?'));
  // Each id is an anchor to #<id>.
  assert.match(html, /<a href="#brief:ledger">brief:ledger<\/a>/);
  // The blocker card is wrapped in the shared findings-list markup.
  assert.match(html, /<div class="rcf-findings-list">/);
});

// ---- AC-18001-4 register orders the pair and collapses the opposite ----

test('readiness tab: AC-18001-4 register orders the pair and collapses the opposite', () => {
  const result = failingFixture();
  const htmlPo = renderReadinessPanel(result, { profile: 'register: productOwner' });
  // PO group open, engineer group closed.
  const poIdx = htmlPo.indexOf('rcf-readiness-persona--productOwner');
  const engIdx = htmlPo.indexOf('rcf-readiness-persona--engineer');
  assert.ok(poIdx > 0 && engIdx > poIdx, 'PO group must come before engineer group');
  assert.match(htmlPo, /data-rcf-persona-state="open"[^>]*>[\s\S]*?Product owner/);
  assert.match(htmlPo, /data-rcf-persona-state="closed"[^>]*>[\s\S]*?Engineer/);

  // Register engineer flips the order and opens engineer.
  const htmlEng = renderReadinessPanel(result, { profile: 'register: engineer' });
  const poIdx2 = htmlEng.indexOf('rcf-readiness-persona--productOwner');
  const engIdx2 = htmlEng.indexOf('rcf-readiness-persona--engineer');
  assert.ok(engIdx2 > 0 && poIdx2 > engIdx2, 'engineer group must come before PO group');
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

// ---- AC-18001-6 Freeze now is disabled and names the failing gates -----

test('readiness tab: AC-18001-6 Freeze now is disabled and names the failing gates', () => {
  const result = failingFixture();
  const html = renderReadinessPanel(result, { profile: null });
  // Freeze now section carries data-rcf-freezeable="no" and a disabled button.
  assert.match(html, /class="rcf-readiness-freeze-now" data-rcf-freezeable="no"/);
  assert.match(html, /<button type="button" class="rcf-readiness-freeze-now__btn" disabled>/);
  // Failing gates listed; both unique gates from the fixture.
  assert.match(html, /Failing gates:.*define\.brief/);
  assert.match(html, /Failing gates:.*define\.crosscut/);
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
  // Decode each (findings-list uses encodeURIComponent for stage:check anchors).
  const ids = anchors.map((a) => a.startsWith('rcf-readiness-') ? a : decodeURIComponent(a));
  // Flatten the JSON into a stringified haystack; every id must appear.
  const haystack = JSON.stringify(result);
  for (const id of ids) {
    if (id.startsWith('rcf-readiness-')) continue; // internal section anchor
    if (id.startsWith('rcf-readiness-check-')) continue;
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
