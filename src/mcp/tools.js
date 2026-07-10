// The MCP tool registry (Phase 7 §D5-D9, §D17). Eleven tools:
// definitions (name, title, description, inputSchema, outputSchema,
// annotations) plus handlers binding straight to the pure layers -
// src/query/*, src/store/* and src/build/* - in-process, never
// spawning the CLI (D12). Every handler re-walks the tree fresh (D14).
//
// Envelope discipline (D8/D9): the query and validate tools return the
// shipped Phase 5 envelopes verbatim as structuredContent (the same
// objects `--format json` serialises); rcf_build returns the as-built
// Phase 6 D14 json envelope verbatim; the read / write envelopes are
// defined by the Phase 7 spec and stable-by-convention from here on.
//
// Input schemas are JSON Schema 2020-12, camelCase, closed objects
// (D7). Argument validation happens here, before dispatch, and maps to
// tool execution errors (isError: true) per D10 - the self-correction
// channel, not a protocol error.

import { JsonRpcError, INVALID_PARAMS } from './server.js';
import {
  errorResult,
  issuesFromErrors,
  unexpectedFailureResult,
  usageErrorResult,
  walkerBlockedResult,
  writerErrorResult,
} from './map-errors.js';
import { isRcfError } from '../errors/index.js';
import {
  checkCodeNodeResolution,
  createDocument,
  deleteDocument,
  deriveSlug,
  updateDocument,
  walkTree,
} from '../store/index.js';
import {
  classifyCoverageScope,
  computeCoverage,
  computeImpact,
  computeTrace,
  kindOf,
} from '../query/index.js';
import { assembleBundle } from '../build/index.js';
import { hasAgentMarker, SETUP_FUNNEL_INSTRUCTION } from '../setup/agent-setup.js';

// ---------------------------------------------------------------------------
// Shared output-schema fragments
// ---------------------------------------------------------------------------

const ISSUE_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: ['string', 'null'] },
    kind: { type: 'string' },
    rule: { type: ['string', 'null'] },
    filePath: { type: ['string', 'null'] },
    field: { type: ['string', 'null'] },
    message: { type: 'string' },
  },
  required: ['id', 'kind', 'rule', 'filePath', 'field', 'message'],
};

// D11: every isError result carries {ok: false, errors[]} as its
// structuredContent. The 2025-11-25 tools spec says structured results
// MUST conform to a declared outputSchema (and the official SDK client
// enforces it on error results too), so every tool's outputSchema is
// the union of its success envelope and this error payload - the
// success branch stays the verbatim envelope transcription (D8/D9).
const ERROR_PAYLOAD_SCHEMA = {
  type: 'object',
  description: 'Tool execution error payload (accompanies isError: true): the same issue shape rcf validate --json ships',
  properties: {
    ok: { const: false },
    errors: { type: 'array', items: ISSUE_SCHEMA },
  },
  required: ['ok', 'errors'],
};

/**
 * Wrap a success envelope schema as the declared outputSchema: the
 * envelope verbatim, or the D11 error payload.
 *
 * @param {object} successSchema
 * @returns {object}
 */
function withErrorPayload(successSchema) {
  return { type: 'object', anyOf: [successSchema, ERROR_PAYLOAD_SCHEMA] };
}

const TRACE_NODE_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    kind: { type: 'string' },
    depth: { type: 'integer', description: '0 for the pivot; positive for descendants; negative for ancestors' },
  },
  required: ['id', 'kind', 'depth'],
};

const TRACE_EDGE_SCHEMA = {
  type: 'object',
  properties: {
    from: { type: 'string' },
    to: { type: 'string' },
    kind: { type: 'string', enum: ['parentChild', 'crossLink'] },
  },
  required: ['from', 'to', 'kind'],
};

const VALIDATE_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    issues: { type: 'array', items: ISSUE_SCHEMA },
  },
  required: ['ok', 'issues'],
};

const COVERAGE_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    ok: { type: 'boolean', description: 'true when every requirement in scope is covered' },
    strict: { type: 'boolean', description: 'the strict flag echoed in the envelope' },
    totals: {
      type: 'object',
      properties: {
        requirements: { type: 'integer' },
        covered: { type: 'integer' },
        uncovered: { type: 'integer' },
      },
      required: ['requirements', 'covered', 'uncovered'],
    },
    requirements: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          covered: { type: 'boolean' },
          acs: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                covered: { type: 'boolean' },
                testCases: { type: 'array', items: { type: 'string' } },
                cnIds: { type: 'array', items: { type: 'string' }, description: 'present when withCode is true (Phase 10)' },
                codeClass: {
                  type: 'string',
                  enum: ['implemented-and-covered', 'implemented-uncovered', 'unimplemented'],
                  description: 'present when withCode is true (Phase 10, D11)',
                },
              },
              required: ['id', 'covered', 'testCases'],
            },
          },
        },
        required: ['id', 'covered', 'acs'],
      },
    },
    withCode: { type: 'boolean', description: 'Phase 10: echoes the withCode flag' },
    codeNodeOrphans: { type: 'array', items: { type: 'string' }, description: 'Phase 10: CN ids with empty implementsAcIds; present when withCode is true' },
    codeTotals: {
      type: 'object',
      description: 'Phase 10: present when withCode is true',
      properties: {
        implementedAndCovered: { type: 'integer' },
        implementedUncovered: { type: 'integer' },
        unimplemented: { type: 'integer' },
      },
    },
  },
  required: ['ok', 'strict', 'totals', 'requirements'],
};

