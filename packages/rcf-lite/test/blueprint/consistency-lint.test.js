// Unit tests for src/blueprint/consistency-lint.js. Covers the two
// mechanical passes over one blueprint's own model: pass 1
// (case-sensitive contract drift, undeclared restatement of an
// interface[].name-owned literal on an AC), and pass 2 (REQ that
// promises an externally observable property with no delivering TAC
// or ADR, or a link the TAC does not carry).
//
// Also covers AC-3 (the shipped edge-cloudflare-turnstile specimen)
// and the AC-4 suppression path.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  loadForLint,
  loadSuppressions,
  runLint,
  runPass1,
  runPass2,
} from '../../src/blueprint/consistency-lint.js';

const here = dirname(fileURLToPath(import.meta.url));
const shelfRoot = resolve(here, '..', '..', '..', '..', 'blueprints');

async function scaffoldBlueprint({ slug = 'test-bp', version = '1.0.0', tacs = [], reqs = [], userStories = [], adrs = [], guide = '', readme = '' } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'rcf-consistency-lint-'));
  await mkdir(join(root, 'contributions', 'tacs'), { recursive: true });
  await mkdir(join(root, 'contributions', 'requirements'), { recursive: true });
  await mkdir(join(root, 'contributions', 'user-stories'), { recursive: true });
  await mkdir(join(root, 'contributions', 'adrs'), { recursive: true });
  const contributions = [];
  for (const t of tacs) {
    const relPath = `tacs/${t.tacId}.json`;
    await writeFile(join(root, 'contributions', relPath), JSON.stringify(t, null, 2));
    contributions.push({ id: t.tacId, kind: 'tac', path: relPath });
  }
  for (const r of reqs) {
    const relPath = `requirements/${r.reqId}.json`;
    await writeFile(join(root, 'contributions', relPath), JSON.stringify(r, null, 2));
    contributions.push({ id: r.reqId, kind: 'req', path: relPath });
  }
  for (const us of userStories) {
    const relPath = `user-stories/${us.usId}.json`;
    await writeFile(join(root, 'contributions', relPath), JSON.stringify(us, null, 2));
    contributions.push({ id: us.usId, kind: 'us', path: relPath });
  }
  for (const adr of adrs) {
    const relPath = `adrs/${adr.adrId}.json`;
    await writeFile(join(root, 'contributions', relPath), JSON.stringify(adr, null, 2));
    contributions.push({ id: adr.adrId, kind: 'adr', path: relPath });
  }
  await writeFile(join(root, 'blueprint.json'), JSON.stringify({ slug, version, contributions }, null, 2));
  if (guide) {
    await mkdir(join(root, 'guide'), { recursive: true });
    await writeFile(join(root, 'guide', `${slug}.md`), guide);
  }
  if (readme) await writeFile(join(root, 'README.md'), readme);
  return root;
}

test('pass 1 fires on HTTP-header case drift between a TAC and the guide', async () => {
  const source = await scaffoldBlueprint({
    tacs: [{
      tacId: 'TAC-1',
      interfaces: [{ name: 'reader', kind: 'method', summary: 'reads the Cf-Turnstile-Response header from the payload.' }],
      responsibilities: [],
    }],
    guide: '```\ncf-turnstile-response: token-here\n```\n',
  });
  const input = await loadForLint(source);
  const findings = runPass1(input);
  const drift = findings.find((f) => f.kind === 'contractDrift' && f.subject === 'Cf-Turnstile-Response');
  assert.ok(drift, `expected a Cf-Turnstile-Response drift finding; got ${JSON.stringify(findings)}`);
  assert.match(drift.message, /guide.body spells 'Cf-Turnstile-Response' as 'cf-turnstile-response'/);
});

test('pass 1 fires on env-var case drift between a TAC and an AC', async () => {
  const source = await scaffoldBlueprint({
    tacs: [{
      tacId: 'TAC-2',
      interfaces: [],
      responsibilities: ['Read TURNSTILE_SECRET only via env-shaped facade.'],
    }],
    userStories: [{
      usId: 'US-1',
      acceptanceCriteria: [{ id: 'AC-1', then: 'given turnstile_secret is set, the verifier boots.' }],
    }],
  });
  const findings = runPass1(await loadForLint(source));
  const drift = findings.find((f) => f.kind === 'contractDrift' && f.subject === 'TURNSTILE_SECRET');
  assert.ok(drift, `expected env-var drift; got ${JSON.stringify(findings)}`);
});

