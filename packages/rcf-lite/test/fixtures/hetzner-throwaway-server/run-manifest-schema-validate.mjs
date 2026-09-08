// Fixture-side delegate for the edge-cloudflare-tunnel manifest-schema-validate probe (round-7 T-3).
// Runs from the fixture directory as written:
//   cd packages/rcf-lite/test/fixtures/hetzner-throwaway-server && node ./run-manifest-schema-validate.mjs
//
// Mutation switches (fixture-side ONLY; the probe module never reads SIMULATE_):
// - SIMULATE_MANIFEST_INVALID_TUNNEL_ID: rewrite the tunnel-id field on
//   the compose-service/public-hostname manifest to a non-uuid literal.
// - SIMULATE_MANIFEST_CREDENTIALS_INLINE: rewrite the compose-service/
//   public-hostname manifest credentialsFile to an inline body (bypassing
//   secretRef).
// - SIMULATE_MANIFEST_MISSING_CATCHALL: strip the catch-all rule from
//   the compose-service/public-hostname manifest.
// - SIMULATE_ORIGIN_PORT_OPEN: rewrite the compose-service/public-hostname
//   manifest ingress service URL to a host-public interface.
// - SIMULATE_EVENT_SECRECY_LEAK: mutate the compose-service credentials
//   placeholder to seed a _leakedEvent object carrying the TunnelSecret.
//
// The delegate copies the fixture cloudflared/ sub-tree to a scratch dir
// under /tmp, applies any mutations, points RCF_LITE_T3_FIXTURE_ROOT at
// the scratch dir, and delegates to the blueprint shim.

import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const CANONICAL = resolve(HERE, 'cloudflared');
const BLUEPRINT_SHIM = resolve(HERE, '..', '..', '..', '..', '..', 'blueprints/edge-cloudflare-tunnel/contributions/probes/run-manifest-schema-validate.mjs');

const mutations = {
  invalidTunnelId: process.env.SIMULATE_MANIFEST_INVALID_TUNNEL_ID === 'true',
  credentialsInline: process.env.SIMULATE_MANIFEST_CREDENTIALS_INLINE === 'true',
  missingCatchall: process.env.SIMULATE_MANIFEST_MISSING_CATCHALL === 'true',
  originPortOpen: process.env.SIMULATE_ORIGIN_PORT_OPEN === 'true',
  eventSecrecyLeak: process.env.SIMULATE_EVENT_SECRECY_LEAK === 'true',
};
const anyMutation = Object.values(mutations).some(Boolean);

async function applyMutations(scratch) {
  const target = resolve(scratch, 'compose-service/cloudflare/tunnels/public-hostname.yaml');
  let text = await readFile(target, 'utf8');
  if (mutations.invalidTunnelId) {
    text = text.replace(/^tunnel: .*/m, 'tunnel: NOT-A-UUID-LITERAL');
  }
  if (mutations.credentialsInline) {
    text = text.replace(
      /^credentialsFile:\n  secretRef: .*/m,
      'credentialsFile:\n  AccountTag: 00000000000000000000000000000000\n  TunnelSecret: AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=\n  TunnelID: 00000000-0000-4000-8000-000000000c01',
    );
  }
  if (mutations.missingCatchall) {
    text = text.replace(/^\s*- service: http_status:404\n?/m, '');
  }
  if (mutations.originPortOpen) {
    text = text.replace(/service: http:\/\/web:8080/, 'service: http://0.0.0.0:80');
  }
  await writeFile(target, text, 'utf8');
  if (mutations.eventSecrecyLeak) {
    const credPath = resolve(scratch, 'compose-service/credentials/probe.json.example');
    const cred = JSON.parse(await readFile(credPath, 'utf8'));
    cred._leakedEvent = { boundTunnelSecret: cred.TunnelSecret };
    await writeFile(credPath, JSON.stringify(cred, null, 2) + '\n', 'utf8');
  }
}

async function main() {
  if (anyMutation) {
    const scratch = await mkdtemp(resolve(tmpdir(), 'rcf-lite-t3-msv-'));
    await cp(CANONICAL, scratch, { recursive: true });
    await applyMutations(scratch);
    process.env.RCF_LITE_T3_FIXTURE_ROOT = scratch;
    process.stderr.write(`[fixture] mutations active: ${Object.entries(mutations).filter(([, v]) => v).map(([k]) => k).join(', ')}\n`);
    process.stderr.write(`[fixture] scratch RCF_LITE_T3_FIXTURE_ROOT=${scratch}\n`);
  }
  await import(pathToFileURL(BLUEPRINT_SHIM).href);
}
await main();