const TRACE_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    pivot: { type: 'string' },
    direction: { type: 'string', enum: ['forward', 'back', 'both'] },
    found: { type: 'boolean' },
    nodes: { type: 'array', items: TRACE_NODE_SCHEMA, description: 'present for direction forward | back' },
    edges: { type: 'array', items: TRACE_EDGE_SCHEMA, description: 'present for direction forward | back' },
    ancestors: { type: 'array', items: TRACE_NODE_SCHEMA, description: 'present for direction both; excludes the pivot' },
    descendants: { type: 'array', items: TRACE_NODE_SCHEMA, description: 'present for direction both; excludes the pivot' },
    matches: {
      type: 'array',
      description: 'Phase 10: present instead of pivot/nodes/edges when `id` resolved as a source path matching more than one Code Node',
      items: {
        type: 'object',
        properties: {
          cnId: { type: 'string' },
          path: { type: 'string' },
          nodes: { type: 'array', items: TRACE_NODE_SCHEMA },
          edges: { type: 'array', items: TRACE_EDGE_SCHEMA },
        },
      },
    },
  },
  required: ['pivot', 'direction', 'found'],
};

const IMPACT_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    pivot: { type: 'string' },
    found: { type: 'boolean' },
    nodes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          kind: { type: 'string' },
          role: { type: 'string', enum: ['pivot', 'ancestor', 'descendant'] },
          actionNeeded: { type: ['string', 'null'] },
        },
        required: ['id', 'kind', 'role', 'actionNeeded'],
      },
    },
    edges: { type: 'array', items: TRACE_EDGE_SCHEMA },
  },
  required: ['pivot', 'found'],
};

const READ_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    field: { type: ['string', 'null'], description: 'null when the whole body was requested' },
    value: { description: 'the document body or the extracted field; any JSON type' },
  },
  required: ['id', 'field', 'value'],
};

const CREATE_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    id: { type: 'string' },
    kind: { type: 'string' },
    filePath: { type: 'string' },
    dryRun: { type: 'boolean', description: 'present and true when nothing was written' },
  },
  required: ['ok', 'id', 'kind', 'filePath'],
};

const UPDATE_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    id: { type: 'string' },
    changedPaths: { type: 'array', items: { type: 'string' }, description: 'the dot-paths and top-level patch keys applied' },
    filePath: { type: 'string' },
    dryRun: { type: 'boolean', description: 'present and true when nothing was written' },
  },
  required: ['ok', 'id', 'changedPaths'],
};

const DELETE_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    deleted: { type: 'array', items: { type: 'string' }, description: 'removed document ids (singular without cascade)' },
    mutated: {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: { type: 'string' }, filePath: { type: 'string' } },
        required: ['id', 'filePath'],
      },
      description: 'documents edited to drop backrefs',
    },
    plan: { type: 'array', items: { type: 'string' } },
    dryRun: { type: 'boolean', description: 'present and true when the plan was not executed' },
  },
  required: ['ok', 'deleted'],
};

const LINK_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    usId: { type: 'string' },
    tacIds: { type: 'array', items: { type: 'string' }, description: 'the post-state of the user story tacIds' },
    dryRun: { type: 'boolean', description: 'present and true when nothing was written' },
  },
  required: ['ok', 'usId', 'tacIds'],
};

// Transcribes the AS-BUILT Phase 6 D14 json envelope verbatim
// (src/build/formatters/json.js over src/build/bundle.js), including
// the additive bs / prd identity blocks. Ids are distributed across
// the sectioned envelope - there is deliberately no flat included-ids
// field (reconciliation 2026-07-06, carry 3).
const BUILD_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    mode: { type: 'string', enum: ['bundle'] },
    fbs: {
      type: 'object',
      properties: {
        fbsId: { type: 'string' },
        title: { type: 'string' },
        buildOrder: { type: 'integer' },
        executionStatus: { type: 'string' },
        summary: { type: 'string' },
        approach: { type: 'string' },
        deliverables: { type: 'array' },
        notes: { type: 'string' },
        estimatedSize: { type: 'string' },
        estimatedHours: { type: 'number' },
        riskLevel: { type: 'string' },
        domain: { type: 'string' },
        updatedAt: { type: 'string' },
      },
      required: ['fbsId'],
    },
    queue: {
      type: 'object',
      properties: { position: { type: 'integer' }, total: { type: 'integer' } },
      required: ['position', 'total'],
    },
    bs: {
      type: ['object', 'null'],
      properties: {
        bsId: { type: 'string' },
        title: { type: 'string' },
        buildPhilosophy: { type: 'string' },
        generationStrategy: { type: 'string' },
      },
    },
    prd: {
      type: ['object', 'null'],
      properties: { prdId: { type: 'string' }, productName: { type: 'string' } },
    },
    blockedBy: { type: 'array', items: { type: 'string' }, description: 'unsatisfied dependency FBS ids; a non-empty list means the item is blocked (data, not an error)' },
    dependencies: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          fbsId: { type: 'string' },
          title: { type: 'string' },
          executionStatus: { type: 'string' },
        },
        required: ['fbsId'],
      },
    },
    dependents: { type: 'array', items: { type: 'string' } },
    acceptanceCriteria: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          description: { type: 'string' },
          given: { type: 'string' },
          when: { type: 'string' },
          then: { type: 'string' },
          testable: { type: 'boolean' },
          usId: { type: 'string' },
          reqId: { type: 'string' },
        },
        required: ['id', 'usId', 'reqId'],
      },
    },
    userStories: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          usId: { type: 'string' },
          title: { type: 'string' },
          asA: { type: 'string' },
          iWant: { type: 'string' },
          soThat: { type: 'string' },
          status: { type: 'string' },
        },
        required: ['usId'],
      },
    },
    requirements: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          reqId: { type: 'string' },
          title: { type: 'string' },
          description: { type: 'string' },
          category: { type: 'string' },
          priority: { type: 'string' },
          rationale: { type: 'string' },
        },
        required: ['reqId'],
      },
    },
    context: {
      type: 'object',
      description: 'architectural context; omitted entirely when the FBS has no contextRequirements',
      properties: {
        tacs: { type: 'array' },
        adrs: { type: 'array' },
        tadSections: { type: 'object' },
        prdSections: { type: 'object' },
        unresolvedSections: { type: 'array', items: { type: 'string' } },
        passThrough: {
          type: 'object',
          properties: {
            existingModules: { type: 'array' },
            schemas: { type: 'array' },
            externalDocs: { type: 'array' },
            other: { type: 'array' },
          },
        },
      },
    },
    tests: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          acId: { type: 'string' },
          covered: { type: 'boolean' },
          suites: { type: 'array', items: { type: 'string' } },
          cases: { type: 'array' },
        },
        required: ['acId', 'covered', 'suites', 'cases'],
      },
    },
    completionContract: {
      type: 'object',
      properties: {
        markInProgress: { type: 'string' },
        markComplete: { type: 'string' },
        markVerified: { type: 'string' },
      },
      required: ['markInProgress', 'markComplete', 'markVerified'],
    },
  },
  required: [
    'ok', 'mode', 'fbs', 'queue', 'bs', 'prd', 'blockedBy', 'dependencies',
    'dependents', 'acceptanceCriteria', 'userStories', 'requirements',
    'tests', 'completionContract',
  ],
};

