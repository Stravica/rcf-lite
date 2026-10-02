// Unit tests for the four sidecar ledgers (REQ-173; proposal §2.5,
// §3.2, §8.2 v3).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  BRIEF_KINDS,
  LEDGER_NAMES,
  LedgerError,
  addEntry,
  emptyLedger,
  isResolvedByGrammar,
  ledgerRelPath,
  loadAllLedgers,
  loadLedger,
  nextIdFor,
  parseBriefFromFile,
  parseResolvedBy,
  resolveEntry,
  saveLedger,
  updateEntry,
  validateLedger,
} from '../../src/define/ledgers.js';

async function scratch(prefix = 'ledgers-') {
  return mkdtemp(join(tmpdir(), prefix));
}

test('ledgers: LEDGER_NAMES lists the four proposal-mandated ledgers', () => {
  assert.deepEqual([...LEDGER_NAMES], ['brief', 'decisions', 'concerns', 'probes']);
});

test('ledgers: relative paths sit under rcf/define/', () => {
  assert.equal(ledgerRelPath('brief'), 'rcf/define/brief-ledger.json');
  assert.equal(ledgerRelPath('decisions'), 'rcf/define/decisions-ledger.json');
  assert.equal(ledgerRelPath('concerns'), 'rcf/define/concern-ledger.json');
  assert.equal(ledgerRelPath('probes'), 'rcf/define/probe-ledger.json');
});

test('ledgers: loading a missing file returns the empty ledger', async () => {
  const root = await scratch();
  for (const name of LEDGER_NAMES) {
    const body = await loadLedger({ projectRoot: root, name });
    assert.deepEqual(body, emptyLedger(name));
  }
});

test('ledgers: brief add mints numbered ids and honours BRIEF_KINDS', () => {
  let body = emptyLedger('brief');
  for (const kind of ['capability', 'constraint', 'openQuestion']) {
    const step = addEntry({
      name: 'brief',
      body,
      entry: { kind, text: `Statement for ${kind}` },
      now: '2026-09-24T10:00:00Z',
    });
    body = step.body;
    assert.ok(BRIEF_KINDS.includes(kind));
    assert.equal(step.entry.kind, kind);
    assert.equal(step.entry.status, 'open');
  }
  assert.deepEqual(body.statements.map((s) => s.id), [1, 2, 3]);
  assert.equal(nextIdFor('brief', body), 4);
});

test('ledgers: brief add refuses an unknown kind at validation', () => {
  assert.throws(
    () => addEntry({
      name: 'brief',
      body: emptyLedger('brief'),
      entry: { kind: 'unclassified', text: 'x' },
    }),
    (err) => err instanceof LedgerError && err.field?.includes('kind'),
  );
});

test('ledgers: resolveEntry flips status and stamps resolvedAt', () => {
  let body = emptyLedger('probes');
  ({ body } = addEntry({
    name: 'probes',
    body,
    entry: { reqId: 'REQ-172', finding: 'x', severity: 'low' },
    now: '2026-09-24T10:00:00Z',
  }));
  const step = resolveEntry({
    name: 'probes',
    body,
    id: 1,
    patch: { reason: 'fixed' },
    now: '2026-09-24T11:00:00Z',
  });
  assert.equal(step.entry.status, 'resolved');
  assert.equal(step.entry.resolvedAt, '2026-09-24T11:00:00Z');
  assert.equal(step.entry.reason, 'fixed');
});

test('ledgers: resolveEntry refuses an unknown id with usage-class error', () => {
  assert.throws(
    () => resolveEntry({ name: 'probes', body: emptyLedger('probes'), id: 99 }),
    (err) => err instanceof LedgerError && err.code === 'usage',
  );
});

test('ledgers: decisions require question and options[]', () => {
  assert.throws(
    () => addEntry({
      name: 'decisions',
      body: emptyLedger('decisions'),
      entry: { question: 'Q?', options: [] },
    }),
    (err) => err instanceof LedgerError && err.field?.includes('options'),
  );
});

test('ledgers: parseBriefFromFile splits by non-empty lines and strips bullets', () => {
  const content = `
- First statement
* Second statement
3. Third statement
Not a bullet

`;
  const drafts = parseBriefFromFile(content, { kind: 'capability', source: 'briefs/x.md' });
  assert.deepEqual(drafts.map((d) => d.text), [
    'First statement',
    'Second statement',
    'Third statement',
    'Not a bullet',
  ]);
  for (const d of drafts) {
    assert.equal(d.kind, 'capability');
    assert.equal(d.source, 'briefs/x.md');
  }
});

