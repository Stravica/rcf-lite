// Probe: admin-console gate surface - the extended admin-console fixture flips its sign-in surface per applied capability set.
// anchorAcId: AC-34108-1. accountBound: false.
//
// This probe drives the extended probe-pack-application-admin-console fixture over HTTP (no browser).
// The fixture ships a /admin/sign-in route that renders one of two surfaces based on ?caps=:
//   - with zeroTrustGate in the caps list: [data-surface=access-gated] + no [data-surface=local-login] +
//     [data-role=principal-read] with the request.auth email
//   - without zeroTrustGate: [data-surface=local-login] + no [data-surface=access-gated]
// The probe boots the fixture server, hits both combinations, greps the DOM for the surface markers,
// and asserts the mutually exclusive presence. The shipped pack check AC-21815-1 on
// application-admin-console.pack.mjs is exercised end-to-end in the anatomy test (it uses Playwright);
// this probe covers the DOM-shape guarantee without a browser dependency.

import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const anchorAcId = 'AC-34108-1';
export const accountBound = false;

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(HERE, '..', '..', '..', '..', 'packages', 'rcf-lite', 'test', 'fixtures', 'probe-pack-application-admin-console');
const BIND_CAP_MS = 8000;

async function bootServer() {
  const proc = spawn(process.execPath, ['server.js'], {
    cwd: FIXTURE,
    env: { ...process.env, PORT: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let url = null;
  let stderrTail = '';
  proc.stdout.on('data', (buf) => {
    const s = buf.toString();
    const match = s.match(/LISTENING\s+(\d+)/);
    if (match && !url) url = `http://127.0.0.1:${match[1]}`;
  });
  proc.stderr.on('data', (b) => { stderrTail = (stderrTail + b.toString()).slice(-2000); });
  const start = Date.now();
  while (!url && Date.now() - start < BIND_CAP_MS) {
    if (proc.exitCode !== null) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  return { proc, url, stderrTail };
}

async function fetchDom(url, caps) {
  const target = `${url}/admin/sign-in?caps=${encodeURIComponent(caps)}`;
  // Cloudflare Access injects the JWT header upstream of the origin;
  // this probe simulates that when driving the gated capability set
  // so the fixture observes request.auth as populated (AC-21815-1).
  // Without zeroTrustGate no auth is required (AC-21816-1 fallback).
  const headers = /zeroTrustGate/.test(caps)
    ? { authorization: 'Bearer probe-cf-access@example.test' }
    : undefined;
  const res = await fetch(target, { headers });
  return { status: res.status, body: await res.text(), target };
}

async function stop(proc) {
  if (!proc || proc.killed) return;
  try { proc.kill('SIGTERM'); } catch (_e) {}
  await new Promise((r) => setTimeout(r, 300));
  try { if (!proc.killed) proc.kill('SIGKILL'); } catch (_e) {}
}

export default async function runProbe() {
  const { proc, url, stderrTail } = await bootServer();
  if (!url) {
    await stop(proc);
    return { results: [{ anchorAcId: 'AC-34108-1', verdict: 'fail', detail: `admin-console fixture did not bind within ${BIND_CAP_MS}ms; stderr: ${stderrTail}` }] };
  }
  const results = [];
  try {
    // Gated combination
    const gated = await fetchDom(url, 'principalDirectory,roleModel,auditLog,zeroTrustGate');
    const gatedOk =
      gated.status === 200 &&
      gated.body.includes('data-surface="access-gated"') &&
      !gated.body.includes('data-surface="local-login"') &&
      gated.body.includes('data-role="principal-read"');
    results.push({
      anchorAcId: 'AC-34108-1',
      verdict: gatedOk ? 'pass' : 'fail',
      detail: gatedOk
        ? `gated: HTTP 200 with data-surface=access-gated, no data-surface=local-login, data-role=principal-read present at ${gated.target}`
        : `gated combination did not match; status=${gated.status} accessGatedPresent=${gated.body.includes('data-surface="access-gated"')} localLoginPresent=${gated.body.includes('data-surface="local-login"')} principalReadPresent=${gated.body.includes('data-role="principal-read"')}`,
    });

    // Fallback combination
    const fallback = await fetchDom(url, 'principalDirectory,roleModel,auditLog');
    const fallbackOk =
      fallback.status === 200 &&
      fallback.body.includes('data-surface="local-login"') &&
      !fallback.body.includes('data-surface="access-gated"');
    results.push({
      anchorAcId: 'AC-34108-1',
      verdict: fallbackOk ? 'pass' : 'fail',
      detail: fallbackOk
        ? `fallback: HTTP 200 with data-surface=local-login, no data-surface=access-gated at ${fallback.target}`
        : `fallback combination did not match; status=${fallback.status} localLoginPresent=${fallback.body.includes('data-surface="local-login"')} accessGatedPresent=${fallback.body.includes('data-surface="access-gated"')}`,
    });
  } finally {
    await stop(proc);
  }
  return { results };
}
