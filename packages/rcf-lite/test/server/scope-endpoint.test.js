// HTTP-behaviour tests for /scope.json. Wires the handler through a
// real http.Server so response codes / bodies / headers reflect the
// production shape.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

import { createScopeHandler } from '../../src/server/scope-endpoint.js';

async function withServer(handler, run) {
  const server = createServer((req, res) => {
    Promise.resolve(handler(req, res)).catch(() => {
      try { res.writeHead(500); res.end('err'); } catch { /* soft */ }
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const port = server.address().port;
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(() => resolve()));
  }
}

test('scope endpoint returns applied index with no params', async () => {
  const manifest = {
    blueprints: [
      { slug: 'a', version: '1.0.0', appliedAt: 't0', contributions: [{ id: 'X-1' }] },
      { slug: 'b', version: '2.0.0', appliedAt: 't1', contributions: [{ id: 'Y-1' }, { id: 'Y-2' }] },
    ],
  };
  const handler = createScopeHandler({
    projectRoot: '/nope',
    _readManifest: async () => manifest,
    _detectCustomisations: async () => ({ customisedIds: [], missingSourceIds: [] }),
  });
  await withServer(handler, async (base) => {
    const r = await fetch(`${base}/scope.json`);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), 'application/json; charset=utf-8');
    const body = await r.json();
    assert.deepEqual(body.blueprints.map((b) => b.slug), ['a', 'b']);
    assert.equal(body.blueprints[1].contributionCount, 2);
  });
});

test('scope endpoint returns full record for a known blueprint', async () => {
  const manifest = {
    blueprints: [{
      slug: 'application-spa',
      version: '1.3.1',
      appliedAt: '2026-08-30T10:00:00Z',
      contributions: [
        { id: 'application-spa-REQ-001', kind: 'req', path: 'rcf/reqs/application-spa-req-001.json' },
        { id: 'ADR-201-application-spa', kind: 'adr', path: 'rcf/adrs/adr-201-application-spa.json' },
      ],
    }],
  };
  const handler = createScopeHandler({
    projectRoot: '/nope',
    _readManifest: async () => manifest,
    _detectCustomisations: async ({ record }) => {
      assert.equal(record.slug, 'application-spa');
      return { customisedIds: ['ADR-201-application-spa'], missingSourceIds: [] };
    },
  });
  await withServer(handler, async (base) => {
    const r = await fetch(`${base}/scope.json?blueprint=application-spa`);
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.slug, 'application-spa');
    assert.equal(body.version, '1.3.1');
    assert.deepEqual(body.contributionIds, ['application-spa-REQ-001', 'ADR-201-application-spa']);
    assert.deepEqual(body.customisedIds, ['ADR-201-application-spa']);
    assert.deepEqual(body.missingSourceIds, []);
  });
});

test('scope endpoint 404s on an unknown blueprint slug', async () => {
  const handler = createScopeHandler({
    projectRoot: '/nope',
    _readManifest: async () => ({ blueprints: [] }),
    _detectCustomisations: async () => ({ customisedIds: [], missingSourceIds: [] }),
  });
  await withServer(handler, async (base) => {
    const r = await fetch(`${base}/scope.json?blueprint=nope`);
    assert.equal(r.status, 404);
    const body = await r.json();
    assert.equal(body.error, 'unknownBlueprint');
    assert.equal(body.slug, 'nope');
  });
});

test('scope endpoint 500s cleanly when the manifest read throws', async () => {
  const handler = createScopeHandler({
    projectRoot: '/nope',
    _readManifest: async () => { throw new Error('permission denied'); },
    _detectCustomisations: async () => ({ customisedIds: [], missingSourceIds: [] }),
  });
  await withServer(handler, async (base) => {
    const r = await fetch(`${base}/scope.json?blueprint=x`);
    assert.equal(r.status, 500);
    const body = await r.json();
    assert.equal(body.error, 'ioFailure');
    assert.match(body.message, /permission denied/);
  });
});