test('ledgers: validateLedger detects duplicate ids', () => {
  assert.throws(
    () => validateLedger('brief', {
      statements: [
        { id: 1, kind: 'capability', text: 'a', addedAt: '2026-09-24T10:00:00Z', status: 'open' },
        { id: 1, kind: 'capability', text: 'b', addedAt: '2026-09-24T10:00:00Z', status: 'open' },
      ],
    }),
    (err) => err instanceof LedgerError && err.message.includes('duplicate'),
  );
});

test('ledgers: loadLedger throws parseFailure on malformed JSON', async () => {
  const root = await scratch();
  const path = join(root, 'rcf', 'define', 'brief-ledger.json');
  await mkdir(join(root, 'rcf', 'define'), { recursive: true });
  await writeFile(path, '{not-json', 'utf8');
  await assert.rejects(
    () => loadLedger({ projectRoot: root, name: 'brief' }),
    (err) => err instanceof LedgerError && err.code === 'parseFailure',
  );
});

test('ledgers: save / load round-trips every ledger', async () => {
  const root = await scratch();
  const bodies = {
    brief: emptyLedger('brief'),
    decisions: emptyLedger('decisions'),
    concerns: emptyLedger('concerns'),
    probes: emptyLedger('probes'),
  };
  ({ body: bodies.brief } = addEntry({
    name: 'brief', body: bodies.brief,
    entry: { kind: 'capability', text: 'ship freeze detection' },
    now: '2026-09-24T10:00:00Z',
  }));
  ({ body: bodies.decisions } = addEntry({
    name: 'decisions', body: bodies.decisions,
    entry: {
      question: 'What is the class-marker convention?',
      options: [{ letter: 'a', text: 'bracketed prefix' }, { letter: 'b', text: 'schema field' }],
      default: 'a', blocks: 'D4',
    },
    now: '2026-09-24T10:00:00Z',
  }));
  ({ body: bodies.concerns } = addEntry({
    name: 'concerns', body: bodies.concerns,
    entry: { reqId: 'REQ-172', concern: 'auth', disposition: 'waived', reason: 'not applicable' },
    now: '2026-09-24T10:00:00Z',
  }));
  ({ body: bodies.probes } = addEntry({
    name: 'probes', body: bodies.probes,
    entry: { reqId: 'REQ-172', finding: 'hash edge case', severity: 'low' },
    now: '2026-09-24T10:00:00Z',
  }));
  for (const name of LEDGER_NAMES) {
    await saveLedger({ projectRoot: root, name, body: bodies[name] });
  }
  const bundle = await loadAllLedgers({ projectRoot: root });
  assert.deepEqual(bundle.brief, bodies.brief);
  assert.deepEqual(bundle.decisions, bodies.decisions);
  assert.deepEqual(bundle.concerns, bodies.concerns);
  assert.deepEqual(bundle.probes, bodies.probes);
});

// AC-17501-6: absent ledger files are omitted from the returned
// bundle so `computeDelta` records no `ledger:<name>` docHash for a
// project that never authored that ledger. Resolves slice-1 P3: the
// `LedgerBundle` typedef on `computeDelta` said "absent ledgers add
// no docHash" while the previous implementation always returned the
// four empty bodies.
// ---------------------------------------------------------------------------
// AC-18701-1 / 2 / 3 / 4 / 5: parseBriefFromFile marker parsing (REQ-187).
// ---------------------------------------------------------------------------

test('parseBriefFromFile (AC-18701-1): leading [kind] and trailing (source: ...) markers mint one statement', () => {
  const line = '- [constraint] A loan on hold must not accrue late fees. (source: briefs/x.md:15)';
  const drafts = parseBriefFromFile(line, { kind: 'capability' });
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].kind, 'constraint');
  assert.equal(drafts[0].text, 'A loan on hold must not accrue late fees.');
  assert.equal(drafts[0].source, 'briefs/x.md:15');
});

test('parseBriefFromFile (AC-18701-2): a line without markers inherits --kind and --source', () => {
  const line = 'Loan officer.';
  const drafts = parseBriefFromFile(line, { kind: 'actor', source: 'doc.md' });
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].kind, 'actor');
  assert.equal(drafts[0].source, 'doc.md');
  assert.equal(drafts[0].text, 'Loan officer.');
});

