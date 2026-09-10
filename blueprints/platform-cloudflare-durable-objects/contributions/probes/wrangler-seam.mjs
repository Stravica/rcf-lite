// Wrangler-seam probe for platform-cloudflare-durable-objects v1.0.0.
//
// Spawns `wrangler dev --local` on the cf-platform fixture and
// exercises the two shipped DO shapes through workerd:
//
//  (a) two concurrent `POST /cell/<id>/increment` requests routed
//      through `src/index.mjs` -> `createDoFacade({env}).cellFetch`
//      -> `env.CELL.idFromName(id).fetch(...)` -> the shipped
//      SingleCellObject class. Asserts the two responses observe
//      per-instance serialisation: counters equal [1, 2] in some
//      order, witnesses equal [0, 1] in some order (each request
//      observed the prior write). Under the shipped code path the
//      SingleCellObject `_serialise` promise queue plus workerd's
//      per-instance dispatch both provide the guarantee; removing
//      the queue surfaces two responses of {counter:1, witness:0}
//      on the mutation-run.
//  (b) one WebSocket upgrade against `/hub/<id>/connect` reaching
// `env.HUB`; asserts a single broadcast frame arrives on
//      connect (the shipped HubObject fetch handler accepts the
//      server half via `state.acceptWebSocket` and sends one
//      broadcast frame immediately, so the probe does not need a
//      second client to trigger fan-out).
//
// The probe also carries an additional AC-33108-1 result that
// greps the fixture wrangler.toml for the two `[[durable_objects.bindings]]`
// binding pairs (name/class_name) and the `[[migrations]]` block
// (tag `"v1"` plus new_sqlite_classes for both classes). That result is
// deterministic and does not require wrangler.
//
// Warn semantics per section 3.1 pass-with-skip: if the wrangler
// devDependency is missing under `packages/rcf-lite/test/fixtures/cf-platform/node_modules/.bin`,
// or if the CLI does not bind within the cap, the probe returns
// aggregateVerdict warn (never fail); the wrangler.toml grep result
// still runs and reports pass. A handler thrown at the workerd
// boundary is a genuine `fail` per the gate reviewer's directive.
//
// anchorAcId: AC-33113-1 (wrangler-seam runtime coverage);
// AC-33108-1 covered as an additional result.
// accountBound: false.

import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const anchorAcId = 'AC-33113-1';
export const accountBound = false;

const BIND_CAP_MS = 45000;
const KILL_GRACE_MS = 2000;
const WS_CAP_MS = 5000;

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = resolve(HERE, '..', '..', '..', '..', 'packages', 'rcf-lite', 'test', 'fixtures', 'cf-platform');

function findWranglerBin() {
  const candidate = resolve(FIXTURE_DIR, 'node_modules', '.bin', 'wrangler');
  return existsSync(candidate) ? candidate : null;
}

async function killAndDrain(proc) {
  if (!proc || proc.killed) return;
  try { proc.kill('SIGTERM'); } catch (_err) { /* best effort */ }
  await new Promise((r) => setTimeout(r, KILL_GRACE_MS));
  try { if (!proc.killed) proc.kill('SIGKILL'); } catch (_err) { /* best effort */ }
}

async function greppedWranglerToml() {
  const toml = await readFile(resolve(FIXTURE_DIR, 'wrangler.toml'), 'utf8');
  const cellNameHit = /name = "CELL"/.test(toml);
  const cellClassHit = /class_name = "SingleCellObject"/.test(toml);
  const hubNameHit = /name = "HUB"/.test(toml);
  const hubClassHit = /class_name = "HubObject"/.test(toml);
  const tagHit = /tag = "v1"/.test(toml);
  const newClassesHit = /new_sqlite_classes = \["SingleCellObject", "HubObject"\]/.test(toml);
  // Per the Cloudflare Durable Objects migrations page, key-value backed
  // namespaces can no longer be created; only new_sqlite_classes mints one.
  // The probe refuses a wrangler.toml that still asserts the deprecated keyword,
  // so a re-shipped blueprint cannot silently regress to the old shape.
  // Vendor: https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/
  const deprecatedNewClassesRefused = !/(^|\n)\s*new_classes\s*=/.test(toml);
  return {
    ok: cellNameHit && cellClassHit && hubNameHit && hubClassHit && tagHit && newClassesHit && deprecatedNewClassesRefused,
    hits: { cellNameHit, cellClassHit, hubNameHit, hubClassHit, tagHit, newClassesHit, deprecatedNewClassesRefused },
  };
}

