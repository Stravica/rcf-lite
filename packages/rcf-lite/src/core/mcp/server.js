// MCP protocol lifecycle (Phase 7 §D3 / §D18). Pure protocol shell:
// initialize / initialized handshake, single version constant, ping,
// request dispatch to injected handlers, tolerated notifications,
// JSON-RPC error mapping, EOF shutdown. Knows nothing about RCF -
// domain behaviour arrives through the `handlers` map.
//
// Implemented against the pinned MCP revision 2025-11-25 (D3): the
// server responds to `initialize` with its own protocol version
// regardless of the client's requested version (the spec-sanctioned
// server behaviour under version negotiation - the server MUST respond
// with a version it supports; the client disconnects if incompatible).

import { attachLineReader, writeMessage } from './framing.js';

export const PROTOCOL_VERSION = '2025-11-25';

// JSON-RPC 2.0 error codes used by this server. -32002 is the MCP
// resources error for "resource not found" (2025-11-25 resources §
// error handling).
export const PARSE_ERROR = -32700;
export const INVALID_REQUEST = -32600;
export const METHOD_NOT_FOUND = -32601;
export const INVALID_PARAMS = -32602;
export const INTERNAL_ERROR = -32603;
export const RESOURCE_NOT_FOUND = -32002;

/**
 * Structured protocol error a handler can throw to produce a JSON-RPC
 * error response (as opposed to a tool execution error, which is a
 * successful result carrying `isError: true` - see map-errors.js).
 */
export class JsonRpcError extends Error {
  /**
   * @param {number} code
   * @param {string} message
   * @param {object} [data]
   */
  constructor(code, message, data) {
    super(message);
    this.name = 'JsonRpcError';
    this.code = code;
    this.data = data;
  }
}

/**
 * Create an MCP server core. Transport-free: `handleMessage` takes one
 * parsed JSON-RPC message and resolves to a response object (requests)
 * or null (notifications / ignorable traffic). Wire it to real streams
 * with `serveStreams`.
 *
 * @param {object} opts
 * @param {{name: string, version: string}} opts.serverInfo
 * @param {string} [opts.instructions]
 * @param {object} opts.capabilities - e.g. {tools: {}, resources: {}, prompts: {}}
 * @param {Record<string, (params: object) => Promise<object>>} opts.handlers
 *   - method name to handler; handler returns the JSON-RPC `result`
 * @param {{info: (line: string) => void, error: (line: string) => void}} [opts.log]
 * @returns {{
 *   handleMessage: (message: unknown) => Promise<object | null>,
 *   parseErrorResponse: () => object,
 *   initialized: () => boolean,
 * }}
 */