test('pass 1 does NOT fire on sentence-start capitalisation of a hyphenated literal', async () => {
  const source = await scaffoldBlueprint({
    tacs: [{
      tacId: 'TAC-3',
      interfaces: [{ name: 'guard', kind: 'method', summary: 'the refuse-if-token-missing guard rejects missing-token submits.' }],
      responsibilities: [],
    }],
    userStories: [{
      usId: 'US-2',
      acceptanceCriteria: [{ id: 'AC-2', then: 'Refuse-if-token-missing behaviour is proved.' }],
    }],
  });
  const drifts = runPass1(await loadForLint(source)).filter((f) => f.kind === 'contractDrift');
  assert.equal(drifts.length, 0, `expected no drift on sentence-start capitalisation; got ${JSON.stringify(drifts)}`);
});

test('pass 1 fires undeclaredRestatement when an AC restates an interface[].name-owned literal with no ownerRef', async () => {
  const source = await scaffoldBlueprint({
    tacs: [{
      tacId: 'TAC-4',
      interfaces: [{ name: 'principalReader', kind: 'method', summary: 'reads the principal.' }],
      responsibilities: [],
    }],
    userStories: [{
      usId: 'US-3',
      acceptanceCriteria: [{ id: 'AC-3', description: 'the principalReader returns the current principal.', then: '' }],
    }],
  });
  const findings = runPass1(await loadForLint(source));
  const restated = findings.find((f) => f.kind === 'undeclaredRestatement' && f.subject === 'principalReader');
  assert.ok(restated, `expected undeclaredRestatement for principalReader; got ${JSON.stringify(findings)}`);
});

test('pass 1 does NOT fire undeclaredRestatement when the AC declares ownerRef.tacId matching the owner', async () => {
  const source = await scaffoldBlueprint({
    tacs: [{
      tacId: 'TAC-5',
      interfaces: [{ name: 'principalReader', kind: 'method', summary: 'reads the principal.' }],
      responsibilities: [],
    }],
    userStories: [{
      usId: 'US-4',
      acceptanceCriteria: [{ id: 'AC-4', description: 'the principalReader returns the current principal.', ownerRef: { tacId: 'TAC-5', field: 'interfaces[0].name' } }],
    }],
  });
  const restated = runPass1(await loadForLint(source)).filter((f) => f.kind === 'undeclaredRestatement');
  assert.equal(restated.length, 0, `ownerRef should suppress restatement; got ${JSON.stringify(restated)}`);
});

test('pass 2 fires reqNoDelivery when a promising REQ has no deliveredBy link', async () => {
  const source = await scaffoldBlueprint({
    tacs: [{ tacId: 'TAC-6', interfaces: [], responsibilities: [] }],
    reqs: [{
      reqId: 'REQ-1',
      description: 'The applied cache MUST NEVER exceed a 60-second staleness ceiling on any read.',
    }],
  });
  const findings = runPass2(await loadForLint(source));
  const noDelivery = findings.find((f) => f.kind === 'reqNoDelivery' && f.subject === 'REQ-1');
  assert.ok(noDelivery, `expected reqNoDelivery for REQ-1; got ${JSON.stringify(findings)}`);
});

test('pass 2 does NOT fire when the REQ description carries no promise phrase', async () => {
  const source = await scaffoldBlueprint({
    tacs: [{ tacId: 'TAC-7', interfaces: [], responsibilities: [] }],
    reqs: [{ reqId: 'REQ-2', description: 'The applied cache is read-through.' }],
  });
  const findings = runPass2(await loadForLint(source));
  assert.equal(findings.length, 0, `expected zero findings on non-promising REQ; got ${JSON.stringify(findings)}`);
});

test('pass 2 fires reqDeliveryNotCarried when deliveredBy.tacId names an absent TAC', async () => {
  const source = await scaffoldBlueprint({
    tacs: [{ tacId: 'TAC-8', interfaces: [], responsibilities: [] }],
    reqs: [{ reqId: 'REQ-3', description: 'On boot the connector MUST emit exactly one ready event.', deliveredBy: { tacId: 'TAC-NONEXISTENT' } }],
  });
  const findings = runPass2(await loadForLint(source));
  const notCarried = findings.find((f) => f.kind === 'reqDeliveryNotCarried' && f.refs.includes('TAC-NONEXISTENT'));
  assert.ok(notCarried, `expected reqDeliveryNotCarried for TAC-NONEXISTENT; got ${JSON.stringify(findings)}`);
});

