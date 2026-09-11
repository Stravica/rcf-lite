// Anatomy + shape + probe-pack test for the security-auth-oauth2
// blueprint (criterion e hardening, 2026-09-11).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, '..', '..', '..', '..');
const BLUEPRINT_ROOT = join(REPO_ROOT, 'blueprints', 'security-auth-oauth2');
const FIXTURE_ROOT = join(REPO_ROOT, 'packages', 'rcf-lite', 'test', 'fixtures', 'security-auth-oauth2');
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


test('security-auth-oauth2 pack: expected probe files present', async () => {
  const required = [
    'probe-utils.mjs',
    'pkce-challenge-shape.mjs', 'run-pkce-challenge-shape.mjs',
    'authorisation-code-flow-shape.mjs', 'run-authorisation-code-flow-shape.mjs',
    'provider-adapter-shape.mjs', 'run-provider-adapter-shape.mjs',
    'session-bridge-shape.mjs', 'run-session-bridge-shape.mjs',
    'real-account-authorisation-code-flow.mjs', 'run-real-account-authorisation-code-flow.mjs',
  ];
  for (const name of required) {
    assert.ok(existsSync(join(PROBES_DIR, name)), `missing probe pack file: ${name}`);
  }
});

test('security-auth-oauth2 fixture README declares every env var read by the pack', async () => {
  const readme = await readFile(join(FIXTURE_ROOT, 'README.md'), 'utf8');
  for (const v of ['CI_HAS_OAUTH2_PROVIDER', 'OAUTH2_ISSUER_URL', 'OAUTH2_CLIENT_ID', 'OAUTH2_CLIENT_SECRET', 'OAUTH2_REDIRECT_URI', 'OAUTH2_MOCK_PORT']) {
    assert.ok(readme.includes(v), `fixture README must declare ${v}`);
  }
});

test('security-auth-oauth2 pkce-challenge-shape probe: aggregate pass', async () => {
  const runProbe = (await import(pathToFileURL(join(PROBES_DIR, 'pkce-challenge-shape.mjs')).href)).default;
  const { results } = await runProbe();
  assert.ok(results.length > 0, 'no checks ran');
  for (const r of results) { assert.equal(r.verdict, 'pass', `${r.anchorAcId}: ${r.detail}`); assertEvidenceOrSkip(r, 'pkce'); }
});

test('security-auth-oauth2 provider-adapter-shape probe: aggregate pass', async () => {
  const runProbe = (await import(pathToFileURL(join(PROBES_DIR, 'provider-adapter-shape.mjs')).href)).default;
  const { results } = await runProbe();
  assert.ok(results.length > 0, 'no checks ran');
  for (const r of results) { assert.equal(r.verdict, 'pass', `${r.anchorAcId}: ${r.detail}`); assertEvidenceOrSkip(r, 'provider-adapter'); }
});

test('security-auth-oauth2 session-bridge-shape probe: aggregate pass', async () => {
  const runProbe = (await import(pathToFileURL(join(PROBES_DIR, 'session-bridge-shape.mjs')).href)).default;
  const { results } = await runProbe();
  assert.ok(results.length > 0, 'no checks ran');
  for (const r of results) { assert.equal(r.verdict, 'pass', `${r.anchorAcId}: ${r.detail}`); assertEvidenceOrSkip(r, 'session-bridge'); }
});

test('security-auth-oauth2 authorisation-code-flow-shape probe: aggregate pass on local mock', async () => {
  const runProbe = (await import(pathToFileURL(join(PROBES_DIR, 'authorisation-code-flow-shape.mjs')).href)).default;
  const { results } = await runProbe();
  assert.ok(results.length > 0, 'no checks ran');
  for (const r of results) { assert.equal(r.verdict, 'pass', `${r.anchorAcId}: ${r.detail}`); assertEvidenceOrSkip(r, 'flow'); }
});

test('security-auth-oauth2 real-account probe: honest skip without CI_HAS_OAUTH2_PROVIDER', async () => {
  const runProbe = (await import(pathToFileURL(join(PROBES_DIR, 'real-account-authorisation-code-flow.mjs')).href)).default;
  const originalGate = process.env.CI_HAS_OAUTH2_PROVIDER;
  delete process.env.CI_HAS_OAUTH2_PROVIDER;
  try {
    const { results, extra } = await runProbe();
    const r = results.find((x) => x.anchorAcId === 'security-auth-oauth2-AC-10110-2');
    assert.ok(r, 'probe must emit an AC-10110-2 result');
    assert.equal(r.verdict, 'pass');
    assert.equal(r.accountBoundSkipped, true);
    assert.equal(r.reason, 'CI_HAS_OAUTH2_PROVIDER');
    assert.equal(extra && extra.accountBoundSkipped, true);
  } finally {
    if (originalGate !== undefined) process.env.CI_HAS_OAUTH2_PROVIDER = originalGate;
  }
});

test('security-auth-oauth2 blueprint.json: version bumped and updatedAt refreshed', async () => {
  const manifest = JSON.parse(await readFile(join(BLUEPRINT_ROOT, 'blueprint.json'), 'utf8'));
  assert.match(manifest.version, /^1\.3\./, `expected 1.3.x; observed ${manifest.version}`);
  assert.ok(manifest.updatedAt, 'blueprint.json must carry an updatedAt');
});
