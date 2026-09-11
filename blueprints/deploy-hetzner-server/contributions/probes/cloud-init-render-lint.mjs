// Probe: cloud-init render lint (v1.1.5).
//
// anchorAcId: AC-37104-1. accountBound: false.
//
// Every result row carries an `evidence` object (the shape rule).
// Purity: the probe body reads no process.env.SIMULATE_ switch;
// fixture-side mutations live in src/cloud-init-renderer.mjs.

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { FIXTURE_DIR } from './probe-utils.mjs';

export const anchorAcId = 'AC-37104-1';
export const accountBound = false;

function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export default async function runProbe() {
  const rendererPath = resolve(FIXTURE_DIR, 'src/cloud-init-renderer.mjs');
  const manifestPath = resolve(FIXTURE_DIR, 'hetzner/servers/ci-throwaway.json');
  const { renderCloudInit, BASELINE_BLOCKS } = await import(rendererPath);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const rendered = await renderCloudInit(manifest, {
    publicKeys: ['ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFakePubKeyForRenderLintHardeningH1 rcf-lite-ci-mock'],
  });
  const contentSha256 = sha256(rendered);
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
        anchorAcId,
        verdict: 'fail',
        detail: `cloud-init hardening baseline block "${m.label}" is missing from the rendered YAML (missing markers: ${m.missingMarkers.join(', ')}).`,
        evidence: {
          contentSha256,
          manifestName: manifest.name,
          missingBlockId: m.id,
          missingMarkers: m.missingMarkers,
          renderedByteLength: rendered.length,
        },
      });
    }
  } else {
    results.push({
      anchorAcId,
      verdict: 'pass',
      detail: `all ${BASELINE_BLOCKS.length} baseline blocks present in the rendered YAML: ${present.join(', ')}.`,
      evidence: {
        contentSha256,
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
