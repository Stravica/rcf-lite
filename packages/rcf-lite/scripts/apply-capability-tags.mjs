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
  'blueprints',
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
  10: ['blueprints'],
  11: ['verify'],
  12: ['blueprints'], 13: ['blueprints'], 14: ['blueprints'], 15: ['blueprints'],
  16: ['requirements-authoring'],
  17: ['verify', 'blueprints'],
  18: ['blueprints', 'applications-shelf'], 19: ['blueprints', 'applications-shelf'],
  20: ['blueprints', 'applications-shelf'], 21: ['blueprints', 'applications-shelf'],
  22: ['blueprints', 'applications-shelf'], 23: ['blueprints', 'applications-shelf'],
  24: ['blueprints', 'applications-shelf'], 25: ['blueprints', 'applications-shelf'],
  26: ['blueprints', 'applications-shelf'], 27: ['blueprints', 'applications-shelf'],
  28: ['blueprints', 'applications-shelf'],
  29: ['blueprints', 'deploy'], 30: ['blueprints', 'deploy'],
  40: ['blueprints', 'applications-shelf'], 41: ['blueprints', 'applications-shelf'],
  42: ['blueprints', 'applications-shelf'], 43: ['blueprints', 'applications-shelf'],
  50: ['blueprints', 'platform-integrations'], 51: ['blueprints', 'platform-integrations'],
  52: ['blueprints', 'platform-integrations'], 53: ['blueprints', 'platform-integrations'],
  54: ['blueprints', 'platform-integrations'],
  60: ['blueprints', 'platform-integrations'], 61: ['blueprints', 'platform-integrations'],
  62: ['blueprints', 'platform-integrations'], 63: ['blueprints', 'platform-integrations'],
  70: ['blueprints', 'platform-integrations'], 71: ['blueprints', 'platform-integrations'],
  72: ['blueprints', 'platform-integrations'], 73: ['blueprints', 'platform-integrations'],
  74: ['blueprints', 'platform-integrations'], 75: ['blueprints', 'platform-integrations'],
  76: ['blueprints', 'platform-integrations'], 77: ['blueprints', 'platform-integrations'],
  80: ['blueprints', 'edge-security'], 81: ['blueprints', 'edge-security'],
  82: ['blueprints', 'edge-security'], 83: ['blueprints', 'edge-security'],
  84: ['blueprints', 'edge-security'], 85: ['blueprints', 'edge-security'],
  86: ['blueprints', 'edge-security'],
  90: ['blueprints', 'edge-security'], 91: ['blueprints', 'edge-security'],
  92: ['blueprints', 'edge-security'], 93: ['blueprints', 'edge-security'],
  94: ['blueprints', 'edge-security'],
  100: ['blueprints', 'edge-security'], 101: ['blueprints', 'edge-security'],
  102: ['blueprints', 'edge-security'], 103: ['blueprints', 'edge-security'],
  104: ['blueprints', 'edge-security'],
  110: ['blueprints', 'deploy'], 111: ['blueprints', 'deploy'],
  112: ['blueprints', 'deploy'], 113: ['blueprints', 'deploy'],
  114: ['blueprints', 'deploy'], 115: ['blueprints', 'deploy'],
  120: ['blueprints', 'deploy'], 121: ['blueprints', 'deploy'],
  122: ['blueprints', 'deploy'], 123: ['blueprints', 'deploy'],
  124: ['blueprints', 'deploy'], 125: ['blueprints', 'deploy'],
  130: ['blueprints', 'edge-security', 'platform-integrations'],
  131: ['blueprints', 'edge-security', 'platform-integrations'],
  132: ['blueprints', 'edge-security', 'platform-integrations'],
  133: ['blueprints', 'edge-security', 'platform-integrations'],
  134: ['blueprints', 'edge-security', 'platform-integrations'],
  140: ['blueprints', 'applications-shelf'],
  145: ['blueprints', 'deploy'],
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