// ---------------------------------------------------------------------------
// Tool definitions (D5-D7, D17)
// ---------------------------------------------------------------------------

const KIND_ENUM = ['req', 'us', 'ac', 'tac', 'adr', 'fbs', 'ts', 'tc', 'cn'];

const DEFINITIONS = [
  {
    name: 'rcf_validate',
    title: 'Validate the RCF tree',
    description: 'Reports whether the RCF tree is structurally sound: schema-validation, broken-reference and Code Node staleness issues across every document. A tree with issues returns {ok: false, issues: [...]} as data, not an error - the issues ARE the answer. Run this first in any session, and again after every tree edit (the build-cycle playbook, rcf_execute_build_cycle, prescribes it).',
    inputSchema: {
      type: 'object',
      properties: {
        noCode: { type: 'boolean', description: 'Phase 10: skip the Code Node staleness pass (spec-graph checks only); defaults to false (full validation)' },
      },
      additionalProperties: false,
    },
    outputSchema: withErrorPayload(VALIDATE_OUTPUT_SCHEMA),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'rcf_coverage',
    title: 'Structural coverage report',
    description: 'Reports which requirements have at least one complete chain to a test case (PRD -> REQ -> US -> AC -> TS -> TC). This is a mechanical, deterministic structural check: it does NOT judge whether the AC set adequately captures a requirement\'s intent. In strict mode, gaps are returned as data ({ok: false} in the envelope), never as a tool error - unlike the CLI, which exits 4 for CI gating. Method: TS / TC docs are authored deliverables - a coverage gap means the test layer is not finished, not a stat to report.',
    inputSchema: {
      type: 'object',
      properties: {
        scopeId: { type: 'string', description: 'Optional PRD / REQ / US id to scope coverage; below-AC ids are refused' },
        strict: { type: 'boolean', description: 'Per-AC-strict mode (every AC needs TC coverage); defaults to false (shallow-any)' },
        withCode: { type: 'boolean', description: 'Phase 10: layer the code axis onto every AC (implemented-and-covered / implemented-uncovered / unimplemented) plus a codeNodeOrphans list. Informational only - never affects ok or the exit-code twin.' },
      },
      additionalProperties: false,
    },
    outputSchema: withErrorPayload(COVERAGE_OUTPUT_SCHEMA),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'rcf_trace',
    title: 'Trace the graph from an id or a source path',
    description: 'Answers "what hangs off this document" (forward), "what does it hang off" (back), or both, from any document id. Back-traces follow parent-child edges only; cross-link fan-out is what rcf_impact is for. Phase 10: when id does not resolve to a document, it is tried as a source path (optionally #symbol-suffixed) and traced backward from the matching Code Node(s) up to the root PRD; toCode extends a forward/both trace into the code layer. Method: trace before touching anything that other documents hang off.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Pivot document id (e.g. REQ-101, AC-201-1) or a repo-relative source path, optionally #symbol-suffixed' },
        direction: { type: 'string', enum: ['forward', 'back', 'both'], description: 'Walk direction; defaults to forward, matching the CLI' },
        toCode: { type: 'boolean', description: 'Phase 10: extend a forward/both trace into implementing/dependent Code Nodes; defaults to false (byte-identical to pre-Phase-10 behaviour)' },
      },
      required: ['id'],
      additionalProperties: false,
    },
    outputSchema: withErrorPayload(TRACE_OUTPUT_SCHEMA),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'rcf_impact',
    title: 'Impact fan-out for a change',
    description: 'Answers "if this document changes, what needs re-checking": ancestors and descendants with a per-node action label (re-run, re-verify, re-approve, review-scope, review-arch, review-plan, re-execute, review-context, re-verify-code). Phase 10: toCode extends the descendant fan-out into Code Nodes implementing an affected AC. Method: run this before changing any document with dependents.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Pivot document id' },
        toCode: { type: 'boolean', description: 'Phase 10: extend the descendant fan-out into Code Nodes; defaults to false' },
      },
      required: ['id'],
      additionalProperties: false,
    },
    outputSchema: withErrorPayload(IMPACT_OUTPUT_SCHEMA),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'rcf_read',
    title: 'Read a document',
    description: 'Returns one document\'s body (or a single dot-path field) by id. Resolves standalone documents, inline acceptance criteria (AC-...), inline test cases (TC-...) and MANIFEST. Method: read the real document before editing it - updates patch what exists, never a remembered body.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Document id, e.g. REQ-002, US-101, AC-101-1, MANIFEST' },
        field: { type: 'string', description: 'Optional dot-path to a single field, e.g. acceptanceCriteria[0].description' },
      },
      required: ['id'],
      additionalProperties: false,
    },
    outputSchema: withErrorPayload(READ_OUTPUT_SCHEMA),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'rcf_create',
    title: 'Create a document',
    description: 'Creates a new RCF document of the given kind. Inline kinds (ac, tc) mutate their parent document; every other kind writes one new file. Phase 10: cn (Code Node) has no parent - its identity is path, optionally #symbol-suffixed; implementsAcIds (via acIds) and dependencies (via deps) are optional cross-links, validated against known ACs / Code Nodes. Body fields beyond the dedicated properties go in the body object; dedicated properties win on conflict. Method: RCF layers (PRD -> REQ -> US -> AC -> TS -> TC, plus TAD / TAC / ADR) are elicited with the stakeholder - see the rcf_elicit_requirements prompt - never fabricated single-shot.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: KIND_ENUM, description: 'Document kind' },
        parent: { type: 'string', description: 'Parent document id; required for every kind except cn (which has no parent)' },
        id: { type: 'string', description: 'Override the auto-assigned id (refuses on collision)' },
        title: { type: 'string', description: 'Required for req / us / tac / adr / fbs / ts' },
        description: { type: 'string', description: 'Required for ac / tc' },
        purpose: { type: 'string', description: 'Required for ts' },
        testLevel: { type: 'string', enum: ['unit', 'integration', 'e2e', 'contract', 'manual'], description: 'Required for ts' },
        acIds: { type: 'array', items: { type: 'string' }, description: 'Required for fbs and ts: one or more AC ids. For cn: implementsAcIds (may be empty - an orphan CN is legitimate).' },
        acId: { type: 'string', description: 'Required for tc: the single AC this test case exercises' },
        slug: { type: 'string', description: 'Optional for tc; derived from description if absent' },
        testPointer: { type: 'string', description: 'Optional for tc; format filePath::testName' },
        buildOrder: { type: 'integer', minimum: 1, description: 'Optional for fbs; defaults to max+1 within its build sequence' },
        path: { type: 'string', description: 'Required for cn: repo-relative source path, optionally #symbol-suffixed' },
        deps: { type: 'array', items: { type: 'string' }, description: 'Optional for cn: Code Node ids this node depends on' },
        body: { type: 'object', description: 'Further body fields as JSON (the MCP twin of --from-file)' },
        dryRun: { type: 'boolean', description: 'Report the intended id / path without writing; defaults to false' },
      },
      required: ['kind'],
      additionalProperties: false,
    },
    outputSchema: withErrorPayload(CREATE_OUTPUT_SCHEMA),
    annotations: { destructiveHint: false },
  },
  {
    name: 'rcf_update',
    title: 'Update a document',
    description: 'Patches fields on an existing document: dot-path sets, a deep-merge patch object, or both. Refuses to touch id, createdAt and schemaVersion. Values are any JSON type - no string re-encoding. Method: document content comes from stakeholder elicitation (rcf_elicit_requirements prompt), not invention.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Target document id (supports inline AC / TC ids)' },
        sets: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'Dot-path, e.g. status or acceptanceCriteria[0].description' },
              value: { description: 'The value to set; any JSON type' },
            },
            required: ['path', 'value'],
            additionalProperties: false,
          },
          description: 'Dot-path assignments',
        },
        patch: { type: 'object', description: 'Deep-merge body fields (arrays replace); the MCP twin of --from-file' },
        dryRun: { type: 'boolean', description: 'Report the intended write without executing; defaults to false' },
      },
      required: ['id'],
      additionalProperties: false,
    },
    outputSchema: withErrorPayload(UPDATE_OUTPUT_SCHEMA),
    annotations: { destructiveHint: false },
  },
  {
    name: 'rcf_delete',
    title: 'Delete a document',
    description: 'Deletes a document. Refuses by default when the document has dependents; cascade: true also deletes dependents and drops backrefs. dryRun returns the deletion plan without executing. Method: when unsure what hangs off the target, run rcf_impact first.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        cascade: { type: 'boolean', description: 'Also delete dependents and drop backrefs; defaults to false (refuse when dependents exist)' },
        dryRun: { type: 'boolean', description: 'Return the deletion plan without executing; defaults to false' },
      },
      required: ['id'],
      additionalProperties: false,
    },
    outputSchema: withErrorPayload(DELETE_OUTPUT_SCHEMA),
    annotations: { destructiveHint: true, idempotentHint: true },
  },
  {
    name: 'rcf_link',
    title: 'Link a user story to TACs',
    description: 'Appends one or more TAC ids to a user story\'s tacIds. Idempotent: linking an already-linked TAC is a no-op. Returns the post-state of tacIds. Method: TAC links record the elicited tech layer (TAD / TAC / ADR) of the chain - author it, do not skip it.',
    inputSchema: {
      type: 'object',
      properties: {
        usId: { type: 'string', description: 'The user story id' },
        tacIds: { type: 'array', items: { type: 'string' }, minItems: 1, description: 'TAC ids to link' },
        dryRun: { type: 'boolean', description: 'Report the intended write without executing; defaults to false' },
      },
      required: ['usId', 'tacIds'],
      additionalProperties: false,
    },
    outputSchema: withErrorPayload(LINK_OUTPUT_SCHEMA),
    annotations: { idempotentHint: true },
  },
  {
    name: 'rcf_unlink',
    title: 'Unlink a user story from TACs',
    description: 'Removes one or more TAC ids from a user story\'s tacIds. Idempotent: unlinking an absent TAC is a no-op. Returns the post-state of tacIds. Method: keep tech-layer links honest - unlink only what the stakeholder agreed no longer applies.',
    inputSchema: {
      type: 'object',
      properties: {
        usId: { type: 'string', description: 'The user story id' },
        tacIds: { type: 'array', items: { type: 'string' }, minItems: 1, description: 'TAC ids to unlink' },
        dryRun: { type: 'boolean', description: 'Report the intended write without executing; defaults to false' },
      },
      required: ['usId', 'tacIds'],
      additionalProperties: false,
    },
    outputSchema: withErrorPayload(LINK_OUTPUT_SCHEMA),
    annotations: { idempotentHint: true },
  },
  {
    name: 'rcf_build',
    title: 'Assemble an FBS spec bundle',
    description: 'Assembles the complete spec bundle for one FBS item: the work, queue and dependency context, acceptance criteria with US / REQ ancestry, architectural context, existing test surface and the completion contract. Addresses FBS ids ONLY - the FBS is the queue unit. A blocked item still returns its bundle; blockedBy in the envelope carries the fact as data. Bundle assembly is mechanical: it projects what the tree says and does not judge whether the FBS is well-specified. Method: execute the bundle via the five-stage runbook in the rcf_execute_build_cycle prompt (Define, Build, Review, Test, Finalise).',
    inputSchema: {
      type: 'object',
      properties: {
        fbsId: { type: 'string', description: 'The FBS item to bundle, e.g. FBS-003. User story ids are refused - to find the FBS items behind a story, call rcf_trace with the US id' },
      },
      required: ['fbsId'],
      additionalProperties: false,
    },
    outputSchema: withErrorPayload(BUILD_OUTPUT_SCHEMA),
    annotations: { readOnlyHint: true },
  },
];

