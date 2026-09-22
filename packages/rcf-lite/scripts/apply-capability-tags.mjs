#!/usr/bin/env node
// Apply capability:<slug> tags to every requirement under
// packages/rcf-lite/rcf/requirements/. One authoritative mapping; every
// slug listed here must appear in the taxonomy table of
// packages/rcf-lite/docs/capability-tags.md. Existing non-capability
// tags are preserved; existing capability tags are overwritten (single
// authoritative source for the capability axis).
//
// Idempotent: running twice writes no files the second time. Ships as
// the CN for AC-17101-1 (the "every dogfood REQ carries at least one
// capability:<slug> tag mapped to a documented slug" AC on US-17101).
// A `rcf discover req-capability-classify` verb that reads a hint file
// and updates tags[] is a follow-up (see docs/capability-tags.md);
// until then this script is the tool of record.
//
// Chain: REQ-171 (capability tag convention), US-17101 (dogfood REQs
// carry capability tags), FBS-191 (apply tags + docs), TS-209.

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, '..');
const reqDir = join(packageRoot, 'rcf', 'requirements');
const now = new Date().toISOString();

// Twelve slugs. Must match docs/capability-tags.md exactly.
export const CAPABILITIES = new Set([
  'project-init',
  'requirements-authoring',
  'build-sequence',
  'review-surface',
  'mcp',
  'blueprint-library',
  'applications-shelf',
  'platform-integrations',
  'edge-security',
  'deploy',
  'verify',
  'feedback-loop',
]);

// (reqIdInt) -> capability slugs. Coverage over every REQ under
// packages/rcf-lite/rcf/requirements/.
export const MAPPING = {
  1: ['project-init'],
  2: ['review-surface'],
  3: ['requirements-authoring'],
  4: ['requirements-authoring'],
  5: ['build-sequence'],
  6: ['mcp'],
  7: ['requirements-authoring'],
  8: ['build-sequence'],
  9: ['project-init'],
  10: ['blueprint-library'],
  11: ['verify'],
  12: ['blueprint-library'], 13: ['blueprint-library'], 14: ['blueprint-library'], 15: ['blueprint-library'],
  16: ['requirements-authoring'],
  17: ['verify', 'blueprint-library'],
  18: ['applications-shelf'], 19: ['applications-shelf'],
  20: ['applications-shelf'], 21: ['applications-shelf'],
  22: ['applications-shelf'], 23: ['applications-shelf'],
  24: ['applications-shelf'], 25: ['applications-shelf'],
  26: ['applications-shelf'], 27: ['applications-shelf'],
  28: ['applications-shelf'],
  29: ['deploy'], 30: ['deploy'],
  40: ['applications-shelf'], 41: ['applications-shelf'],
  42: ['applications-shelf'], 43: ['applications-shelf'],
  50: ['platform-integrations'], 51: ['platform-integrations'],
  52: ['platform-integrations'], 53: ['platform-integrations'],
  54: ['platform-integrations'],
  60: ['platform-integrations'], 61: ['platform-integrations'],
  62: ['platform-integrations'], 63: ['platform-integrations'],
  70: ['platform-integrations'], 71: ['platform-integrations'],
  72: ['platform-integrations'], 73: ['platform-integrations'],
  74: ['platform-integrations'], 75: ['platform-integrations'],
  76: ['platform-integrations'], 77: ['platform-integrations'],
  80: ['edge-security'], 81: ['edge-security'],
  82: ['edge-security'], 83: ['edge-security'],
  84: ['edge-security'], 85: ['edge-security'],
  86: ['edge-security'],
  90: ['edge-security'], 91: ['edge-security'],
  92: ['edge-security'], 93: ['edge-security'],
  94: ['edge-security'],
  100: ['edge-security'], 101: ['edge-security'],
  102: ['edge-security'], 103: ['edge-security'],
  104: ['edge-security'],
  110: ['deploy'], 111: ['deploy'],
  112: ['deploy'], 113: ['deploy'],
  114: ['deploy'], 115: ['deploy'],
  120: ['deploy'], 121: ['deploy'],
  122: ['deploy'], 123: ['deploy'],
  124: ['deploy'], 125: ['deploy'],
  130: ['edge-security', 'platform-integrations'],
  131: ['edge-security', 'platform-integrations'],
  132: ['edge-security', 'platform-integrations'],
  133: ['edge-security', 'platform-integrations'],
  134: ['edge-security', 'platform-integrations'],
  140: ['applications-shelf'],
  145: ['deploy'],
  150: ['verify', 'platform-integrations'], 151: ['verify', 'platform-integrations'],
  152: ['verify', 'platform-integrations'], 153: ['verify', 'platform-integrations'],
  154: ['verify'],
  155: ['feedback-loop'], 156: ['feedback-loop'], 157: ['feedback-loop'],
  158: ['feedback-loop'], 159: ['feedback-loop'], 160: ['feedback-loop'],
  161: ['feedback-loop'], 162: ['feedback-loop'],
  163: ['verify'], 164: ['verify'], 165: ['verify'],
  170: ['review-surface'],
  171: ['requirements-authoring', 'review-surface'],
};

export function apply({ writeChanged = true } = {}) {
  // Guard: every slug used must be in the taxonomy.
  for (const slugs of Object.values(MAPPING)) {
    for (const s of slugs) {
      if (!CAPABILITIES.has(s)) throw new Error(`unknown slug: ${s}`);
    }
  }
  const files = readdirSync(reqDir).filter((f) => f.endsWith('.json')).sort();
  const results = { checked: 0, updated: 0, missingMappings: [] };
  for (const f of files) {
    const p = join(reqDir, f);
    const j = JSON.parse(readFileSync(p, 'utf8'));
    const idInt = parseInt(String(j.reqId).replace('REQ-', ''), 10);
    const slugs = MAPPING[idInt];
    if (!slugs) { results.missingMappings.push(j.reqId); continue; }
    const existingTags = Array.isArray(j.tags) ? j.tags : [];
    const nonCap = existingTags.filter((t) => !(typeof t === 'string' && t.startsWith('capability:')));
    const capTags = slugs.map((s) => `capability:${s}`);
    const nextTags = [...capTags, ...nonCap];
    results.checked += 1;
    if (JSON.stringify(existingTags) !== JSON.stringify(nextTags)) {
      if (writeChanged) {
        j.tags = nextTags;
        j.updatedAt = now;
        writeFileSync(p, JSON.stringify(j, null, 2) + '\n');
      }
      results.updated += 1;
    }
  }
  return results;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = apply();
  console.log(JSON.stringify(result, null, 2));
  if (result.missingMappings.length > 0) process.exit(1);
}
