// Probe: cloud-init render lint (v1.1.8).
//
// This is an offline validator: it renders the shipped cloud-init
// template locally against the fixture manifest and asserts every
// baseline block is present. There is no engine-minted identifier
// on such a row - the sha256 of the rendered text is computed by
// this probe with Node's `createHash` and therefore does not
// satisfy the semantic anatomy identifier rule. Every result row
// is a `conformanceOnly` de-claim naming the shipped AC clause the
// offline check does not observe; the live observation for
// AC-37104-1 lives on `real-account-cloud-init-hardened` (six
// on-server baseline checks after `cloud-init status --wait`).
// The rendered-text hash and the observed block set stay on the
// row as derived context.
//
// accountBound: false. Purity: no process.env.SIMULATE_ switch is
// read; fixture-side mutations live in the fixture-side renderer.

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { FIXTURE_DIR } from './probe-utils.mjs';

function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export const anchorAcId = null;
export const accountBound = false;

const LIMITATION = 'AC-37104-1: rendered cloud-init template is validated offline for baseline-block presence; the live on-server observation (six baseline checks after cloud-init settles) is carried by real-account-cloud-init-hardened.';

export default async function runProbe() {
  const rendererPath = resolve(FIXTURE_DIR, 'src/cloud-init-renderer.mjs');
  const manifestPath = resolve(FIXTURE_DIR, 'hetzner/servers/ci-throwaway.json');
  const { renderCloudInit, BASELINE_BLOCKS } = await import(rendererPath);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const rendered = await renderCloudInit(manifest, {
    publicKeys: ['ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFakePubKeyForRenderLintHardeningH1 rcf-lite-ci-mock'],
  });
  const renderedSha256 = sha256(rendered);
  const missing = [];
  const present = [];
  for (const block of BASELINE_BLOCKS) {
    const ok = block.markers.every((m) => rendered.includes(m));
    if (ok) {
      present.push(block.id);
    } else {
      const missingMarkers = block.markers.filter((m) => !rendered.includes(m));
      missing.push({ id: block.id, label: block.label, missingMarkers });
    }
  }
  const results = [];
  if (missing.length > 0) {
    for (const m of missing) {
      results.push({
        anchorAcId: null,
        conformanceOnly: true,
        limitation: LIMITATION,
        verdict: 'fail',
        detail: `offline cloud-init render lint: hardening baseline block "${m.label}" is missing from the rendered YAML (missing markers: ${m.missingMarkers.join(', ')}).`,
        evidence: {
          renderedSha256,
          manifestName: manifest.name,
          missingBlockId: m.id,
          missingMarkers: m.missingMarkers,
          renderedByteLength: rendered.length,
        },
      });
    }
  } else {
    results.push({
      anchorAcId: null,
      conformanceOnly: true,
      limitation: LIMITATION,
      verdict: 'pass',
      detail: `offline cloud-init render lint: all ${BASELINE_BLOCKS.length} baseline blocks present in the rendered YAML: ${present.join(', ')}.`,
      evidence: {
        renderedSha256,
        manifestName: manifest.name,
        renderedByteLength: rendered.length,
        presentBlocks: present,
        renderHashSample: rendered.slice(0, 120),
      },
    });
  }
  return {
    results,
    extra: {
      manifestName: manifest.name,
      renderedByteLength: rendered.length,
      presentBlocks: present,
      missingBlocks: missing.map((m) => m.id),
    },
  };
}
