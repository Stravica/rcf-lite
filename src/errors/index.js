// Structured error type owned by TAC-007 and consumed by the store, the
// walker, the renderer and (later) every CLI / MCP surface.
//
// Errors are plain data, not thrown exceptions. Every adapter returns them
// so the rendering of "what is wrong" is uniform across surfaces. At Phase
// 3 the renderer surfaces them on stderr and, in the default mode, also
// renders them inline in the page so an owner can see what is broken.

/**
 * @typedef {('validation'|'missingFile'|'brokenReference'|'parseFailure'|'ioFailure'|'usage'|'staleCode')} ErrorKind
 */

/**
 * @typedef {object} RcfError
 * @property {ErrorKind} kind
 * @property {string} message
 * @property {string} [documentId]
 * @property {string} [filePath]
 * @property {string} [field]
 * @property {string} [rule]
 * @property {string} [stack] - underlying Error.stack for exit-1 spec §D15
 */

const VALID_KINDS = new Set([
  'validation',
  'missingFile',
  'brokenReference',
  'parseFailure',
  'ioFailure',
  'usage',
  // Phase 10 (X2 CodeNode bridge): a Code Node's declared path/symbol no
  // longer resolves against the working tree (file renamed/moved, or symbol
  // renamed/removed). This is the X2 advantage over sidecar approaches:
  // the breakage is mechanically detectable at `rcf validate` time.
  'staleCode',
]);

/**
 * Construct a structured error.
 *
 * @param {object} opts
 * @param {ErrorKind} opts.kind
 * @param {string} opts.message
 * @param {string} [opts.documentId]
 * @param {string} [opts.filePath]
 * @param {string} [opts.field]
 * @param {string} [opts.rule]
 * @param {string} [opts.stack] - underlying Error.stack, retained on
 *   `ioFailure` so CLI handlers can emit the spec §D15 `[rcf]
 *   unexpected failure` block including the stack.
 * @returns {RcfError}
 */
export function rcfError({ kind, message, documentId, filePath, field, rule, stack }) {
  if (!VALID_KINDS.has(kind)) {
    throw new TypeError(`Unknown error kind: ${kind}`);
  }
  if (typeof message !== 'string' || message.length === 0) {
    throw new TypeError('rcfError requires a non-empty message');
  }
  const out = { kind, message };
  if (documentId !== undefined) out.documentId = documentId;
  if (filePath !== undefined) out.filePath = filePath;
  if (field !== undefined) out.field = field;
  if (rule !== undefined) out.rule = rule;
  if (typeof stack === 'string' && stack.length > 0) out.stack = stack;
  return out;
}

/**
 * Emit the spec §D15 `[rcf] unexpected failure` block to a stream.
 * Used by CLI handlers when they receive a structured `ioFailure` —
 * exit 1 is the "unexpected / IO" escape hatch and must always print
 * `[rcf] unexpected failure: <message>\n<stack>` on stderr, per spec.
 *
 * @param {RcfError} err
 * @param {NodeJS.WritableStream} stderr
 */
export function writeUnexpectedFailure(err, stderr) {
  const message = err.message ?? 'unexpected failure';
  const stack = err.stack ?? '';
  stderr.write(`[rcf] unexpected failure: ${message}\n${stack}\n`);
}

/**
 * Type guard.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isRcfError(value) {
  if (!value || typeof value !== 'object') return false;
  const v = /** @type {{ kind?: unknown, message?: unknown }} */ (value);
  return (
    typeof v.kind === 'string' &&
    VALID_KINDS.has(/** @type {ErrorKind} */ (v.kind)) &&
    typeof v.message === 'string'
  );
}

/**
 * Render one error as a single line for stderr. Verbose mode appends the
 * field and rule when present.
 *
 * @param {RcfError} err
 * @param {{ verbose?: boolean }} [opts]
 * @returns {string}
 */
export function formatError(err, opts = {}) {
  const verbose = Boolean(opts.verbose);
  const parts = [`[error] ${err.kind}`];
  if (err.documentId) parts.push(`${err.documentId}:`);
  else if (err.filePath) parts.push(`${err.filePath}:`);
  else parts.push('');
  parts.push(err.message);
  let line = parts.filter(Boolean).join(' ');
  if (verbose) {
    const extras = [];
    if (err.field) extras.push(`field=${err.field}`);
    if (err.rule) extras.push(`rule=${err.rule}`);
    if (err.filePath && err.documentId) extras.push(`path=${err.filePath}`);
    if (extras.length > 0) line += ` (${extras.join(', ')})`;
  }
  return line;
}

/**
 * Render a list of errors plus a summary line. Callers that refuse to
 * produce output on errors (the view's --strict startup gate) pass
 * `strict: true` and get "output not written" appended; every other
 * caller gets a plain count. The summary never advertises flags - the
 * verbs sharing this formatter have different (or no) strictness flags,
 * so a flag hint here is wrong for most of them (validate has no
 * --strict at all).
 *
 * When the caller renders only a subset of a larger error list (e.g.
 * `validate --quiet` shows the first 3 of N), pass the true total via
 * `opts.total` so the summary reports the tree-wide count. Without the
 * override the summary reports the length of `errors` (BUG-004 fix).
 *
 * @param {RcfError[]} errors
 * @param {{ verbose?: boolean, strict?: boolean, total?: number }} [opts]
 * @returns {string}
 */
export function formatErrors(errors, opts = {}) {
  if (errors.length === 0) return '';
  const verbose = Boolean(opts.verbose);
  const strict = Boolean(opts.strict);
  const lines = errors.map((e) => formatError(e, { verbose }));
  const count = typeof opts.total === 'number' && Number.isFinite(opts.total)
    ? opts.total
    : errors.length;
  const noun = count === 1 ? 'error' : 'errors';
  const summary = strict
    ? `[error] ${count} ${noun} found; output not written.`
    : `[error] ${count} ${noun} found.`;
  lines.push(summary);
  return lines.join('\n');
}