export function createMcpServer({ serverInfo, instructions, capabilities, handlers, log }) {
  const logger = log ?? { info: () => {}, error: () => {} };
  let receivedInitialized = false;

  const errorResponse = (id, code, message, data) => ({
    jsonrpc: '2.0',
    id: id ?? null,
    error: { code, message, ...(data !== undefined ? { data } : {}) },
  });

  const resultResponse = (id, result) => ({ jsonrpc: '2.0', id, result });

  /**
   * @param {unknown} message
   * @returns {Promise<object | null>}
   */
  async function handleMessage(message) {
    if (!message || typeof message !== 'object' || Array.isArray(message)) {
      return errorResponse(null, INVALID_REQUEST, 'Invalid request: expected a JSON-RPC object');
    }
    const msg = /** @type {{jsonrpc?: unknown, id?: unknown, method?: unknown, params?: unknown, result?: unknown, error?: unknown}} */ (message);

    // A message with no method but a result / error member is a
    // response. This server never sends requests, so any incoming
    // response is stale or misaddressed traffic - tolerate and ignore.
    if (msg.method === undefined && (msg.result !== undefined || msg.error !== undefined)) {
      return null;
    }

    if (typeof msg.method !== 'string' || msg.jsonrpc !== '2.0') {
      return errorResponse(
        validId(msg.id) ? msg.id : null,
        INVALID_REQUEST,
        'Invalid request: missing jsonrpc "2.0" or method',
      );
    }

    const isNotification = msg.id === undefined;
    const params = (msg.params && typeof msg.params === 'object') ? msg.params : {};

    if (isNotification) {
      // D18: unknown notifications (including notifications/cancelled)
      // are tolerated and ignored - every tool is synchronous and
      // fast, so cancellation has nothing to cancel.
      if (msg.method === 'notifications/initialized') {
        receivedInitialized = true;
        logger.info('client initialized');
      } else {
        logger.info(`ignoring notification ${msg.method}`);
      }
      return null;
    }

    if (!validId(msg.id)) {
      return errorResponse(null, INVALID_REQUEST, 'Invalid request: id must be a string or number');
    }
    const id = msg.id;

    if (msg.method === 'initialize') {
      return resultResponse(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities,
        serverInfo,
        ...(instructions ? { instructions } : {}),
      });
    }
    if (msg.method === 'ping') {
      return resultResponse(id, {});
    }

    const handler = handlers[msg.method];
    if (!handler) {
      return errorResponse(id, METHOD_NOT_FOUND, `Method not found: ${msg.method}`);
    }
    try {
      const result = await handler(params);
      return resultResponse(id, result);
    } catch (err) {
      if (err instanceof JsonRpcError) {
        return errorResponse(id, err.code, err.message, err.data);
      }
      // Unexpected failure: message to the client, full stack to
      // stderr only - never into model context (D10).
      const e = /** @type {Error} */ (err);
      logger.error(`[rcf mcp] unexpected failure in ${msg.method}: ${e.message}\n${e.stack ?? ''}`);
      return errorResponse(id, INTERNAL_ERROR, `Internal error: ${e.message}`);
    }
  }

  return {
    handleMessage,
    parseErrorResponse: () => errorResponse(null, PARSE_ERROR, 'Parse error'),
    initialized: () => receivedInitialized,
  };
}

function validId(id) {
  return typeof id === 'string' || (typeof id === 'number' && Number.isFinite(id));
}

/**
 * Wire a server core to real (or injected) streams. Messages are
 * processed strictly in arrival order over a serial promise chain so
 * responses hit stdout in request order and every fresh tree walk is
 * serialised (D14). Resolves 0 on input EOF - the 2025-11-25 stdio
 * termination path (client closes stdin; server exits).
 *
 * @param {ReturnType<typeof createMcpServer>} server
 * @param {object} opts
 * @param {NodeJS.ReadableStream} opts.input
 * @param {NodeJS.WritableStream} opts.output
 * @param {{info: (line: string) => void, error: (line: string) => void}} [opts.log]
 * @returns {{ done: Promise<number>, stop: () => void }}
 */
export function serveStreams(server, { input, output, log }) {
  const logger = log ?? { info: () => {}, error: () => {} };
  let queue = Promise.resolve();
  let resolveDone;
  const done = new Promise((resolve) => { resolveDone = resolve; });
  let stopped = false;

  const send = (response) => {
    if (stopped || !response) return;
    try {
      writeMessage(output, response);
    } catch (err) {
      // Embedded-newline refusal or a closed pipe. Log and drop the
      // message rather than corrupting the stdout framing.
      logger.error(`[rcf mcp] write failed: ${/** @type {Error} */ (err).message}`);
    }
  };

  const reader = attachLineReader(input, {
    onMessage: (message) => {
      queue = queue.then(async () => {
        if (stopped) return;
        const response = await server.handleMessage(message);
        send(response);
      });
    },
    onParseError: (rawLine) => {
      queue = queue.then(() => {
        if (stopped) return;
        logger.info(`parse error on input line (${rawLine.length} chars)`);
        send(server.parseErrorResponse());
      });
    },
    onEnd: () => {
      // Drain in-flight work, then resolve the exit code.
      queue = queue.then(() => {
        stop();
      });
    },
  });

  function stop() {
    if (stopped) return;
    stopped = true;
    reader.detach();
    resolveDone(0);
  }

  return { done, stop };
}
