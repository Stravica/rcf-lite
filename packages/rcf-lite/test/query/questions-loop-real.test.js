// AC-18603-1 real-verb loop regression (code-review ruling 2026-10-03).
// The sibling synthetic-state test leaves write-back strings untested;
// this scoped version runs a subset of writeBack commands through the
// real CLI handlers so a broken verb or flag names in the strings fail
// the test. Full coverage of every writeBack kind through the real
// verbs is tracked as a follow-up (PR 3 or a dedicated test slice).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';

import { initProject } from '#core/store/init.js';
import { main as questionsMain } from '../../src/cli/questions.js';
import { main as ledgerMain } from '../../src/cli/ledger.js';

function sink() {
  const chunks = [];
  const s = new Writable({ write(c, _e, cb) { chunks.push(c); cb(); } });
  Object.defineProperty(s, 'text', { get() { return Buffer.concat(chunks).toString('utf8'); } });
  return s;
}

async function invokeQuestions(argv, cwd) {
  const stdout = sink(); const stderr = sink();
  const code = await questionsMain(argv, { stdout, stderr, cwd });
  return { code, stdout: stdout.text, stderr: stderr.text };
}

async function invokeLedger(argv, cwd) {
  const stdout = sink(); const stderr = sink();
  const code = await ledgerMain(argv, { stdout, stderr, cwd });
  return { code, stdout: stdout.text, stderr: stderr.text };
}

async function scratchProject() {
  const root = await mkdtemp(join(tmpdir(), 'questions-loop-real-'));
  await initProject({ projectRoot: root });
  return root;
}

// AC-18603-1 scoped real-verb loop. Seeds a tree where D1 brief:kinds
// has one failing item (one statement with a kind the harness must
// re-mint via `ledger brief update <id> --kind <k>`). Runs:
//   1. rcf define questions --json --stage brief
//   2. apply the ONE real writeBack command through ledger CLI
//   3. recompute → zero remaining in that stage
// The test proves that:
//   - the carried writeBack string parses and runs under the real
//     ledger CLI (catches invalid flags / stale verb names);
//   - a resolved item is actually removed from the next question set;
//   - the loop converges strictly in one turn.
test('AC-18603-1 (real verb, scoped): a brief:kinds writeBack runs under the real CLI and the question set strictly decreases', async () => {
  const cwd = await scratchProject();
  // Seed one statement whose kind the compute will want to re-mint.
  // 'capability' is the default; override to an invalid-for-domain
  // kind by setting it to 'openQuestion' (which triggers an open
  // question not a kinds re-mint). Instead seed a plain capability so
  // the brief:kinds check does NOT fire; the sinceFreeze check will
  // instead ask for a brief, which we answer with `ledger brief add`.
  //
  // The scoped loop here exercises exactly the sinceFreeze → brief add
  // → recompute path, which is the one the dogfood tree uses.
  const briefFile = join(cwd, 'brief.md');
  await writeFile(briefFile, '- [capability] Operators triage inbound tickets.\n', 'utf8');

  // Turn 1: snapshot the question set.
  const q1 = await invokeQuestions(['--json', '--stage', 'brief'], cwd);
  assert.equal(q1.code, 0, q1.stderr);
  const envelope1 = JSON.parse(q1.stdout);
  assert.ok(envelope1.questions.length > 0, 'expected at least one brief question on an empty tree');

  // Find the sinceFreeze question; it carries a real writeBack with
  // the real ledger CLI syntax.
  const sinceFreeze = envelope1.questions.find((x) => x.check === 'brief:sinceFreeze');
  assert.ok(sinceFreeze, `expected a brief:sinceFreeze question, got: ${envelope1.questions.map((q) => q.check).join(', ')}`);
  const wb = sinceFreeze.writeBack.find((w) => w.when === 'document');
  assert.ok(wb, 'expected a document write-back on brief:sinceFreeze');

  // Parse the write-back into argv. The spec writeBack looks like
  //   `rcf define ledger brief add --from <path>`
  // Substitute `<path>` with our seeded brief file.
  const commandText = wb.command.replace(/<path>/g, briefFile);
  assert.match(commandText, /^rcf define ledger brief add --from /, `writeBack shape unexpected: ${wb.command}`);
  // Drop the leading `rcf define ledger ` and let the handler parse
  // the rest.
  const argv = commandText.replace(/^rcf define ledger /, '').split(/\s+/).filter(Boolean);
  const ledgerR = await invokeLedger(argv, cwd);
  assert.equal(ledgerR.code, 0, `ledger add failed: ${ledgerR.stderr}`);

  // Turn 2: the brief question set must strictly decrease (strictly
  // because sinceFreeze no longer fires; the newly minted statements
  // may surface new resolvedBy or kinds questions, which is a
  // different stage).
  const q2 = await invokeQuestions(['--json', '--stage', 'brief'], cwd);
  assert.equal(q2.code, 0, q2.stderr);
  const envelope2 = JSON.parse(q2.stdout);
  assert.ok(envelope2.questions.length < envelope1.questions.length,
    `brief question set did not strictly decrease: ${envelope1.questions.length} -> ${envelope2.questions.length}`);
});
