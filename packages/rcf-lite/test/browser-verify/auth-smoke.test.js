// Auth-REQ smoke checks tests (spec §9).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { runAuthSmokeChecks, shouldRunAuthSmokeChecks } from '../../src/browser-verify/auth-smoke.js';

function stubFetch(map) {
  return async (url, init) => {
    const key = `${init?.method ?? 'GET'} ${url.replace(/^https?:\/\/[^/]+/, '')}`;
    const record = map[key];
    if (!record) throw new Error(`no stub for ${key}`);
    return {
      status: record.status,
      headers: { get: (n) => (record.headers ?? {})[String(n).toLowerCase()] ?? null },
    };
  };
}

test('shouldRunAuthSmokeChecks returns true when the FBS binds an auth service', () => {
  const fbs = { dependsOnServices: [{ serviceCategory: 'auth' }] };
  assert.equal(shouldRunAuthSmokeChecks(fbs, null), true);
});

test('shouldRunAuthSmokeChecks returns true when the baseline says HTML login is required', () => {
  const baseline = { defaults: { authFlow: { htmlLoginPageRequired: true, smokeChecksRequired: true } } };
  assert.equal(shouldRunAuthSmokeChecks({}, baseline), true);
});

test('shouldRunAuthSmokeChecks returns false when the baseline explicitly opts out of smoke checks', () => {
  const baseline = { defaults: { authFlow: { htmlLoginPageRequired: true, smokeChecksRequired: false } } };
  assert.equal(shouldRunAuthSmokeChecks({}, baseline), false);
});

test('runAuthSmokeChecks passes on 200/text-html /login, 302 /logout, 400 verify', async () => {
  const fetch = stubFetch({
    'GET /login': { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } },
    'POST /logout': { status: 302 },
    'GET /login/verify?token=': { status: 400 },
  });
  const results = await runAuthSmokeChecks({ fetch, runtimeUrl: 'http://127.0.0.1:3000' });
  assert.equal(results[0].verdict, 'pass');
  assert.equal(results[1].verdict, 'pass');
  assert.equal(results[2].verdict, 'pass');
});

test('runAuthSmokeChecks fails /login on 404 and reports the status', async () => {
  const fetch = stubFetch({
    'GET /login': { status: 404, headers: {} },
    'POST /logout': { status: 302 },
    'GET /login/verify?token=': { status: 400 },
  });
  const results = await runAuthSmokeChecks({ fetch, runtimeUrl: 'http://127.0.0.1:3000' });
  assert.equal(results[0].verdict, 'fail');
  assert.match(results[0].detail, /status 404/);
});

test('runAuthSmokeChecks fails /login on non-html content-type', async () => {
  const fetch = stubFetch({
    'GET /login': { status: 200, headers: { 'content-type': 'application/json' } },
    'POST /logout': { status: 302 },
    'GET /login/verify?token=': { status: 400 },
  });
  const results = await runAuthSmokeChecks({ fetch, runtimeUrl: 'http://127.0.0.1:3000' });
  assert.equal(results[0].verdict, 'fail');
  assert.match(results[0].detail, /application\/json/);
});

test('runAuthSmokeChecks flags the empty-token accept as a fail (regression)', async () => {
  const fetch = stubFetch({
    'GET /login': { status: 200, headers: { 'content-type': 'text/html' } },
    'POST /logout': { status: 302 },
    'GET /login/verify?token=': { status: 200 }, // vuln: empty token accepted
  });
  const results = await runAuthSmokeChecks({ fetch, runtimeUrl: 'http://127.0.0.1:3000' });
  assert.equal(results[2].verdict, 'fail');
  assert.match(results[2].detail, /empty-token/);
});
