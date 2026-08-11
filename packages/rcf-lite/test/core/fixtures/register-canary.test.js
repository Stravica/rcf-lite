// Tests for the `fixtures/register-canary/*.json` pack (Track D §7.3).
// The pack ships with at least three fixtures for v1; each fixture is
// consumed by the build package's canary runner and must satisfy the
// contract the grading dimensions expect.
//
// AC coverage:
//   - fixtures-01: pack ships at least three fixtures, named canary-prompt-01/-02/-03
//   - fixtures-02: every fixture carries the full contract (id, operatorPrompt, supportingArtefacts, grantedPermissions, wordCountBudget, notes)
//   - fixtures-03: `id` matches the filename stem
//   - fixtures-04: `grantedPermissions[]` uses known grant ids (matches register-canary matcher)
//   - fixtures-05: no em-dashes in fixture text (shipped-canonical-text lint)
//   - fixtures-06: fixtures are exposed via the package export map

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
// test/core/fixtures/ -> up three -> packages/rcf-lite -> src/core/fixtures/register-canary
const FIXTURE_DIR = join(HERE, '..', '..', '..', 'src', 'core', 'fixtures', 'register-canary');

const REQUIRED_FIELDS = ['id', 'operatorPrompt', 'supportingArtefacts', 'grantedPermissions', 'wordCountBudget', 'notes'];
const KNOWN_GRANT_IDS = new Set(['gitPush', 'githubRepoManagement', 'actionsWorkflowManagement']);
const REQUIRED_FIXTURE_IDS = new Set(['canary-prompt-01', 'canary-prompt-02', 'canary-prompt-03']);

async function loadFixtures() {
  const names = (await readdir(FIXTURE_DIR)).filter((n) => n.endsWith('.json')).sort();
  const out = [];
  for (const name of names) {
    const raw = await readFile(join(FIXTURE_DIR, name), 'utf8');
    out.push({ name, fixture: JSON.parse(raw) });
  }
  return out;
}

test('fixtures-01: pack ships at least three fixtures, named canary-prompt-01/-02/-03', async () => {
  const fixtures = await loadFixtures();
  assert.ok(fixtures.length >= 3, `expected >= 3 fixtures, got ${fixtures.length}`);
  const ids = new Set(fixtures.map((f) => f.fixture.id));
  for (const required of REQUIRED_FIXTURE_IDS) {
    assert.ok(ids.has(required), `missing fixture id: ${required}`);
  }
});

test('fixtures-02: every fixture carries the full contract', async () => {
  const fixtures = await loadFixtures();
  for (const { name, fixture } of fixtures) {
    for (const field of REQUIRED_FIELDS) {
      assert.ok(field in fixture, `${name}: missing field "${field}"`);
    }
    assert.equal(typeof fixture.operatorPrompt, 'string');
    assert.ok(fixture.operatorPrompt.length > 0, `${name}: empty operatorPrompt`);
    assert.ok(Array.isArray(fixture.supportingArtefacts), `${name}: supportingArtefacts must be an array`);
    assert.ok(Array.isArray(fixture.grantedPermissions), `${name}: grantedPermissions must be an array`);
    assert.equal(typeof fixture.wordCountBudget, 'number');
  }
});

test('fixtures-03: id matches the filename stem', async () => {
  const fixtures = await loadFixtures();
  for (const { name, fixture } of fixtures) {
    const stem = name.replace(/\.json$/, '');
    assert.equal(fixture.id, stem, `${name}: id mismatch`);
  }
});

test('fixtures-04: grantedPermissions[] uses known grant ids', async () => {
  const fixtures = await loadFixtures();
  for (const { name, fixture } of fixtures) {
    for (const grant of fixture.grantedPermissions) {
      assert.ok(
        KNOWN_GRANT_IDS.has(grant),
        `${name}: unknown grant "${grant}" - register-canary.js has no verb mapping for it`,
      );
    }
  }
});

test('fixtures-05: no em-dashes in fixture text (shipped-canonical-text lint)', async () => {
  const fixtures = await loadFixtures();
  const emDash = '—';
  const enDash = '–';
  for (const { name, fixture } of fixtures) {
    const scan = (label, value) => {
      if (typeof value === 'string') {
        assert.ok(!value.includes(emDash), `${name}${label}: contains em-dash`);
        assert.ok(!value.includes(enDash), `${name}${label}: contains en-dash`);
      }
    };
    scan(':operatorPrompt', fixture.operatorPrompt);
    scan(':notes', fixture.notes);
    for (const [i, artefact] of fixture.supportingArtefacts.entries()) {
      scan(`:supportingArtefacts[${i}].content`, artefact.content);
      scan(`:supportingArtefacts[${i}].path`, artefact.path);
    }
  }
});

test('fixtures-06: fixtures are exposed via the #core/fixtures subpath import', async () => {
  // Dynamic import via the #core/fixtures/register-canary/* subpath alias
  // declared in the umbrella's package.json `imports` field. This is the
  // path the canary runner uses to load the pack from src/core/fixtures/.
  const mod = await import('#core/fixtures/register-canary/canary-prompt-01.json', { with: { type: 'json' } });
  assert.equal(mod.default.id, 'canary-prompt-01');
});