// ---------------------------------------------------------------------------
// Minimal argument validation against the D7 schema subset
// ---------------------------------------------------------------------------

/**
 * Validate a value against the closed-object JSON Schema subset the
 * D7 input schemas use: type, enum, properties, required,
 * additionalProperties: false, items, minimum, minItems. Not a general
 * JSON Schema validator - exactly the checks our schemas need, so the
 * runtime stays dependency-free (D21). The devDependency conformance
 * layer exercises the schemas through the official SDK client.
 *
 * @param {object} schema
 * @param {unknown} value
 * @param {string} at - path label for messages
 * @param {string[]} problems - accumulator
 */
function checkSchema(schema, value, at, problems) {
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => matchesType(t, value))) {
      problems.push(`${at}: expected ${types.join(' | ')}`);
      return;
    }
  }
  if (schema.enum !== undefined && !schema.enum.includes(value)) {
    problems.push(`${at}: expected one of ${schema.enum.join(' | ')}`);
    return;
  }
  if (typeof value === 'number' && schema.minimum !== undefined && value < schema.minimum) {
    problems.push(`${at}: expected >= ${schema.minimum}`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      problems.push(`${at}: expected at least ${schema.minItems} item(s)`);
    }
    if (schema.items) {
      value.forEach((item, i) => checkSchema(schema.items, item, `${at}[${i}]`, problems));
    }
    return;
  }
  if (value && typeof value === 'object' && (schema.properties || schema.required || schema.additionalProperties === false)) {
    const properties = schema.properties ?? {};
    for (const key of schema.required ?? []) {
      if (!(key in value)) problems.push(`${at}.${key}: required`.replace(/^args\./, ''));
    }
    for (const [key, v] of Object.entries(value)) {
      const propSchema = properties[key];
      if (!propSchema) {
        if (schema.additionalProperties === false) {
          problems.push(`${at}.${key}: unknown property`.replace(/^args\./, ''));
        }
        continue;
      }
      checkSchema(propSchema, v, `${at}.${key}`.replace(/^args\./, ''), problems);
    }
  }
}

