// MCP tool registry for verify (spec §10 MCP, mirrors build's mcp/ shape). A
// thin adapter over the SAME in-process engine the CLI uses (runVerification),
// never spawning the CLI. Input schemas are JSON Schema 2020-12, camelCase,
// closed objects. Argument validation maps to tool execution errors
// (isError: true) — the self-correction channel — not protocol errors.

import { JsonRpcError, INVALID_PARAMS } from '@stravica-ai/rcf-lite-core/mcp-shell';
import { isRcfError } from '@stravica-ai/rcf-lite-core/errors';

import { runVerification } from '../engine/index.js';
import { gateTripped, FINDING_SEVERITIES } from '../verdict/index.js';

const RUN_INPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    repo: { type: 'string', description: 'RCF chain source (the acceptance contract)' },
    chainRef: { type: 'string', description: 'Which PRD/chain (default: the repo\'s)' },
    profile: { type: 'string', enum: ['deployed', 'ci', 'local-dev'], description: 'Runtime profile (scopes the verdict authority)' },
    url: { type: 'string', description: 'The running app for this profile' },
    parityEnv: { type: 'boolean', description: 'Assert a non-deployed runtime is edge-identical to prod (the only path to SHIP from a non-deployed profile)' },
    provision: { type: 'string', description: 'Provisioning credentials FILE path (never inline)' },
    provisionMode: { type: 'string', enum: ['run', 'skip'] },
    persona: { type: 'string' },
    severityGate: { type: 'string', enum: FINDING_SEVERITIES },
  },
  required: ['repo', 'profile', 'url'],
};

const RUN_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    gateTripped: { type: 'boolean' },
    report: { type: 'object' },
    errors: { type: 'array' },
  },
  required: ['ok'],
};

/**
 * Build the tool registry. `definitions` is the tools/list payload;
 * `call(name, args)` dispatches a tools/call.
 *
 * @param {object} [deps] - injectable engine seams (launchAgent, fetchImpl, signup, ...)
 * @returns {{ definitions: object[], call: (name: string, args: object) => Promise<object> }}
 */
export function createToolRegistry(deps = {}) {
  const definitions = [
    {
      name: 'rcf_verify_run',
      title: 'RCF Verify — run adversarial verification',
      description: 'Launch a fresh-context adversarial verifier against a running app under a declared runtime profile and return a structured verdict stamped with the runtime it ran against. Returns the report inline (no --out file needed over MCP).',
      inputSchema: RUN_INPUT_SCHEMA,
      outputSchema: RUN_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: false, openWorldHint: true },
    },
  ];

  async function call(name, args) {
    if (name !== 'rcf_verify_run') {
      throw new JsonRpcError(INVALID_PARAMS, `Unknown tool: ${name}`);
    }
    const a = args ?? {};
    const errors = [];
    if (typeof a.repo !== 'string') errors.push({ kind: 'usage', field: 'repo', message: 'repo is required' });
    if (!['deployed', 'ci', 'local-dev'].includes(a.profile)) errors.push({ kind: 'usage', field: 'profile', message: 'profile must be deployed|ci|local-dev' });
    if (typeof a.url !== 'string') errors.push({ kind: 'usage', field: 'url', message: 'url is required' });
    if (errors.length > 0) {
      return errorResult(errors);
    }

    const result = await runVerification({
      repo: a.repo,
      chainRef: a.chainRef,
      profile: a.profile,
      url: a.url,
      parityEnv: Boolean(a.parityEnv),
      provision: a.provision,
      provisionMode: a.provisionMode ?? 'run',
      persona: a.persona,
      severityGate: a.severityGate,
    }, deps);

    if (isRcfError(result)) {
      return errorResult([{ kind: result.kind, field: result.field ?? null, message: result.message }]);
    }
    const { report } = result;
    const tripped = gateTripped({ verdict: report.verdict, findings: report.findings, gate: a.severityGate });
    const payload = { ok: true, gateTripped: tripped, report };
    return {
      content: [{ type: 'text', text: `verdict ${report.verdict} [${report.verdictAuthority}]${tripped ? ' — gate tripped' : ''}` }],
      structuredContent: payload,
      isError: false,
    };
  }

  return { definitions, call };
}

function errorResult(errors) {
  return {
    content: [{ type: 'text', text: errors.map((e) => `[${e.kind}] ${e.message}`).join('\n') }],
    structuredContent: { ok: false, errors },
    isError: true,
  };
}