test('parseBriefFromFile (AC-18701-3): a question-mark trailing line is kinded openQuestion', () => {
  const line = 'Does a hold need a second approver?';
  const drafts = parseBriefFromFile(line, { kind: 'capability' });
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].kind, 'openQuestion');
});

test('parseBriefFromFile (AC-18701-3): a TBC/TBD/Open/Question-leading line is kinded openQuestion', () => {
  const content = 'TBC: hold policy\nOpen: whether a second approver is required\nQuestion: does X apply\nTBD: approval chain';
  const drafts = parseBriefFromFile(content, { kind: 'capability' });
  assert.equal(drafts.length, 4);
  for (const d of drafts) assert.equal(d.kind, 'openQuestion');
});

test('parseBriefFromFile (AC-18701-3 override): a [kind] marker wins over the question heuristic', () => {
  const drafts = parseBriefFromFile('[capability] Why does this exist?', {});
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].kind, 'capability');
});

test('parseBriefFromFile (AC-18701-4): a 0.29.0 line-per-statement file parses unchanged', () => {
  const content = `
- First statement
* Second statement
3. Third statement
Not a bullet
`;
  const drafts = parseBriefFromFile(content, { kind: 'capability', source: 'briefs/x.md' });
  assert.deepEqual(drafts.map((d) => d.text), [
    'First statement',
    'Second statement',
    'Third statement',
    'Not a bullet',
  ]);
  for (const d of drafts) {
    assert.equal(d.kind, 'capability');
    assert.equal(d.source, 'briefs/x.md');
  }
});

test('parseBriefFromFile (AC-18701-5): a [gadget] line raises LedgerError code usage before writing', () => {
  assert.throws(
    () => parseBriefFromFile('[gadget] text', {}),
    (err) => err instanceof LedgerError && err.code === 'usage' && err.message.includes('gadget'),
  );
});

// ---------------------------------------------------------------------------
// AC-17302-1 / 4: updateEntry (REQ-173 amendment).
// ---------------------------------------------------------------------------

test('updateEntry (AC-17302-1): patches brief fields and preserves id / addedAt', () => {
  let body = emptyLedger('brief');
  for (let i = 0; i < 7; i += 1) {
    ({ body } = addEntry({
      name: 'brief',
      body,
      entry: { kind: 'capability', text: `s${i}` },
      now: '2026-10-02T10:00:00Z',
    }));
  }
  const before = body.statements[6];
  const step = updateEntry({
    name: 'brief',
    body,
    id: 7,
    patch: { kind: 'constraint', resolvedBy: 'REQ-003' },
  });
  assert.equal(step.entry.id, 7);
  assert.equal(step.entry.addedAt, before.addedAt);
  assert.equal(step.entry.kind, 'constraint');
  assert.equal(step.entry.resolvedBy, 'REQ-003');
});

test('updateEntry (AC-17302-4 shape-only): updateEntry re-runs full-body validation', () => {
  let body = emptyLedger('brief');
  ({ body } = addEntry({
    name: 'brief', body, entry: { kind: 'capability', text: 'x' }, now: '2026-10-02T10:00:00Z',
  }));
  assert.throws(
    () => updateEntry({ name: 'brief', body, id: 1, patch: { kind: 'bogus' } }),
    (err) => err instanceof LedgerError && err.field?.includes('kind'),
  );
});

test('updateEntry (AC-17302-2): decisions update patches options and default and passes wellFormed shape', () => {
  let body = emptyLedger('decisions');
  ({ body } = addEntry({
    name: 'decisions',
    body,
    entry: {
      question: 'Which option?',
      options: [{ letter: 'a', text: 'first' }],
      default: null,
    },
    now: '2026-10-02T10:00:00Z',
  }));
  const step = updateEntry({
    name: 'decisions',
    body,
    id: 1,
    patch: {
      options: [{ letter: 'a', text: 'x' }, { letter: 'b', text: 'y' }],
      default: 'a',
    },
  });
  assert.equal(step.entry.options.length, 2);
  assert.equal(step.entry.default, 'a');
});

test('updateEntry: unknown id raises LedgerError code usage', () => {
  assert.throws(
    () => updateEntry({ name: 'brief', body: emptyLedger('brief'), id: 99, patch: { text: 'z' } }),
    (err) => err instanceof LedgerError && err.code === 'usage',
  );
});

