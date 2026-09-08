// Shared helpers for edge-cloudflare-tunnel probes (round-7 T-3).
//
// Runtime-dependency posture:
// - manifest-schema-validate is dependency-free: it reads yaml text and
//   walks the parsed document. The tunnel manifest schema ships at
//   ./tunnel-manifest.schema.json.
// - cloudflared-config-lint shells to cloudflared tunnel ingress validate.
//   When a local cloudflared binary is on PATH the probe uses it; when it
//   is not, the probe runs the vendor container image
//   cloudflare/cloudflared:2026.8.3 via docker run --rm -v <dir>:/etc/cloudflared:ro
//   per the vendor downloads page. When neither is available the probe
//   records warn (source-tree assertions still run).
// - aud-presence-check reads a sidecar JSON and the paired tunnel yaml;
//   dependency-free.
// - real-account-* probes shell to cloudflared tunnel info / undici curl
//   against a scratch subdomain on a real Cloudflare account; without
//   CI_HAS_CLOUDFLARE_ACCOUNT AND CI_HAS_HETZNER_ACCOUNT they record
//   accountBoundSkipped: true and the aggregate flips to pass per
//   hetzner-round-7-spec section 3.5.
//
// FIXTURE_ROOT posture:
// - The fixture-side delegate shims under
//   packages/rcf-lite/test/fixtures/hetzner-throwaway-server/run-<probe>.mjs
//   set RCF_LITE_T3_FIXTURE_ROOT to a scratch directory when a mutation
//   switch is on. The probe modules NEVER read a fixture-side mutation env var and
//   NEVER branch on being under mutation; their verdict is a pure
//   function of the files at FIXTURE_ROOT.

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = resolve(HERE, '..', '..', '..', '..');

// Fixture root defaults to the shared throwaway-server fixture cloudflared/
// sub-directory. A fixture-side delegate that needs to inject a mutation
// copies the sub-tree to a scratch dir and points FIXTURE_ROOT at it.
export const CANONICAL_FIXTURE_ROOT = resolve(
  PROJECT_ROOT,
  'packages/rcf-lite/test/fixtures/hetzner-throwaway-server/cloudflared',
);
export function fixtureRoot() {
  return process.env.RCF_LITE_T3_FIXTURE_ROOT
    ? resolve(process.env.RCF_LITE_T3_FIXTURE_ROOT)
    : CANONICAL_FIXTURE_ROOT;
}
export const REPORT_DIR = resolve(
  PROJECT_ROOT,
  '.rcf/reports/blueprints/edge-cloudflare-tunnel',
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
    slug: 'edge-cloudflare-tunnel',
    probeName,
    runAt: new Date().toISOString(),
    engine,
    results,
    aggregateVerdict,
    ...(extra ?? {}),
  };
  // Strip absolute builder scratchpad paths from persisted reports so
  // the committed envelopes stay repo-relative and diff cleanly. Walks
  // every string in the report and rewrites PROJECT_ROOT-prefixed paths
  // to their repo-relative form (covers report.fixtureRoot, results[].detail,
  // extra.* and any nested string value future probes surface).
  const prefix = PROJECT_ROOT + '/';
  function stripPaths(node) {
    if (typeof node === 'string') {
      if (node === PROJECT_ROOT) return '.';
      return node.split(prefix).join('');
    }
    if (Array.isArray(node)) return node.map(stripPaths);
    if (node && typeof node === 'object') {
      const out = {};
      for (const [k, v] of Object.entries(node)) out[k] = stripPaths(v);
      return out;
    }
    return node;
  }
  Object.assign(report, stripPaths(report));
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

export function accountBoundSkippedResult(anchorAcId, envList, note) {
  return {
    anchorAcId,
    verdict: 'skipped',
    accountBoundSkipped: true,
    detail: `accountBound: ${envList.join(' or ')} unset; ${note}`,
  };
}

