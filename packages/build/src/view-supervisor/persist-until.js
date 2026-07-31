// `rcf view start --persist-until <value>` argument parser (spec §9.2).
//
// The spec's sample invocation is `--persist-until 4h`; the shipping
// help text also names an ISO timestamp as the durable form. Accept
// both so the sample works AND cross-platform ISO timestamps still do.
//
// Duration grammar (minimal and documented):
//
//   <duration> := <hours> | <minutes> | <hours><minutes>
//   <hours>    := /^\d+h$/     e.g. `4h`, `24h`
//   <minutes>  := /^\d+m$/     e.g. `30m`, `90m`
//   combined   := /^\d+h\d+m$/ e.g. `2h30m`
//
// Anything else (`4hrs`, `4 h`, `PT4H`, `4:00`, an empty component like
// `0h`, or a plain integer with no unit) is a usage error: the parser
// returns `{ ok: false, error: <message> }` and the CLI exits 2 with
// that message plus the grammar. The old behaviour - `Date.parse('4h')`
// returning NaN, no persist timer set, supervisor runs forever - is
// what this parser exists to prevent.
//
// ISO parsing: any string `Date.parse` accepts as a finite timestamp
// passes. We deliberately do NOT restrict to a strict ISO-8601 subset
// - the shipping help text says "ISO timestamp" and operators reach
// for `date -u +%Y-%m-%dT%H:%M:%SZ` and similar; Date.parse handles
// them all. A past timestamp is accepted (the supervisor will unwind
// on the next event loop turn); the parser is a shape check, not a
// policy check.

const DURATION_RE = /^(?:(\d+)h)?(?:(\d+)m)?$/;

const GRAMMAR_HINT = 'expected a duration (e.g. `4h`, `30m`, `2h30m`) or an ISO timestamp (e.g. `2026-07-31T18:00:00Z`)';

/**
 * Parse a `--persist-until` argument into an ISO timestamp.
 *
 * @param {string} raw - argv value; must be a string
 * @param {object} [opts]
 * @param {number} [opts.nowMs] - injected clock for tests; defaults to Date.now()
 * @returns {{ ok: true, iso: string, deadlineMs: number, source: 'duration'|'iso' }
 *         | { ok: false, error: string }}
 */
export function parsePersistUntil(raw, opts = {}) {
  if (typeof raw !== 'string' || raw.length === 0) {
    return { ok: false, error: `--persist-until: missing value; ${GRAMMAR_HINT}` };
  }
  const nowMs = typeof opts.nowMs === 'number' ? opts.nowMs : Date.now();

  // Duration form. The regex `/^(?:(\d+)h)?(?:(\d+)m)?$/` also matches
  // the empty string; guard against that plus `0h` / `0m` / `0h0m`
  // (which the CLI accepting would make the supervisor unwind
  // immediately, arguably useless).
  const durationMatch = DURATION_RE.exec(raw);
  const hasHours = durationMatch && durationMatch[1] !== undefined;
  const hasMinutes = durationMatch && durationMatch[2] !== undefined;
  if (durationMatch && (hasHours || hasMinutes)) {
    const hours = hasHours ? Number.parseInt(durationMatch[1], 10) : 0;
    const minutes = hasMinutes ? Number.parseInt(durationMatch[2], 10) : 0;
    const ms = (hours * 60 * 60 * 1000) + (minutes * 60 * 1000);
    if (ms <= 0) {
      return { ok: false, error: `--persist-until: duration must be non-zero (got \`${raw}\`); ${GRAMMAR_HINT}` };
    }
    const deadlineMs = nowMs + ms;
    return { ok: true, iso: new Date(deadlineMs).toISOString(), deadlineMs, source: 'duration' };
  }

  // A bare digit run is a duration-shaped mistake (someone typed `4`
  // instead of `4h`). Date.parse would accept it as a year and the
  // supervisor would happily set a timer for the far past; that is
  // worse UX than a clean refusal.
  if (/^\d+$/.test(raw)) {
    return { ok: false, error: `--persist-until: bare integer \`${raw}\` has no unit; ${GRAMMAR_HINT}` };
  }

  // ISO form. Date.parse is loose (accepts a variety of shapes); we
  // only care that it lands on a finite timestamp. A partial ISO like
  // `2026` still parses; that is a policy question we leave to the
  // supervisor's timer semantics (a past deadline unwinds immediately,
  // which is a clearer failure than silent no-op).
  const parsedMs = Date.parse(raw);
  if (Number.isFinite(parsedMs)) {
    return { ok: true, iso: new Date(parsedMs).toISOString(), deadlineMs: parsedMs, source: 'iso' };
  }

  return { ok: false, error: `--persist-until: unrecognised value \`${raw}\`; ${GRAMMAR_HINT}` };
}
