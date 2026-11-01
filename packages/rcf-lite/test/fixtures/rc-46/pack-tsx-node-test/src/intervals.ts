/**
 * Half-open interval maths: an interval [start, end) holds every point p
 * with start <= p < end. An interval whose end equals its start is empty
 * but well formed; one whose end is before its start is malformed.
 */

export interface Interval {
  readonly start: number;
  readonly end: number;
}

/** Throws a RangeError when the interval is malformed (non-finite bounds, or end before start). */
export function assertInterval(interval: Interval): void {
  const { start, end } = interval;
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    throw new RangeError(`interval bounds must be finite numbers, got [${start}, ${end})`);
  }
  if (end < start) {
    throw new RangeError(`interval end ${end} is before its start ${start}`);
  }
}

/** True when the two intervals share at least one point. Touching ends do not overlap. */
export function overlaps(a: Interval, b: Interval): boolean {
  if (a.start === a.end || b.start === b.end) return false;
  return a.start < b.end && b.start < a.end;
}

/**
 * Merge a list of intervals, in any order, into the smallest sorted list
 * of disjoint intervals covering the same points. Overlapping and
 * touching intervals combine into one; empty intervals are dropped.
 * Every input is checked first, so a malformed interval rejects the call.
 */
export function mergeIntervals(intervals: readonly Interval[]): Interval[] {
  for (const interval of intervals) {
    assertInterval(interval);
  }
  const sorted = intervals
    .filter((i) => i.end > i.start)
    .map((i) => ({ start: i.start, end: i.end }))
    .sort((x, y) => x.start - y.start || x.end - y.end);
  const merged: Interval[] = [];
  for (const next of sorted) {
    const last = merged[merged.length - 1];
    if (last && next.start <= last.end) {
      merged[merged.length - 1] = { start: last.start, end: Math.max(last.end, next.end) };
    } else {
      merged.push(next);
    }
  }
  return merged;
}