// ---------------------------------------------------------------------------
// AC-17302-3: parseResolvedBy and the closed pointer grammar.
// ---------------------------------------------------------------------------

function treeFixture() {
  return {
    requirements: [{ reqId: 'REQ-003', title: 'Loan hold' }, { reqId: 'REQ-004', title: 'X' }],
    tacs: [{ tacId: 'TAC-4130-define-intake-brief' }],
    tad: {
      dataArchitecture: { coreEntities: [{ name: 'Loan' }, { name: 'Officer' }] },
      externalSystems: [{ name: 'CoreBanking' }],
    },
    prd: { users: [{ name: 'LoanOfficer' }] },
  };
}

test('parseResolvedBy (AC-17302-3): REQ-nnn resolves on the fixture', () => {
  const r = parseResolvedBy('REQ-003', treeFixture());
  assert.equal(r.ok, true);
  assert.equal(r.kind, 'req');
});

test('parseResolvedBy (AC-17302-3): TAD.entity:<name> resolves on the fixture', () => {
  const r = parseResolvedBy('TAD.entity:Loan', treeFixture());
  assert.equal(r.ok, true);
  assert.equal(r.kind, 'tadEntity');
});

test('parseResolvedBy (AC-17302-3): PRD.user:<name> resolves on the fixture', () => {
  const r = parseResolvedBy('PRD.user:LoanOfficer', treeFixture());
  assert.equal(r.ok, true);
  assert.equal(r.kind, 'prdUser');
});

test('parseResolvedBy (AC-17302-3): TAD.system:<name> resolves on the fixture', () => {
  const r = parseResolvedBy('TAD.system:CoreBanking', treeFixture());
  assert.equal(r.ok, true);
  assert.equal(r.kind, 'tadSystem');
});

test('parseResolvedBy (AC-17302-3): TAC-nnnn resolves on the fixture', () => {
  const r = parseResolvedBy('TAC-4130', treeFixture());
  assert.equal(r.ok, true);
  assert.equal(r.kind, 'tac');
});

test('parseResolvedBy (AC-17302-3): omitted:<reason> passes without a tree lookup', () => {
  const r = parseResolvedBy('omitted:out of scope', treeFixture());
  assert.equal(r.ok, true);
  assert.equal(r.kind, 'omitted');
});

test('parseResolvedBy (AC-17302-5): REQ-999 fails with "pointer does not resolve"', () => {
  const r = parseResolvedBy('REQ-999', treeFixture());
  assert.equal(r.ok, false);
  assert.equal(r.why, 'pointer does not resolve');
});

test('parseResolvedBy (AC-17302-4): a free-text pointer is outside the grammar', () => {
  const r = parseResolvedBy('loan thing', treeFixture());
  assert.equal(r.ok, false);
  assert.ok(r.why.includes('outside grammar') || r.why.includes('does not resolve'));
});

test('isResolvedByGrammar (AC-17302-4): accepts the six forms and refuses prose', () => {
  for (const p of ['REQ-003', 'TAD.entity:Loan', 'PRD.user:x', 'TAD.system:y', 'TAC-4130', 'omitted:scope']) {
    assert.equal(isResolvedByGrammar(p), true, p);
  }
  assert.equal(isResolvedByGrammar('loan thing'), false);
  assert.equal(isResolvedByGrammar(''), false);
});

test('ledgers: loadAllLedgers omits absent ledger files', async () => {
  const root = await scratch();
  // No files under rcf/define/ at all.
  const empty = await loadAllLedgers({ projectRoot: root });
  assert.deepEqual(Object.keys(empty), []);

  // Author brief only; other three stay absent.
  let brief = emptyLedger('brief');
  ({ body: brief } = addEntry({
    name: 'brief', body: brief,
    entry: { kind: 'capability', text: 'ship X' },
    now: '2026-09-24T10:00:00Z',
  }));
  await saveLedger({ projectRoot: root, name: 'brief', body: brief });
  const partial = await loadAllLedgers({ projectRoot: root });
  assert.deepEqual(Object.keys(partial).sort(), ['brief']);
  assert.deepEqual(partial.brief, brief);
  assert.equal(partial.decisions, undefined);
  assert.equal(partial.concerns, undefined);
  assert.equal(partial.probes, undefined);
});