async function driveConcurrentIncrements(boundUrl) {
  const target = `${boundUrl}/cell/wrangler-seam-cell-${Date.now()}/increment`;
  const [a, b] = await Promise.all([
    fetch(target, { method: 'POST' }),
    fetch(target, { method: 'POST' }),
  ]);
  if (!a.ok || !b.ok) {
    return { ok: false, reason: `HTTP status a=${a.status} b=${b.status}`, target };
  }
  const [ja, jb] = await Promise.all([a.json(), b.json()]);
  const counters = [ja.counter, jb.counter].sort((x, y) => x - y);
  const witnesses = [ja.witness, jb.witness].sort((x, y) => x - y);
  const serialised =
    counters[0] === 1 && counters[1] === 2 &&
    witnesses[0] === 0 && witnesses[1] === 1;
  return {
    ok: serialised,
    counters,
    witnesses,
    responses: [ja, jb],
    target,
  };
}

async function drainOneWebSocketFrame(boundUrl) {
  const wsUrl = boundUrl.replace(/^http/, 'ws') + `/hub/wrangler-seam-hub-${Date.now()}/connect`;
  return new Promise((resolveResult) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { ws.close(); } catch (_err) { /* best effort */ }
      resolveResult({ ok: false, reason: `no frame received within ${WS_CAP_MS}ms`, wsUrl });
    }, WS_CAP_MS);
    let ws;
    try {
      ws = new WebSocket(wsUrl);
    } catch (err) {
      clearTimeout(timer);
      settled = true;
      return resolveResult({ ok: false, reason: `WebSocket construct threw: ${err && err.message ? err.message : String(err)}`, wsUrl });
    }
    ws.addEventListener('message', (ev) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const payload = typeof ev.data === 'string' ? ev.data : String(ev.data);
      try { ws.close(); } catch (_err) { /* best effort */ }
      resolveResult({ ok: payload.includes('"payload":"hello-from-hub"'), payload, wsUrl });
    });
    ws.addEventListener('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveResult({ ok: false, reason: `WebSocket error: ${err && err.message ? err.message : 'no message'}`, wsUrl });
    });
    ws.addEventListener('close', (ev) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveResult({ ok: false, reason: `WebSocket closed before message: code=${ev.code} reason=${ev.reason}`, wsUrl });
    });
  });
}

