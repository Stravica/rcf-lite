// Newline-delimited JSON-RPC framing over injectable streams (Phase 7
// §D2). stdio transport rules per the pinned MCP revision 2025-11-25:
// messages are individual JSON-RPC objects, delimited by newlines,
// UTF-8, and MUST NOT contain embedded newlines. The read side buffers
// chunks, tolerates blank lines and surfaces parse failures to the
// caller (the server maps them to JSON-RPC -32700). The write side
// serialises to a single line and refuses embedded newlines.

import { StringDecoder } from 'node:string_decoder';

/**
 * Attach a line-buffered JSON reader to a Readable stream.
 *
 * @param {NodeJS.ReadableStream} stream
 * @param {object} handlers
 * @param {(message: object) => void} handlers.onMessage - parsed JSON value per line
 * @param {(rawLine: string, err: Error) => void} [handlers.onParseError]
 * @param {() => void} [handlers.onEnd] - stream EOF
 * @returns {{ detach: () => void }}
 */
export function attachLineReader(stream, { onMessage, onParseError, onEnd }) {
  let buffer = '';
  // StringDecoder holds back partial multibyte sequences across chunk
  // boundaries - a raw per-chunk toString would garble split UTF-8.
  const decoder = new StringDecoder('utf8');

  const handleChunk = (chunk) => {
    buffer += typeof chunk === 'string' ? chunk : decoder.write(chunk);
    let idx = buffer.indexOf('\n');
    while (idx >= 0) {
      const rawLine = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 1);
      emitLine(rawLine);
      idx = buffer.indexOf('\n');
    }
  };

  const handleEnd = () => {
    buffer += decoder.end();
    // A trailing unterminated line is still a message (the peer may
    // close without a final newline).
    if (buffer.length > 0) {
      const rawLine = buffer;
      buffer = '';
      emitLine(rawLine);
    }
    if (onEnd) onEnd();
  };

  const emitLine = (rawLine) => {
    // Tolerate CRLF peers and blank keep-alive lines.
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    if (line.trim().length === 0) return;
    let message;
    try {
      message = JSON.parse(line);
    } catch (err) {
      if (onParseError) onParseError(line, /** @type {Error} */ (err));
      return;
    }
    onMessage(message);
  };

  stream.on('data', handleChunk);
  stream.on('end', handleEnd);

  return {
    detach: () => {
      stream.off('data', handleChunk);
      stream.off('end', handleEnd);
    },
  };
}

/**
 * Serialise one JSON-RPC message to a single line. Throws on embedded
 * newlines: JSON.stringify escapes newline characters inside string
 * values, so a raw newline in the serialised form can only mean a
 * programming error upstream - refusing is the D2 discipline.
 *
 * @param {object} message
 * @returns {string} single-line JSON, no trailing newline
 */
export function serialiseMessage(message) {
  const line = JSON.stringify(message);
  if (typeof line !== 'string') {
    throw new TypeError('serialiseMessage: message did not serialise to JSON');
  }
  if (line.includes('\n') || line.includes('\r')) {
    throw new TypeError('serialiseMessage: refusing embedded newline in MCP message');
  }
  return line;
}

/**
 * Write one message to a Writable stream, newline-terminated.
 *
 * @param {NodeJS.WritableStream} stream
 * @param {object} message
 */
export function writeMessage(stream, message) {
  stream.write(`${serialiseMessage(message)}\n`);
}
