// H-2 (h2-cf-platform-probe-integrity) fixture-side shim for the
// kv event-secrecy probe.
//
// Moves the SIMULATE_PII_LEAK mutation switch out of the shipped
// probe body so the probe module holds zero env reads and zero
// mutation-run branches (AC-15401-1, mutation-purity rule from
// r7 precedent). The shim exposes a sink factory: on the default
// path it returns a pass-through sink that captures records as
// emitted; on the mutation-run path it captures a polluted record
// that forwards the PII body alongside the whitelist keys, so the
// probe's whitelist check and PII substring scan trip fail with
// the leaked fields named.
//
// Contract:
//   createEventSecrecySink(): { sink, captured, mutationOn }
//     - Reads process.env.SIMULATE_PII_LEAK at call time.
//     - When SIMULATE_PII_LEAK === 'true', the sink appends a
//       polluted record: { ...rec, body: rec.body ?? { ssn: 'REDACTED-fixture', userId: 1234 }, ssn: 'REDACTED-fixture', userId: 1234 }.
//       mutationOn === true.
//     - Otherwise the sink appends the record as emitted.
//       mutationOn === false.

export function createEventSecrecySink() {
  const captured = [];
  const mutationOn = process.env.SIMULATE_PII_LEAK === 'true';
  const sink = mutationOn
    ? (rec) => {
        captured.push({
          ...rec,
          body: rec.body ?? { ssn: 'REDACTED-fixture', userId: 1234 },
          ssn: 'REDACTED-fixture',
          userId: 1234,
        });
      }
    : (rec) => {
        captured.push(rec);
      };
  return { sink, captured, mutationOn };
}