export default async function runProbe() {
  const results = [];

  // AC-33108-1 (additional result): wrangler.toml literal-strings
  // grep. Deterministic; runs first so a wrangler-missing warn
  // does not hide it.
  const toml = await greppedWranglerToml();
  results.push({
    anchorAcId: 'AC-33108-1',
    verdict: toml.ok ? 'pass' : 'fail',
    detail: toml.ok
      ? `wrangler.toml carries name="CELL" + class_name="SingleCellObject", name="HUB" + class_name="HubObject", and [[migrations]] tag "v1" with new_sqlite_classes ["SingleCellObject","HubObject"]`
      : `wrangler.toml grep miss: ${JSON.stringify(toml.hits)}`,
  });

  const bin = findWranglerBin();
  if (!bin) {
    results.push({
      anchorAcId: 'AC-33113-1',
      verdict: 'warn',
      detail: `wrangler devDependency not installed under ${FIXTURE_DIR}/node_modules/.bin/wrangler; run pnpm install --ignore-workspace in the fixture directory to bring the CLI onto the tree. Mechanism-reach gap noted; the in-process probes carry the runtime evidence for the shipped DO classes.`,
    });
    return { results, extra: { wranglerBinPresent: false } };
  }

  const proc = spawn(bin, ['dev', '--local', '--port', '0'], {
    cwd: FIXTURE_DIR,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let boundUrl = null;
  let stderrTail = '';
  let stdoutTail = '';
  proc.stdout.on('data', (buf) => {
    const s = buf.toString();
    stdoutTail = (stdoutTail + s).slice(-2000);
    const match = s.match(/http:\/\/(?:127\.0\.0\.1|localhost):(\d+)/i);
    if (match && !boundUrl) boundUrl = `http://127.0.0.1:${match[1]}`;
  });
  proc.stderr.on('data', (buf) => {
    stderrTail = (stderrTail + buf.toString()).slice(-2000);
  });

  const bindStart = Date.now();
  while (!boundUrl && Date.now() - bindStart < BIND_CAP_MS) {
    if (proc.exitCode !== null) break;
    await new Promise((r) => setTimeout(r, 250));
  }

  if (!boundUrl) {
    await killAndDrain(proc);
    results.push({
      anchorAcId: 'AC-33113-1',
      verdict: 'warn',
      detail: `wrangler dev did not bind within ${BIND_CAP_MS}ms cap; treated as a CLI regression per spec section 3.1 pass-with-skip. stderr tail: ${stderrTail.slice(-500)} stdout tail: ${stdoutTail.slice(-500)}`,
    });
    return { results, extra: { boundUrl: null, wranglerBinPresent: true } };
  }

  // Small settle delay so DO namespaces are wired before requests fire.
  await new Promise((r) => setTimeout(r, 500));

  let seamResult = null;
  let handlerThrew = false;
  try {
    seamResult = await driveConcurrentIncrements(boundUrl);
  } catch (err) {
    handlerThrew = true;
    seamResult = { ok: false, reason: `probe threw at increment: ${err && err.message ? err.message : String(err)}` };
  }

  let wsResult = null;
  try {
    wsResult = await drainOneWebSocketFrame(boundUrl);
  } catch (err) {
    handlerThrew = true;
    wsResult = { ok: false, reason: `probe threw at ws: ${err && err.message ? err.message : String(err)}` };
  }

  await killAndDrain(proc);

  // Serialisation result: fail if the handler surfaced a thrown
  // error at the workerd boundary; else pass/fail based on the
  // observed serialisation shape.
  if (handlerThrew) {
    results.push({
      anchorAcId: 'AC-33113-1',
      verdict: 'fail',
      detail: `handler threw at the workerd boundary during the wrangler-seam drive; increment=${seamResult?.reason ?? 'n/a'}; websocket=${wsResult?.reason ?? 'n/a'}`,
    });
  } else {
    results.push({
      anchorAcId: 'AC-33113-1',
      verdict: seamResult.ok ? 'pass' : 'fail',
      detail: seamResult.ok
        ? `two concurrent POST ${seamResult.target} responded with counters=${JSON.stringify(seamResult.counters)} witnesses=${JSON.stringify(seamResult.witnesses)}; serialisation observed under workerd (each request read the other's write)`
        : `serialisation fault under workerd: ${seamResult.reason ?? `counters=${JSON.stringify(seamResult.counters)} witnesses=${JSON.stringify(seamResult.witnesses)} responses=${JSON.stringify(seamResult.responses ?? null)}`}`,
    });
    results.push({
      anchorAcId: 'AC-33105-1',
      verdict: wsResult.ok ? 'pass' : 'fail',
      detail: wsResult.ok
        ? `WebSocket upgrade against ${wsResult.wsUrl} received one broadcast frame with payload=${wsResult.payload}`
        : `websocket fault: ${wsResult.reason} (url=${wsResult.wsUrl})`,
    });
  }

  return { results, extra: { boundUrl, wranglerBinPresent: true } };
}
