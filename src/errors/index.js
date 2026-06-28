// Structured error type owned by TAC-007 and consumed by the store, the
// walker, the renderer and (later) every CLI / MCP surface.
//
// Errors are plain data, not thrown exceptions. Every adapter returns them
// so the rendering of "what is wrong" is uniform across surfaces. At Phase
// 3 the renderer surfaces them on stderr and, in the default mode, also
// renders them inline in the page so an owner can see what is broken.

/**
 * @typedef {('validation'|'missingFile'|'parseFailure'|'ioFailure'|'usage')} ErrorKind
 */

/**
 * @typedef {object} RcfError
 * @property {ErrorKind} kind
 * @property {string} message
 * @property {string} [documentId]
 * @property {string} [filePath]
 * @property {string} [field]
 * @property {string} [rule]
 */

const VALID_KINDS = new Set([
  'validation',
  'missingFile',
  'parseFailure',
  'ioFailure',
  'usage',
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
 * @returns {RcfError}
 */
export function rcfError({ kind, message, documentId, filePath, field, rule }) {
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
  return out;
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
 * Render a list of errors plus a summary line. The summary line carries the
 * count and a pointer at --strict only when the caller is in default mode
 * (so the caller gets the hint exactly once and not after they used the
 * flag already).
 *
 * @param {RcfError[]} errors
 * @param {{ verbose?: boolean, strict?: boolean }} [opts]
 * @returns {string}
 */
export function formatErrors(errors, opts = {}) {
  if (errors.length === 0) return '';
  const verbose = Boolean(opts.verbose);
  const strict = Boolean(opts.strict);
  const lines = errors.map((e) => formatError(e, { verbose }));
  const count = errors.length;
  const noun = count === 1 ? 'error' : 'errors';
  const summary = strict
    ? `[error] ${count} ${noun} found; output not written.`
    : `[error] ${count} ${noun} found; output written with broken-section markers. Pass --strict to refuse the render.`;
  lines.push(summary);
  return lines.join('\n');
}
