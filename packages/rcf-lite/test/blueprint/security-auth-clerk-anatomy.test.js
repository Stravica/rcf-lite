// Anatomy + shape + probe-pack test for the security-auth-clerk
// blueprint (criterion e hardening, 2026-09-11). Pins the probe
// pack shape, the fixture env-var manifest, the local-probe
// aggregateVerdict on the fixture-driven paths, and the account-
// bound skip shape on the live probe when CI_HAS_CLERK_ACCOUNT is
// unset.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, '..', '..', '..', '..');
const BLUEPRINT_ROOT = join(REPO_ROOT, 'blueprints', 'security-auth-clerk');
const FIXTURE_ROOT = join(REPO_ROOT, 'packages', 'rcf-lite', 'test', 'fixtures', 'security-auth-clerk');
const PROBES_DIR = join(BLUEPRINT_ROOT, 'contributions', 'probes');

// Rule 7d evidence-shape asserter (closure addendum rule 6): every
// result row carries either an `evidence` object matching one of
// the four 7d shapes (request id + status; response body excerpt;
// created-then-deleted resource id + inventory diff; deploy record)
// or `accountBoundSkipped: true` with a non-empty `reason`. An
// empty `{}` on evidence is refused; verdict alone never satisfies
// rule 7d.
const KNOWN_EVIDENCE_KEYS = new Set([
  // shape 1 -- real request id
  'requestId', 'providerMessageId', 'x-request-id',
  // shape 2 -- response body excerpt
  'bodyExcerpt', 'sopsMetadata', 'adapterReturn', 'parserReturn', 'validatorReturn', 'verifierReturn',
  'bodyKeys', 'bodyRedacted', 'byteCompare', 'macBefore', 'macAfter', 'metaBefore', 'metaAfter',
  // shape 3 -- created-then-deleted resource id / inventory diff
  'createdUserId', 'createdThenRevokedTokenId', 'listPostAbsence', 'tokenId',
  'orphanUserId', 'resourceId', 'createdId', 'deletedId',
  // shape 4 -- deploy record
  'deployId', 'deploymentUrl', 'deployStatus',
  // acceptable diagnostic keys accompanying a shape-carrying row
  'status', 'gate', 'observedValue', 'expected', 'call', 'calls',
  'shapeBadSample', 'sampledN', 'jwtShapedSample', 'uniqueCount', 'requested',
  'input', 'output', 'source', 'knownRoles', 'notObservableACs', 'notObservableACsOrREQs',
  'notObservableAt', 'notObservableReason', 'docsUrl', 'docsVerifiedOn', 'preExchange',
  'codeStillInActiveCodes', 'observedStates', 'error', 'detail',
  'accessTokenPresent', 'idTokenPresent', 'idTokenSegments', 'tokenType',
  'handlePrefix', 'handleLen', 'sessionKeys', 'providerTokenLeaks',
  'clockAdvancedByMs', 'defaultTtlSeconds', 'principalId', 'sub',
  'derivationMatched', 'verifierLength', 'challengePreviewFirst8', 'method', 'mutation', 'collidedWithOriginal',
  'min', 'max', 'endpoints', 'roles', 'reason', 'threw', 'skipped',
  'sameRecipients', 'macDiverged', 'exitStatus', 'refused', 'from', 'to',
  'adapterKind', 'outcomeKeys', 'outcomeShapeOk', 'outcome', 'shapeOk', 'verifyOk',
  'localTokenLen', 'localVerifyOk', 'stdoutLen', 'statusB', 'matched',
  'before', 'after', 'createStatus', 'createRequestId', 'readBackStatus', 'readBackRequestId',
  'listPreCount', 'listPreContainsCreated', 'deleteStatus', 'deleteRequestId',
  'listPostCount', 'revokeStatus', 'revokeRequestId', 'readBackTokenStatus',
  'postListStatus', 'postListRequestId', 'postListIsArray', 'postListLength',
  'length', 'isArray', 'tokenStatus', 'oidc', 'redirectUri', 'state', 'codeIssued', 'codeChallengeMethod',
  'gateMisconfigured', 'accountBoundSkipped', 'unsetVars', 'envDeclared',
  'teardownError', 'plaintextLen', 'ciphertextLen', 'redactedBody',
  'sha256', 'originalLength', 'decryptedLength', 'originalSha256', 'decryptedSha256', 'bytesEqual', 'bufferCompareZero',
]);
function assertEvidenceOrSkip(r, ctx = '') {
  if (r.accountBoundSkipped === true) {
    assert.ok(typeof r.reason === 'string' && r.reason.length > 0, `${ctx} accountBoundSkipped requires a non-empty reason on ${r.anchorAcId}`);
    return;
  }
  assert.ok(r.evidence && typeof r.evidence === 'object' && !Array.isArray(r.evidence), `${ctx} result must carry evidence object on ${r.anchorAcId}: ${r.detail}`);
  const keys = Object.keys(r.evidence);
  assert.ok(keys.length > 0, `${ctx} empty evidence {} is refused on ${r.anchorAcId}: ${r.detail}`);
  const hasShapeKey = keys.some((k) => KNOWN_EVIDENCE_KEYS.has(k));
  assert.ok(hasShapeKey, `${ctx} evidence must include at least one of the 7d shape-carrying keys (requestId / bodyExcerpt / adapterReturn / createdUserId / providerMessageId / sopsMetadata / deployId / etc.) on ${r.anchorAcId}: keys=${JSON.stringify(keys)}`);
}


