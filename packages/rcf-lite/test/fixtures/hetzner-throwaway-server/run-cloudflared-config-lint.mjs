// Fixture-side delegate for the edge-cloudflare-tunnel cloudflared-config-lint probe (round-7 T-3).
//
// Mutation switches (fixture-side ONLY):
// - SIMULATE_INGRESS_INVALID: rewrite the compose-service/public-hostname
//   manifest ingress service URL to an unresolvable scheme so
//   cloudflared tunnel ingress validate exits non-zero.

import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const CANONICAL = resolve(HERE, 'cloudflared');
const BLUEPRINT_SHIM = resolve(HERE, '..', '..', '..', '..', '..', 'blueprints/edge-cloudflare-tunnel/contributions/probes/run-cloudflared-config-lint.mjs');

const mutations = {
  ingressInvalid: process.env.SIMULATE_INGRESS_INVALID === 'true',
};
const anyMutation = Object.values(mutations).some(Boolean);

async function applyMutations(scratch) {
  if (mutations.ingressInvalid) {
    const target = resolve(scratch, 'compose-service/cloudflare/tunnels/public-hostname.yaml');
    let text = await readFile(target, 'utf8');
    text = text.replace(/service: http:\/\/web:8080/, 'service: bogus-scheme-here');
    await writeFile(target, text, 'utf8');
  }
}

async function main() {
  if (anyMutation) {
    const scratch = await mkdtemp(resolve(tmpdir(), 'rcf-lite-t3-ccl-'));
    await cp(CANONICAL, scratch, { recursive: true });
    await applyMutations(scratch);
    process.env.RCF_LITE_T3_FIXTURE_ROOT = scratch;
    process.stderr.write(`[fixture] mutations active: ${Object.entries(mutations).filter(([, v]) => v).map(([k]) => k).join(', ')}\n`);
    process.stderr.write(`[fixture] scratch RCF_LITE_T3_FIXTURE_ROOT=${scratch}\n`);
  }
  await import(pathToFileURL(BLUEPRINT_SHIM).href);
}
await main();
