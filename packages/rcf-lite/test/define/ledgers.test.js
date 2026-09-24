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
  ledgerRelPath,
  loadAllLedgers,
  loadLedger,
  nextIdFor,
  parseBriefFromFile,
  resolveEntry,
  saveLedger,
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
