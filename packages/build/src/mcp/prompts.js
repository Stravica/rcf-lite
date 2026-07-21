// MCP prompts (Phase 7 §D16-A). Serves the Phase 7.5 agent-guidance
// playbooks as static, argument-free prompts via prompts/list and
// prompts/get. Same plumbing posture as the D15-A resources: the pack
// owns content (guidance/manifest.json is the contract file, OQ-P7.5-1);
// this file reads the mapped markdown and serves bytes, byte-faithful.
// Semantic-adequacy assessment prompts stay Phase 7.x (spec §7).

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { JsonRpcError, INVALID_PARAMS } from './server.js';
import { GUIDANCE_DIR, readGuidanceManifest } from './resources.js';

/**
 * Create the prompt registry.
 *
 * @param {object} [opts]
 * @param {string} [opts.guidanceDir]
 * @returns {{list: () => Promise<object>, get: (params: object) => Promise<object>}}
 */
export function createPromptRegistry({ guidanceDir = GUIDANCE_DIR } = {}) {
  async function list() {
    const manifest = await readGuidanceManifest(guidanceDir);
    return {
      prompts: manifest.prompts.map((p) => ({
        name: p.name,
        description: p.description,
      })),
    };
  }

  async function get(params) {
    const name = params?.name;
    const manifest = await readGuidanceManifest(guidanceDir);
    const entry = manifest.prompts.find((p) => p.name === name);
    if (!entry) {
      throw new JsonRpcError(INVALID_PARAMS, `Unknown prompt: ${name}`);
    }
    const text = await readFile(join(guidanceDir, entry.file), 'utf8');
    return {
      description: entry.description,
      messages: [
        { role: 'user', content: { type: 'text', text } },
      ],
    };
  }

  return { list, get };
}