function matchesType(t, value) {
  switch (t) {
    case 'string': return typeof value === 'string';
    case 'boolean': return typeof value === 'boolean';
    case 'number': return typeof value === 'number' && Number.isFinite(value);
    case 'integer': return typeof value === 'number' && Number.isInteger(value);
    case 'array': return Array.isArray(value);
    case 'object': return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
    case 'null': return value === null;
    default: return false;
  }
}

/**
 * @param {object} schema - a D7 inputSchema
 * @param {unknown} args
 * @returns {string[]} problems (empty = valid)
 */
export function validateToolArgs(schema, args) {
  const problems = [];
  checkSchema(schema, args ?? {}, 'args', problems);
  return problems;
}

// ---------------------------------------------------------------------------
// rcf_read target resolution (mirrors src/cli/read.js, which does not
// export its private helpers and is out of this phase's edit surface)
// ---------------------------------------------------------------------------

function resolveTarget(tree, id) {
  if (id === 'MANIFEST' && tree.manifest) return { doc: tree.manifest };
  const doc = tree.byId.get(id);
  if (doc) return { doc };
  if (/^AC-\d+(-\d+)?$/.test(id)) {
    const parentId = tree.parentByChild.get(id);
    if (!parentId) return null;
    const us = tree.byId.get(parentId);
    if (!us) return null;
    const entry = (us.acceptanceCriteria ?? []).find((ac) => ac.id === id);
    return entry ? { doc: entry } : null;
  }
  if (/^TC-\d{3}-[a-z0-9-]+$/.test(id)) {
    const parentId = tree.parentByChild.get(id);
    if (!parentId) return null;
    const ts = tree.byId.get(parentId);
    if (!ts) return null;
    const entry = (ts.testCases ?? []).find((tc) => tc.id === id);
    return entry ? { doc: entry } : null;
  }
  return null;
}

