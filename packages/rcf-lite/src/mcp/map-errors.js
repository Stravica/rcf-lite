// The D10 / D11 mapping: RcfError lists, writer refusals and unknown
// ids become MCP tool execution errors (`isError: true`) carrying the
// validate-shaped payload `{ok: false, errors: [{id, kind, rule,
// filePath, field, message}]}` - the same per-issue grammar `rcf
// validate --json` ships, so agents parse exactly one error shape
// across the whole surface (D11). Unexpected failures keep their
// stacks on stderr, never in model context (D10).

import { formatError, rcfError } from '@stravica-ai/rcf-lite-core/errors';

/**
 * Map one RcfError to the validate --json issue shape (nullable
 * id / rule / filePath / field). Mirrors src/cli/validate.js.
 *
 * @param {import('@stravica-ai/rcf-lite-core/errors').RcfError} e
 * @returns {{id: string|null, kind: string, rule: string|null, filePath: string|null, field: string|null, message: string}}
 */
export function issueFromRcfError(e) {
  return {
    id: e.documentId ?? null,
    kind: e.kind,
    rule: e.rule ?? null,
    filePath: e.filePath ?? null,
    field: e.field ?? null,
    message: e.message,
  };
}

/**
 * Map a list of RcfErrors to the issues array.
 *
 * @param {import('@stravica-ai/rcf-lite-core/errors').RcfError[]} errors
 * @returns {ReturnType<typeof issueFromRcfError>[]}
 */
export function issuesFromErrors(errors) {
  return errors.map(issueFromRcfError);
}

/**
 * Build a tool execution error result from structured errors. The text
 * block carries the human-readable line(s) via the existing
 * formatError helper (D11); the structured payload is the validate
 * issue shape.
 *
 * @param {import('@stravica-ai/rcf-lite-core/errors').RcfError[]} errors
 * @returns {object} tools/call result with isError: true
 */
export function errorResult(errors) {
  const text = errors.map((e) => formatError(e)).join('\n');
  return {
    content: [{ type: 'text', text }],
    structuredContent: { ok: false, errors: issuesFromErrors(errors) },
    isError: true,
  };
}

/**
 * Single-cause usage error (unknown id, bad argument, refused scope) -
 * a one-element errors array per D11.
 *
 * @param {string} message
 * @param {object} [extras] - optional documentId / field / rule
 * @returns {object}
 */
export function usageErrorResult(message, extras = {}) {
  return errorResult([rcfError({ kind: 'usage', message, ...extras })]);
}

/**
 * D10 row: walker errors block a QUERY. The tree is broken; the agent's
 * next move is fixing it, so it gets the full validate-shaped issue
 * list. Write tools no longer route here (B5): they proceed and gate on
 * the post-write tree state instead - that is how a broken tree gets
 * fixed in-tool.
 *
 * @param {import('@stravica-ai/rcf-lite-core/errors').RcfError[]} errors
 * @returns {object}
 */
export function walkerBlockedResult(errors) {
  return errorResult(errors);
}

/**
 * D10 row: unexpected / IO failure. Message only into model context;
 * the full stack goes to stderr via the injected logger - mirrors
 * writeUnexpectedFailure without leaking stacks into the conversation.
 *
 * @param {import('@stravica-ai/rcf-lite-core/errors').RcfError} err
 * @param {{error: (line: string) => void}} log
 * @returns {object}
 */
export function unexpectedFailureResult(err, log) {
  log.error(`[rcf mcp] unexpected failure: ${err.message}\n${err.stack ?? ''}`);
  const stripped = rcfError({
    kind: 'ioFailure',
    message: err.message,
    ...(err.documentId !== undefined ? { documentId: err.documentId } : {}),
    ...(err.filePath !== undefined ? { filePath: err.filePath } : {}),
  });
  return errorResult([stripped]);
}

/**
 * Map a structured writer return (RcfError) to the right D10 row:
 *   - ioFailure          -> unexpected-failure handling (stack to stderr)
 *   - usage + dependents / wouldOrphan rule -> refusal (exit-4 twin);
 *     message names the dependents and the cascade remedy
 *   - everything else    -> plain execution error with the D11 payload
 *
 * @param {import('@stravica-ai/rcf-lite-core/errors').RcfError} err
 * @param {{error: (line: string) => void}} log
 * @returns {object}
 */
export function writerErrorResult(err, log) {
  if (err.kind === 'ioFailure') {
    return unexpectedFailureResult(err, log);
  }
  if (err.kind === 'usage' && (err.rule === 'dependents' || err.rule === 'wouldOrphan')) {
    // The writer message says "pass --cascade to opt in" - restate the
    // remedy in this surface's vocabulary (D10: names the dependents
    // and the cascade: true remedy).
    const message = `${err.message.replace(/pass --cascade to opt in/, 'set cascade: true to delete dependents too')}`;
    return errorResult([rcfError({
      kind: 'usage',
      message,
      ...(err.documentId !== undefined ? { documentId: err.documentId } : {}),
      rule: err.rule,
    })]);
  }
  return errorResult([err]);
}