test('security-auth-clerk pack: expected probe files present', async () => {
  const required = [
    'probe-utils.mjs',
    'role-model-adapter.mjs',
    'run-role-model-adapter.mjs',
    'hosted-identity-ui-config.mjs',
    'run-hosted-identity-ui-config.mjs',
    'real-account-principal-directory-round-trip.mjs',
    'run-real-account-principal-directory-round-trip.mjs',
    'real-account-session-inventory.mjs',
    'run-real-account-session-inventory.mjs',
  ];
  for (const name of required) {
    assert.ok(existsSync(join(PROBES_DIR, name)), `missing probe pack file: ${name}`);
  }
});

test('security-auth-clerk fixture README declares every env var read by the pack', async () => {
  const readme = await readFile(join(FIXTURE_ROOT, 'README.md'), 'utf8');
  for (const v of ['CI_HAS_CLERK_ACCOUNT', 'CLERK_SECRET_KEY', 'CLERK_PUBLISHABLE_KEY', 'CLERK_API_BASE_URL', 'GITHUB_RUN_ID']) {
    assert.ok(readme.includes(v), `fixture README must declare ${v}`);
  }
  // Every var read by the probes must appear in DECLARED_ENV export.
  const utils = await readFile(join(PROBES_DIR, 'probe-utils.mjs'), 'utf8');
  for (const v of ['CI_HAS_CLERK_ACCOUNT', 'CLERK_SECRET_KEY', 'CLERK_PUBLISHABLE_KEY', 'CLERK_API_BASE_URL', 'GITHUB_RUN_ID']) {
    assert.ok(utils.includes(`'${v}'`), `probe-utils DECLARED_ENV must include ${v}`);
  }
});

test('security-auth-clerk role-model-adapter probe: aggregate pass on fixture', async () => {
  const runProbe = (await import(pathToFileURL(join(PROBES_DIR, 'role-model-adapter.mjs')).href)).default;
  const { results } = await runProbe();
  assert.ok(results.length > 0, 'no checks ran');
  const kinds = new Set(results.map((r) => r.anchorAcId));
  assert.ok(kinds.has('security-auth-clerk-REQ-004'), 'role-adapter results must anchor REQ-004 (no AC covers reduction, closure rule 1)');
  for (const r of results) { assert.equal(r.verdict, 'pass', `${r.anchorAcId}: ${r.detail}`); assertEvidenceOrSkip(r, 'role-model'); }
});

test('security-auth-clerk hosted-identity-ui-config probe: aggregate pass on fixture', async () => {
  const runProbe = (await import(pathToFileURL(join(PROBES_DIR, 'hosted-identity-ui-config.mjs')).href)).default;
  const { results } = await runProbe();
  assert.ok(results.length > 0, 'no checks ran');
  for (const r of results) { assert.equal(r.verdict, 'pass', `${r.anchorAcId}: ${r.detail}`); assertEvidenceOrSkip(r, 'hosted-ui'); }
});

test('security-auth-clerk real-account principal-directory probe: honest skip without CI_HAS_CLERK_ACCOUNT', async () => {
  const runProbe = (await import(pathToFileURL(join(PROBES_DIR, 'real-account-principal-directory-round-trip.mjs')).href)).default;
  const originalGate = process.env.CI_HAS_CLERK_ACCOUNT;
  delete process.env.CI_HAS_CLERK_ACCOUNT;
  try {
    const { results, extra } = await runProbe();
    const r = results.find((x) => x.anchorAcId === 'security-auth-clerk-REQ-008');
    assert.ok(r, 'probe must emit a REQ-008 result');
    assert.equal(r.verdict, 'pass');
    assert.equal(r.accountBoundSkipped, true);
    assert.equal(r.reason, 'CI_HAS_CLERK_ACCOUNT');
    assert.equal(extra && extra.accountBoundSkipped, true);
  } finally {
    if (originalGate !== undefined) process.env.CI_HAS_CLERK_ACCOUNT = originalGate;
  }
});

test('security-auth-clerk real-account session-inventory probe: honest skip without CI_HAS_CLERK_ACCOUNT', async () => {
  const runProbe = (await import(pathToFileURL(join(PROBES_DIR, 'real-account-session-inventory.mjs')).href)).default;
  const originalGate = process.env.CI_HAS_CLERK_ACCOUNT;
  delete process.env.CI_HAS_CLERK_ACCOUNT;
  try {
    const { results, extra } = await runProbe();
    const r = results.find((x) => x.anchorAcId === 'security-auth-clerk-REQ-008');
    assert.ok(r, 'probe must emit a REQ-008 result');
    assert.equal(r.verdict, 'pass');
    assert.equal(r.accountBoundSkipped, true);
    assert.equal(r.reason, 'CI_HAS_CLERK_ACCOUNT');
    assert.equal(extra && extra.accountBoundSkipped, true);
  } finally {
    if (originalGate !== undefined) process.env.CI_HAS_CLERK_ACCOUNT = originalGate;
  }
});

test('security-auth-clerk blueprint.json: version bumped and updatedAt refreshed', async () => {
  const manifest = JSON.parse(await readFile(join(BLUEPRINT_ROOT, 'blueprint.json'), 'utf8'));
  assert.match(manifest.version, /^1\.5\./, `version prefix expected 1.5.x for the criterion-e bump; observed ${manifest.version}`);
  assert.ok(manifest.updatedAt, 'blueprint.json must carry an updatedAt');
});