/**
 * Phase 10 (X2 CodeNode bridge): resolve a source-path query to Code Node
 * ids. Mirrors src/cli/trace.js's resolveCodeNodesForPath. Matches a CN
 * when its `path` equals the query (file-level or file#symbol form) or
 * when the query names the file that a symbol-level CN lives in.
 *
 * @param {object} tree - walker TreeModel
 * @param {string} query - a repo-relative path, optionally #symbol-suffixed
 * @returns {string[]} matching CN ids, sorted
 */
function resolveCodeNodesForPath(tree, query) {
  const out = [];
  for (const cn of tree.codeNodes ?? []) {
    const cnPath = cn.path ?? '';
    const cnFile = cnPath.split('#')[0];
    if (cnPath === query || cnFile === query) out.push(cn.cnId);
  }
  return out.sort();
}

function extractField(root, path) {
  const parts = parseDotPath(path);
  if (!parts) return undefined;
  let cur = root;
  for (const seg of parts) {
    if (cur === undefined || cur === null) return undefined;
    if (seg.kind === 'index') {
      if (!Array.isArray(cur)) return undefined;
      cur = cur[seg.value];
    } else {
      cur = cur[seg.value];
    }
  }
  return cur;
}

function parseDotPath(path) {
  if (typeof path !== 'string' || path.length === 0) return null;
  const parts = [];
  for (const seg of path.split('.')) {
    const m = /^([^\[\]]+)((?:\[\d+\])*)$/.exec(seg);
    if (!m) return null;
    parts.push({ kind: 'prop', value: m[1] });
    if (m[2]) {
      const indices = m[2].match(/\d+/g) ?? [];
      for (const n of indices) parts.push({ kind: 'index', value: Number(n) });
    }
  }
  return parts;
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/**
 * Build a successful tools/call result: the envelope verbatim as
 * structuredContent plus its serialisation as a text block (the
 * 2025-11-25 backwards-compatibility SHOULD).
 *
 * @param {object} envelope
 * @returns {object}
 */
function okResult(envelope) {
  return {
    content: [{ type: 'text', text: JSON.stringify(envelope, null, 2) }],
    structuredContent: envelope,
  };
}

/**
 * Create the tool registry bound to one project root (D13: the root is
 * fixed for the process lifetime).
 *
 * @param {object} opts
 * @param {string} opts.projectRoot
 * @param {{info: (line: string) => void, error: (line: string) => void}} opts.log
 * @returns {{definitions: object[], call: (name: string, args: unknown) => Promise<object>}}
 */
export function createToolRegistry({ projectRoot, log }) {
  const byName = new Map(DEFINITIONS.map((d) => [d.name, d]));

  const handlers = {
    rcf_validate: async (args) => {
      const { tree, errors } = await walkTree({ projectRoot });
      // Phase 10 (X2 CodeNode bridge, D6/D8): the staleness pass runs by
      // default, folded into the same issue list; noCode skips it.
      const allErrors = Boolean(args?.noCode)
        ? errors
        : [...errors, ...(await checkCodeNodeResolution({ projectRoot, tree }))];
      // D10: for validate, the issues ARE the answer - never isError.
      return okResult({ ok: allErrors.length === 0, issues: issuesFromErrors(allErrors) });
    },

    rcf_coverage: async (args) => {
      const { tree, errors } = await walkTree({ projectRoot });
      if (errors.length > 0) return walkerBlockedResult(errors);
      const scopeId = args.scopeId ?? null;
      if (scopeId !== null) {
        const classification = classifyCoverageScope(tree, scopeId);
        if (classification === 'below-ac') {
          return usageErrorResult(
            `coverage: scopeId ${scopeId} is below the AC layer or off the REQ chain; coverage scope must be a PRD / REQ / US id`,
            { documentId: scopeId },
          );
        }
        if (classification !== 'valid') {
          return usageErrorResult(`coverage: id ${scopeId} not found`, { documentId: scopeId });
        }
      }
      // OQ-P7-8: strict gaps return data ({ok: false}), never isError.
      // Phase 10 (D11): withCode layers the informational code axis on.
      return okResult(computeCoverage(tree, { strict: Boolean(args.strict), scopeId, withCode: Boolean(args.withCode) }));
    },

    rcf_trace: async (args) => {
      const { tree, errors } = await walkTree({ projectRoot });
      if (errors.length > 0) return walkerBlockedResult(errors);
      const includeCode = Boolean(args.toCode);
      const direction = args.direction ?? 'forward';

      // Phase 10 (X2 CodeNode bridge, D9): path mode. If `id` is not a
      // known document, try it as a source path resolving to one or more
      // Code Nodes, then trace each backward.
      if (!kindOf(tree, args.id)) {
        const cnIds = resolveCodeNodesForPath(tree, args.id);
        if (cnIds.length === 0) {
          return usageErrorResult(`trace: id ${args.id} not found (no document or code node matches)`, { documentId: args.id });
        }
        if (cnIds.length === 1) {
          const res = computeTrace(tree, { id: cnIds[0], direction: 'back' });
          return okResult(res);
        }
        const matches = cnIds.map((cnId) => {
          const res = computeTrace(tree, { id: cnId, direction: 'back' });
          return { cnId, path: tree.byId.get(cnId)?.path ?? null, nodes: res.nodes, edges: res.edges };
        });
        return okResult({ pivot: args.id, direction: 'back', found: true, matches });
      }

      const result = computeTrace(tree, { id: args.id, direction, includeCode });
      if (!result.found) {
        return usageErrorResult(`trace: id ${args.id} not found`, { documentId: args.id });
      }
      return okResult(result);
    },

    rcf_impact: async (args) => {
      const { tree, errors } = await walkTree({ projectRoot });
      if (errors.length > 0) return walkerBlockedResult(errors);
      const result = computeImpact(tree, { id: args.id, includeCode: Boolean(args.toCode) });
      if (!result.found) {
        return usageErrorResult(`impact: id ${args.id} not found`, { documentId: args.id });
      }
      return okResult(result);
    },

    rcf_read: async (args) => {
      const { tree, errors } = await walkTree({ projectRoot });
      if (errors.length > 0) return walkerBlockedResult(errors);
      const target = resolveTarget(tree, args.id);
      if (!target) {
        return usageErrorResult(`read: id ${args.id} not found`, { documentId: args.id });
      }
      let value = target.doc;
      if (args.field !== undefined) {
        value = extractField(target.doc, args.field);
        if (value === undefined) {
          return usageErrorResult(`read: field ${args.field} not present on ${args.id}`, {
            documentId: args.id,
            field: args.field,
          });
        }
      }
      return okResult({ id: args.id, field: args.field ?? null, value });
    },

    rcf_create: async (args) => {
      // B5: pre-existing tree breakage no longer blocks write tools -
      // the writer gates on the POST-write tree state (net-new breakage
      // still refuses; repairing a broken tree is allowed).
      const { tree, errors } = await walkTree({ projectRoot });
      const kind = args.kind;
      const body = { ...(args.body ?? {}) };
      if (args.title !== undefined) body.title = args.title;
      if (args.description !== undefined) body.description = args.description;
      if (args.purpose !== undefined) body.purpose = args.purpose;
      if (args.testLevel !== undefined) body.testLevel = args.testLevel;
      // Phase 10: cn's AC cross-link field is implementsAcIds, not acIds
      // (fbs/ts share acIds) - acIds maps to whichever the kind expects.
      if (args.acIds !== undefined) {
        if (kind === 'cn') body.implementsAcIds = args.acIds;
        else body.acIds = args.acIds;
      }
      if (kind === 'cn') {
        if (args.path !== undefined) body.path = args.path;
        if (args.deps !== undefined) body.dependencies = args.deps;
      }

      const options = {
        id: args.id,
        parentId: args.parent,
        dryRun: Boolean(args.dryRun),
      };

      // Per-kind mandatory fields (mirrors src/cli/create.js).
      if (kind === 'ac' || kind === 'tc') {
        if (!body.description) return usageErrorResult(`create ${kind}: description is required`);
      } else if (kind === 'cn') {
        if (!body.path) return usageErrorResult('create cn: path is required');
      } else if (!body.title) {
        return usageErrorResult(`create ${kind}: title is required`);
      }
      if (kind === 'ts') {
        if (!body.purpose) return usageErrorResult('create ts: purpose is required');
        if (!body.testLevel) return usageErrorResult('create ts: testLevel is required');
        if (!Array.isArray(body.acIds) || body.acIds.length === 0) {
          return usageErrorResult('create ts: acIds is required (one or more AC ids)');
        }
      }
      if (kind === 'fbs') {
        if (!Array.isArray(body.acIds) || body.acIds.length === 0) {
          return usageErrorResult('create fbs: acIds is required (one or more AC ids)');
        }
        if (args.buildOrder !== undefined) options.buildOrder = args.buildOrder;
      }
      if (kind === 'tc') {
        if (!args.acId) return usageErrorResult('create tc: acId is required');
        body.acId = args.acId;
        options.slug = args.slug ?? deriveSlug(body.description);
        if (args.testPointer !== undefined) options.testPointer = args.testPointer;
      }

      const result = await createDocument({ projectRoot, tree, kind, body, options, walkErrors: errors });
      if (isRcfError(result)) return writerErrorResult(result, log);
      return okResult({
        ok: true,
        id: result.id,
        kind,
        filePath: result.filePath,
        ...(result.dryRun ? { dryRun: true } : {}),
      });
    },

    rcf_update: async (args) => {
      // B5: no pre-write walk gate - repairing a broken doc IS an update.
      const { tree, errors } = await walkTree({ projectRoot });
      const sets = args.sets ?? [];
      const patch = args.patch ?? null;
      if (sets.length === 0 && !patch) {
        return usageErrorResult('update: at least one of sets or patch is required', { documentId: args.id });
      }
      const result = await updateDocument({
        projectRoot,
        tree,
        id: args.id,
        patch,
        sets,
        options: { dryRun: Boolean(args.dryRun) },
        walkErrors: errors,
      });
      if (isRcfError(result)) return writerErrorResult(result, log);
      const changedPaths = [
        ...Object.keys(patch ?? {}),
        ...sets.map((s) => s.path),
      ];
      return okResult({
        ok: true,
        id: result.id,
        changedPaths,
        filePath: result.filePath,
        ...(result.dryRun ? { dryRun: true } : {}),
      });
    },

    rcf_delete: async (args) => {
      // B5: no pre-write walk gate - deleting the offending doc is the
      // canonical repair for a wedged tree.
      const { tree, errors } = await walkTree({ projectRoot });
      const dryRun = Boolean(args.dryRun);
      const result = await deleteDocument({
        projectRoot,
        tree,
        id: args.id,
        options: { cascade: Boolean(args.cascade), dryRun },
        walkErrors: errors,
      });
      if (isRcfError(result)) return writerErrorResult(result, log);
      return okResult({
        ok: true,
        deleted: result.deleted,
        mutated: result.mutated,
        plan: result.plan,
        ...(dryRun ? { dryRun: true } : {}),
      });
    },

    rcf_link: (args) => linkHandler(args, false),
    rcf_unlink: (args) => linkHandler(args, true),

    rcf_build: async (args) => {
      const { tree, errors } = await walkTree({ projectRoot });
      if (errors.length > 0) return walkerBlockedResult(errors);
      const fbsId = args.fbsId;
      // FBS-id-only addressing (reconciliation carry 1, mirroring the
      // shipped Phase 6 D1 behaviour): a US id is a usage error that
      // points the agent at rcf_trace.
      const kind = kindOf(tree, fbsId);
      if (kind !== 'fbs') {
        if (kind === 'userStory') {
          return usageErrorResult(
            `build: ${fbsId} is a user story, not an FBS id; the FBS is the queue unit. `
              + `To list the FBS items linked to this story, call rcf_trace with id ${fbsId} and direction forward`,
            { documentId: fbsId },
          );
        }
        if (kind) {
          return usageErrorResult(`build: ${fbsId} is a ${kind} id; rcf_build addresses FBS items only`, { documentId: fbsId });
        }
        return usageErrorResult(`build: id ${fbsId} not found`, { documentId: fbsId });
      }
      const bundle = assembleBundle(tree, { fbsId });
      // Same construction as src/build/formatters/json.js over the
      // same object - envelope identity with `--format json` by
      // construction, then locked by the parity tests (D20). No
      // strict gate here: blockedBy carries the fact as data
      // (reconciliation carry 2, OQ-P7-8 posture).
      return okResult({ ok: true, mode: 'bundle', ...bundle });
    },
  };

  async function linkHandler(args, removing) {
    // B5: no pre-write walk gate on write tools (post-write gate applies).
    const { tree, errors } = await walkTree({ projectRoot });
    const verb = removing ? 'unlink' : 'link';
    const us = tree.byId.get(args.usId);
    if (!us || tree.kindById.get(args.usId) !== 'userStory') {
      return usageErrorResult(`${verb}: ${args.usId} is not an existing US`, { documentId: args.usId });
    }
    for (const tacId of args.tacIds) {
      if (tree.kindById.get(tacId) !== 'tac') {
        return errorResult([{
          kind: 'brokenReference',
          message: `${verb}: ${tacId} is not an existing TAC`,
          documentId: tacId,
          field: 'tacIds',
          rule: 'resolveTo:tac',
        }]);
      }
    }
    const current = new Set(us.tacIds ?? []);
    const target = new Set(current);
    for (const tacId of args.tacIds) {
      if (removing) target.delete(tacId); else target.add(tacId);
    }
    const next = [...target].sort();
    const currentSorted = [...current].sort();
    const changed = next.length !== currentSorted.length || next.some((id, i) => id !== currentSorted[i]);
    const dryRun = Boolean(args.dryRun);
    if (!changed) {
      // Idempotent no-op: the post-state is already the target state.
      return okResult({ ok: true, usId: args.usId, tacIds: next, ...(dryRun ? { dryRun: true } : {}) });
    }
    const result = await updateDocument({
      projectRoot,
      tree,
      id: args.usId,
      patch: { tacIds: next },
      sets: [],
      options: { dryRun },
      walkErrors: errors,
    });
    if (isRcfError(result)) return writerErrorResult(result, log);
    return okResult({ ok: true, usId: args.usId, tacIds: next, ...(dryRun ? { dryRun: true } : {}) });
  }

  /**
   * Dispatch one tools/call. Unknown tool names are protocol errors
   * (-32602, spec-mandated); argument-schema misses are tool execution
   * errors the model can self-correct from (D10).
   *
   * @param {string} name
   * @param {unknown} args
   * @returns {Promise<object>}
   */
  // Theme 1 setup funnel (touchpoint iii): server running, tree present,
  // but the rcf marker block is absent from the project-root agent
  // instructions - the session started without the init bootstrap.
  // Every tool response then carries ONE firm instruction routing back
  // to `npx rcf init` + a session restart. Cheap file check; a positive
  // (marker present) is cached for the server-process lifetime so the
  // notice disappears permanently once setup is complete.
  let markerSeen = false;
  async function setupFunnelNotice() {
    if (markerSeen) return null;
    markerSeen = await hasAgentMarker(projectRoot);
    return markerSeen ? null : SETUP_FUNNEL_INSTRUCTION;
  }

  async function call(name, args) {
    const definition = byName.get(name);
    if (!definition) {
      throw new JsonRpcError(INVALID_PARAMS, `Unknown tool: ${name}`);
    }
    const problems = validateToolArgs(definition.inputSchema, args);
    if (problems.length > 0) {
      return usageErrorResult(`${name}: invalid arguments: ${problems.join('; ')}`);
    }
    let result;
    try {
      result = await handlers[name](args ?? {});
    } catch (err) {
      // Defensive: pure-layer throws become execution errors with the
      // stack on stderr only.
      const e = /** @type {Error} */ (err);
      return unexpectedFailureResult({ kind: 'ioFailure', message: e.message, stack: e.stack }, log);
    }
    const notice = await setupFunnelNotice();
    if (notice) {
      result = { ...result, content: [...(result.content ?? []), { type: 'text', text: notice }] };
    }
    return result;
  }

  return { definitions: DEFINITIONS, call };
}
