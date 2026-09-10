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

// Updated for visual round T-4 (spec 2026-09-06 section 5.4.2): each auth
// blueprint declared the round T-4 capability additions in the same PR as
// the application-account-settings v1.0.0 shelf blueprint. Magic-link is
// a doc-only bump (no new capability strings; the click-a-link flow is
// the whole surface). Clerk adds sessionInventory and hostedIdentityUi;
// Keycloak adds credentialSelfService and sessionInventory; OAuth2 adds
// credentialSelfService, sessionInventory and hostedIdentityUi (provider-
// conditional per the OAuth2 README).
const EXPECTED = [
  { slug: 'security-auth-magic-link', version: '1.2.2', capabilities: ['principalDirectory'] },
  { slug: 'security-auth-clerk', version: '1.5.0', capabilities: ['principalDirectory', 'roleModel', 'sessionInventory', 'hostedIdentityUi'] },
  { slug: 'security-auth-oauth2', version: '1.3.1', capabilities: ['principalDirectory', 'roleModel', 'credentialSelfService', 'sessionInventory', 'hostedIdentityUi', 'authorisationCodeFlow'] },
  { slug: 'security-auth-keycloak', version: '1.4.0', capabilities: ['principalDirectory', 'roleModel', 'credentialSelfService', 'sessionInventory'] },
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
    // T-4 entries cite section 5.4.2 (T-5 legacy entries still cite 5.5.2).
    assert.ok(cl.includes('5.4.2') || cl.includes('5.5.2'), `${spec.slug} CHANGELOG cites the ratifying spec section`);
  }
});

// Anatomy assertions for the audit-event stories added under the second
// closure fix pass. Each named story carries exactly the expected
// acceptanceCriteria count so the suite catches a regression that adds
// or drops one.
const AUDIT_STORY_AC_COUNTS = [
  { slug: 'security-auth-keycloak', usId: 'security-auth-keycloak-US-11116', expected: 7 },
  { slug: 'security-auth-keycloak', usId: 'security-auth-keycloak-US-11117', expected: 7 },
  { slug: 'security-auth-keycloak', usId: 'security-auth-keycloak-US-11118', expected: 7 },
  { slug: 'security-auth-keycloak', usId: 'security-auth-keycloak-US-11119', expected: 7 },
  { slug: 'security-auth-keycloak', usId: 'security-auth-keycloak-US-11120', expected: 6 },
  { slug: 'security-auth-clerk', usId: 'security-auth-clerk-US-9113', expected: 6 },
];

test('keycloak and clerk audit-event user stories carry the expected AC counts (TC-051-audit-story-ac-counts)', async () => {
  for (const spec of AUDIT_STORY_AC_COUNTS) {
    const bareId = spec.usId.split('-').pop();
    const path = join(
      REPO_ROOT,
      'blueprints',
      spec.slug,
      'contributions',
      'user-stories',
      `${spec.slug}-us-${bareId}.json`,
    );
    const doc = JSON.parse(await readFile(path, 'utf8'));
    assert.equal(doc.usId, spec.usId, `${spec.usId} document usId`);
    assert.equal(
      doc.acceptanceCriteria.length,
      spec.expected,
      `${spec.usId} expected ${spec.expected} ACs, saw ${doc.acceptanceCriteria.length}`,
    );
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
