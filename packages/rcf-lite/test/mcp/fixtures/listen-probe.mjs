// Preload probe for the AC-601-3 no-network-listener e2e. Loaded into the
// spawned server via `node --import`; instruments every API through which a
// Node process can open a network listener and writes a marker line to
// stderr if any of them is ever invoked. The e2e drives a full MCP session
// and asserts the marker never appears; a positive sanity leg asserts the
// probe DOES fire for a process that really listens.

import net from 'node:net';
import dgram from 'node:dgram';

const mark = (what) => {
  process.stderr.write(`LISTEN-PROBE: ${what} invoked\n`);
};

const origListen = net.Server.prototype.listen;
net.Server.prototype.listen = function patchedListen(...args) {
  // http.Server, https.Server and tls.Server all inherit from net.Server,
  // so one patch covers every TCP listener surface.
  mark('net.Server.listen');
  return origListen.apply(this, args);
};

const origBind = dgram.Socket.prototype.bind;
dgram.Socket.prototype.bind = function patchedBind(...args) {
  mark('dgram.Socket.bind');
  return origBind.apply(this, args);
};
