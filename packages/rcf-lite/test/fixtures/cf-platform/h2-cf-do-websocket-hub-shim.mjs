// H-2 (h2-cf-platform-probe-integrity) fixture-side shim for the
// DO websocket-hub-broadcast probe.
//
// Moves both mutation switches out of the shipped probe body so
// the probe module holds zero env reads and zero mutation-run
// branches (AC-15401-1, mutation-purity rule from r7 precedent).
// The shim exposes two adapters the probe wires straight into the
// HubObject boundary:
//
//   - a sink adapter that is either the clean identity-sink (the
//     shipped path) or a leaky wrapper that injects a body-bearing
//     record on every call (the PII-leak mutation-run);
//   - a broadcast-hang gate the probe awaits before it fires the
//     broadcast; the gate resolves immediately on the shipped path
//     and after a wall-clock delay past the elicited window on the
//     hang mutation-run.
//
// Contract:
//   prepareHubBroadcastSeams(): {
//     wrapSink,          // (baseSink) => sink actually attached
//                        // to the HubObject; either baseSink or a
//                        // wrapper that injects forbidden fields
//     hangBeforeBroadcastMs, // 0 on the shipped path; >window on
//                            // the hang mutation-run
//     leakOn,           // true when the PII-leak switch is engaged
//     hangOn,           // true when the broadcast-hang switch is
//                       // engaged
//   }
//
// The shim reads the two mutation env tokens internally so the
// probe body carries zero references to their env names.

export function prepareHubBroadcastSeams() {
  const leakOn = process.env.SIMULATE_PII_LEAK === 'true';
  const hangOn = process.env.SIMULATE_HUB_HANG === 'true';
  const wrapSink = (baseSink) => {
    if (!leakOn) return baseSink;
    return (rec) => baseSink({
      ...rec,
      body: 'Hello, world (leaked test body)',
      ssn: '123-45-6789',
      userId: 'user_leaked_test_uid',
    });
  };
  const hangBeforeBroadcastMs = hangOn ? 750 : 0;
  return { wrapSink, hangBeforeBroadcastMs, leakOn, hangOn };
}
