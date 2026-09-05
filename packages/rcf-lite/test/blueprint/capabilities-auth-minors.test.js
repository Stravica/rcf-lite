// Auth-blueprint minor-bump tests for the capability-declaration
// mechanism (visual round T-5 spec section 5.5.2, Baz Q2 default).
// Covers TS-051 test cases TC-051-auth-minors and TC-051-docs-section-6a.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, '..', '..', '..', '..');

const EXPECTED = [
  { slug: 'security-auth-magic-link', version: '1.1.0', capabilities: ['principalDirectory'] },
  { slug: 'security-auth-clerk', version: '1.2.0', capabilities: ['principalDirectory', 'roleModel'] },
  { slug: 'security-auth-oauth2', version: '1.1.0', capabilities: ['principalDirectory', 'roleModel'] },
  { slug: 'security-auth-keycloak', version: '1.1.0', capabilities: ['principalDirectory', 'roleModel'] },
];

test('the four shelf auth blueprints declare capabilities[] and matching CHANGELOG entries (TC-051-auth-minors)', async () => {
  for (const spec of EXPECTED) {
    const bpPath = join(REPO_ROOT, 'blueprints', spec.slug, 'blueprint.json');
    const doc = JSON.parse(await readFile(bpPath, 'utf8'));
    assert.equal(doc.slug, spec.slug);
    assert.equal(doc.version, spec.version, `${spec.slug} version`);
    assert.deepEqual([...doc.capabilities].sort(), [...spec.capabilities].sort(), `${spec.slug} capabilities`);
    const cl = await readFile(join(REPO_ROOT, 'blueprints', spec.slug, 'CHANGELOG.md'), 'utf8');
    assert.ok(cl.includes(`## ${spec.version}`), `${spec.slug} CHANGELOG has ${spec.version} header`);
    assert.ok(cl.includes('capabilities'), `${spec.slug} CHANGELOG mentions capabilities`);
    assert.ok(cl.includes('5.5.2'), `${spec.slug} CHANGELOG cites spec section 5.5.2`);
  }
});

test('docs blueprint-authoring section 6a carries the capability vocabulary table (TC-051-docs-section-6a)', async () => {
  const docPath = join(REPO_ROOT, 'packages', 'rcf-lite', 'docs', 'blueprint-authoring.md');
  const text = await readFile(docPath, 'utf8');
  assert.ok(text.includes('Capability declaration extension'), 'section 6a has capability extension header');
  const requiredCells = ['principalDirectory', 'roleModel', 'tenancy', 'auditLog', 'security-auth-clerk', 'security-auth-magic-link'];
  for (const cell of requiredCells) {
    assert.ok(text.includes(cell), `docs mention ${cell}`);
  }
  assert.ok(text.includes('`capabilities[]`'), 'docs name the loader field capabilities[]');
  assert.ok(text.includes('`requiresAppliedCapabilities`'), 'docs name the loader field requiresAppliedCapabilities');
  assert.ok(text.includes('rcf/blueprints/${slug}.applied.json'), 'docs describe the sidecar contract');
});