// Minimal yaml subset parser tuned for the tunnel manifest shape.
// The fixture manifests are intentionally simple: no anchors, no flow-style
// scalars, two-space indent. The parser produces a shape sufficient for
// the ACs (tunnel id string, credentialsFile.secretRef, ingress array of
// {hostname?, service, originRequest?.access.aud?}).
export function parseTunnelYaml(text) {
  const doc = {};
  const lines = text.split(/\r?\n/);
  const stack = [{ indent: -1, node: doc }];
  const kvRe = /^([A-Za-z0-9_.-]+):\s*(.*)$/;
  function decode(raw) {
    if (raw === '' || raw === undefined) return null;
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    if (raw === 'null' || raw === '~') return null;
    return raw.replace(/^"([^"\\]*)"$/, '$1').replace(/^'([^'\\]*)'$/, '$1');
  }
  for (let idx = 0; idx < lines.length; idx += 1) {
    const raw = lines[idx];
    if (raw.trim() === '' || raw.trim().startsWith('#')) continue;
    const indentM = raw.match(/^(\s*)/);
    const indent = indentM ? indentM[1].length : 0;
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
    const parent = stack[stack.length - 1].node;
    const body = raw.slice(indent);
    if (body.startsWith('- ')) {
      const rest = body.slice(2);
      const kv = rest.match(kvRe);
      if (kv) {
        const [, key, val] = kv;
        const obj = {};
        if (val === '') {
          const child = {};
          obj[key] = child;
          parent.push(obj);
          stack.push({ indent, node: obj });
          stack.push({ indent: indent + 2, node: child });
        } else {
          obj[key] = decode(val.trim());
          parent.push(obj);
          stack.push({ indent, node: obj });
        }
      } else {
        parent.push(decode(rest.trim()));
      }
      continue;
    }
    const kv = body.match(kvRe);
    if (!kv) continue;
    const [, key, val] = kv;
    if (val === '') {
      let peekIsList = false;
      for (let j = idx + 1; j < lines.length; j += 1) {
        const nxt = lines[j];
        if (!nxt || nxt.trim() === '' || nxt.trim().startsWith('#')) continue;
        const nxtIndentM = nxt.match(/^(\s*)/);
        const nxtIndent = nxtIndentM ? nxtIndentM[1].length : 0;
        if (nxtIndent <= indent) break;
        peekIsList = nxt.slice(nxtIndent).startsWith('- ');
        break;
      }
      const child = peekIsList ? [] : {};
      parent[key] = child;
      stack.push({ indent, node: child });
    } else {
      parent[key] = decode(val.trim());
    }
  }
  return doc;
}

export function whichDocker() {
  const r = spawnSync('docker', ['version', '--format', '{{.Client.Version}}'], { encoding: 'utf8' });
  return r.status === 0 ? (r.stdout || '').trim() : null;
}

export function whichCloudflared() {
  const r = spawnSync('cloudflared', ['--version'], { encoding: 'utf8' });
  return r.status === 0 ? (r.stdout || '').trim() : null;
}

export const CLOUDFLARED_IMAGE = 'cloudflare/cloudflared:2026.8.3';

// Two dimensions: connector runtime (compose-service or systemd-unit) and
// hostname mode (public-hostname or access-gated). Every combination
// ships one manifest under cloudflared/<runtime>/cloudflare/tunnels/<mode>.yaml.
export const RUNTIMES = ['compose-service', 'systemd-unit'];
export const HOSTNAME_MODES = ['public-hostname', 'access-gated'];
export function pairs() {
  const list = [];
  for (const runtime of RUNTIMES) {
    for (const mode of HOSTNAME_MODES) list.push({ runtime, mode });
  }
  return list;
}

// Backwards compat name used by the manifest-schema-validate probe: iterate over
// runtime variants for schema-shape checks (both modes are shape-checked).
export const VARIANTS = RUNTIMES;