test('pass 2 fires reqDeliveryNotCarried when deliveredBy.field is not present on the TAC', async () => {
  const source = await scaffoldBlueprint({
    tacs: [{ tacId: 'TAC-9', purpose: 'reads inputs', interfaces: [], responsibilities: ['emits nothing on boot'] }],
    reqs: [{ reqId: 'REQ-4', description: 'The connector MUST emit exactly one ready event.', deliveredBy: { tacId: 'TAC-9', field: 'boot.readyEvent' } }],
  });
  const findings = runPass2(await loadForLint(source));
  const notCarried = findings.find((f) => f.kind === 'reqDeliveryNotCarried' && f.refs.some((r) => /readyevent/i.test(r)));
  assert.ok(notCarried, `expected reqDeliveryNotCarried on readyEvent; got ${JSON.stringify(findings)}`);
});

test('pass 2 accepts a REQ whose deliveredBy.field is present on the target TAC', async () => {
  const source = await scaffoldBlueprint({
    tacs: [{ tacId: 'TAC-10', purpose: 'emits a readyEvent', interfaces: [], responsibilities: ['emits readyEvent on boot'] }],
    reqs: [{ reqId: 'REQ-5', description: 'The connector MUST emit a readyEvent.', deliveredBy: { tacId: 'TAC-10', field: 'boot.readyEvent' } }],
  });
  const findings = runPass2(await loadForLint(source));
  assert.equal(findings.length, 0, `expected zero findings; got ${JSON.stringify(findings)}`);
});

test('runLint honours a pass-1 suppression declared in the blueprint README', async () => {
  const readme = `# Test\n\n## Known chain-consistency-lint suppressions\n\n- pass1-drift-TAC-11-Cf-Test-Header: legacy specimen kept for round-N regression fixture.\n\n## Other\n`;
  const source = await scaffoldBlueprint({
    tacs: [{
      tacId: 'TAC-11',
      interfaces: [{ name: 'guard', kind: 'method', summary: 'accepts the Cf-Test-Header on the request.' }],
      responsibilities: [],
    }],
    guide: '```\ncf-test-header: 1\n```\n',
    readme,
  });
  const input = await loadForLint(source);
  const suppressions = await loadSuppressions(source);
  const res = runLint(input, suppressions);
  const suppressed = res.findings.find((f) => f.id === 'pass1-drift-TAC-11-Cf-Test-Header');
  assert.ok(suppressed, 'expected the drift finding to exist');
  assert.equal(suppressed.suppressed, true);
  assert.match(suppressed.suppressionReason, /legacy specimen/);
  assert.equal(res.verdict, 'pass', 'suppressed pass-1 findings should not fail the verdict');
});

test('runLint refuses to suppress a pass-2 finding (spec 5.8)', async () => {
  const readme = `# Test\n\n## Known chain-consistency-lint suppressions\n\n- pass2-no-delivery-REQ-6: not suppressible; kept for the assertion.\n\n## Other\n`;
  const source = await scaffoldBlueprint({
    tacs: [{ tacId: 'TAC-12', interfaces: [], responsibilities: [] }],
    reqs: [{ reqId: 'REQ-6', description: 'The system MUST always accept.' }],
    readme,
  });
  const input = await loadForLint(source);
  const suppressions = await loadSuppressions(source);
  const res = runLint(input, suppressions);
  const p2 = res.findings.find((f) => f.pass === 'pass2');
  assert.ok(p2, 'expected a pass-2 finding');
  assert.notEqual(p2.suppressed, true, 'pass-2 findings must never be marked suppressed');
  assert.equal(res.verdict, 'fail');
});

test('AC-3 (spec section 9): the shipped edge-cloudflare-turnstile blueprint fires pass-1 Cf-Turnstile-Response drift on the guide', async () => {
  const source = join(shelfRoot, 'edge-cloudflare-turnstile');
  const input = await loadForLint(source);
  assert.equal(input.error, undefined, `load failed: ${JSON.stringify(input)}`);
  const findings = runPass1(input);
  const specimen = findings.find((f) => f.kind === 'contractDrift' && /Cf-Turnstile-Response/i.test(f.subject) && f.refs.includes('guide'));
  assert.ok(specimen, `expected the Cf-Turnstile-Response guide-casing drift; got ${JSON.stringify(findings)}`);
});
