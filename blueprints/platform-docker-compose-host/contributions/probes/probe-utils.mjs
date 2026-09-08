// Shared helpers for platform-docker-compose-host probes.
//
// Runtime-dependency posture:
// - compose-config-lint shells to docker compose config against the applied
//   fixture compose.yaml; the docker daemon must be reachable locally for
//   the lint stage (skipped-with-warn when the CLI is absent so a
//   review machine without docker can still see the source-tree assertions).
// - secrets-as-files-scan runs in-process against the fixture; no external
//   engine required.
// - caddyfile-validate shells to caddy validate. When a local caddy binary
//   is not on PATH the probe runs the vendor container caddy:2 via docker
//   run --rm; when docker is also absent it skips-with-warn.
// - real-account-* probes call the fixture's provision.mjs, drive docker
//   compose over ssh against the throwaway server, and tear down in
//   always(). Without CI_HAS_HETZNER_ACCOUNT they record accountBoundSkipped:
//   true and the aggregate flips to pass per hetzner-round-7-spec section 3.5.

import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = resolve(HERE, '..', '..', '..', '..');
export const FIXTURE_DIR = resolve(
  PROJECT_ROOT,
  'packages/rcf-lite/test/fixtures/hetzner-throwaway-server',
);
export const COMPOSE_PATH = resolve(FIXTURE_DIR, 'compose.yaml');
export const CADDYFILE_PATH = resolve(FIXTURE_DIR, 'caddy/Caddyfile');
export const SECRET_PATH = resolve(FIXTURE_DIR, 'secrets/web-token');
export const ENV_PATH = resolve(FIXTURE_DIR, '.env');
export const REPORT_DIR = resolve(
  PROJECT_ROOT,
  '.rcf/reports/blueprints/platform-docker-compose-host',
);

export function aggregate(results) {
  if (results.some((r) => r.verdict === 'fail')) return 'fail';
  if (results.some((r) => r.verdict === 'warn')) return 'warn';
  return 'pass';
}

export function isSkipped(results) {
  return results.length > 0 && results.every((r) => r.accountBoundSkipped === true);
}

export async function writeReport({ probeName, engine, results, extra }) {
  await mkdir(REPORT_DIR, { recursive: true });
  const rawVerdict = aggregate(results);
  const aggregateVerdict = isSkipped(results) ? 'pass' : rawVerdict;
  const report = {
    slug: 'platform-docker-compose-host',
    probeName,
    runAt: new Date().toISOString(),
    engine,
    results,
    aggregateVerdict,
    ...(extra ?? {}),
  };
  const path = resolve(REPORT_DIR, `${probeName}.json`);
  await writeFile(path, JSON.stringify(report, null, 2) + '\n', 'utf8');
  return { report, path };
}

export async function runShim(probeName, engine, mainFn) {
  try {
    const outcome = (await mainFn()) ?? { results: [] };
    const { results, extra } = outcome;
    const { report, path } = await writeReport({ probeName, engine, results, extra });
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    process.stdout.write(`report written to ${path}\n`);
    if (report.aggregateVerdict === 'fail') process.exitCode = 1;
  } catch (err) {
    const results = [{
      anchorAcId: 'unknown',
      verdict: 'fail',
      detail: `probe threw: ${err && err.message ? err.message : String(err)}`,
    }];
    const { report, path } = await writeReport({ probeName, engine, results });
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    process.stderr.write(`probe error: ${err && err.stack ? err.stack : String(err)}\n`);
    process.stderr.write(`report written to ${path}\n`);
    process.exitCode = 1;
  }
}

export function accountBoundSkippedResult(anchorAcId, note) {
  return {
    anchorAcId,
    verdict: 'skipped',
    accountBoundSkipped: true,
    detail: `accountBound: CI_HAS_HETZNER_ACCOUNT unset; ${note}`,
  };
}

// Small YAML subset parser tuned for the fixture compose.yaml shape.
// The fixture keeps compose.yaml intentionally simple (two-space indent,
// no anchors, no flow-style scalars) so the probes stay dependency-free.
// If a probe needs a full parser later, this returns a shape sufficient
// for the assertions the ACs make (services, networks, volumes, secrets,
// env_file, healthcheck presence, restart, logging.driver).
export function parseComposeYaml(text) {
  const doc = {};
  const lines = text.split(/\r?\n/);
  const stack = [{ indent: -1, node: doc }];
  const inlineListRe = /^\[(.*)\]$/;
  function decodeScalar(raw) {
    if (raw === '' || raw === undefined) return null;
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    if (raw === 'null' || raw === '~') return null;
    const m = raw.match(inlineListRe);
    if (m) return m[1].split(',').map((s) => decodeScalar(s.trim()));
    return raw.replace(/^"([^"\\]*)"$/, '$1').replace(/^'([^'\\]*)'$/, '$1');
  }
  for (let raw of lines) {
    if (raw.trim() === '' || raw.trim().startsWith('#')) continue;
    const indentMatch = raw.match(/^(\s*)/);
    const indent = indentMatch ? indentMatch[1].length : 0;
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
    const parent = stack[stack.length - 1].node;
    const body = raw.slice(indent);
    if (body.startsWith('- ')) {
      const rest = body.slice(2);
      const kv = rest.match(/^([A-Za-z0-9_.-]+):\s*(.*)$/);
      if (kv) {
        const [, key, val] = kv;
        const obj = {};
        if (val === '') {
          const child = {};
          obj[key] = child;
          parent.push(obj);
          stack.push({ indent, node: child });
        } else {
          obj[key] = decodeScalar(val.trim());
          parent.push(obj);
        }
      } else {
        parent.push(decodeScalar(rest.trim()));
      }
      continue;
    }
    const kv = body.match(/^([A-Za-z0-9_.-]+):\s*(.*)$/);
    if (!kv) continue;
    const [, key, val] = kv;
    if (val === '') {
      // Peek: next non-empty non-comment line starting with '- ' means list.
      let peekIsList = false;
      for (let j = lines.indexOf(raw) + 1; j < lines.length; j++) {
        const nxt = lines[j];
        if (!nxt || nxt.trim() === '' || nxt.trim().startsWith('#')) continue;
        const nxtIndentMatch = nxt.match(/^(\s*)/);
        const nxtIndent = nxtIndentMatch ? nxtIndentMatch[1].length : 0;
        if (nxtIndent <= indent) break;
        peekIsList = nxt.slice(nxtIndent).startsWith('- ');
        break;
      }
      const child = peekIsList ? [] : {};
      parent[key] = child;
      stack.push({ indent, node: child });
    } else if (val.trim().match(inlineListRe)) {
      parent[key] = decodeScalar(val.trim());
    } else {
      parent[key] = decodeScalar(val.trim());
    }
  }
  return doc;
}

export async function readCompose() {
  const text = await readFile(COMPOSE_PATH, 'utf8');
  const doc = parseComposeYaml(text);
  return { text, doc };
}

export function whichDocker() {
  const r = spawnSync('docker', ['version', '--format', '{{.Client.Version}}'], { encoding: 'utf8' });
  return r.status === 0 ? (r.stdout || '').trim() : null;
}

export function whichCaddy() {
  const r = spawnSync('caddy', ['version'], { encoding: 'utf8' });
  return r.status === 0 ? (r.stdout || '').trim() : null;
}
