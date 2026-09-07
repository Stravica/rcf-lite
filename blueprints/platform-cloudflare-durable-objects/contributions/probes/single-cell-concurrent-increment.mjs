// Single-cell-concurrent-increment probe for platform-cloudflare-durable-objects v1.0.0.
//
// Fires two concurrent increment() calls against a SingleCellObject
// wired to the in-memory DO storage driver; asserts the FIFO queue
// serialises them and one observed the other's write via the
// witness field. Then reads the counter and asserts the sum.
//
// Also covers AC-33109-1 as an additional result on the same run
// (witness field present on every resolved increment).
//
// anchorAcId: AC-33102-1.
// accountBound: false.

export const anchorAcId = 'AC-33102-1';
export const accountBound = false;

export default async function runProbe() {
  const { createInMemoryDoStorage } = await import('../../../../packages/rcf-lite/test/fixtures/cf-platform/src/do-storage.mjs');
  const { SingleCellObject } = await import('../../../../packages/rcf-lite/test/fixtures/cf-platform/src/do-single-cell.mjs');

  const events = [];
  const eventSink = (rec) => events.push(rec);
  const storage = createInMemoryDoStorage({ backend: 'sql' });
  const cell = new SingleCellObject({ storage, eventSink, name: 'counter' });

  const results = [];

  // AC-33102-1: two concurrent increments serialise and read equals sum.
  const [a, b] = await Promise.all([cell.increment(1), cell.increment(1)]);
  const read = await cell.read();
  const counters = [a.counter, b.counter].sort((x, y) => x - y);
  const witnesses = [a.witness, b.witness].sort((x, y) => x - y);
  const serialised =
    counters[0] === 1 && counters[1] === 2 &&
    witnesses[0] === 0 && witnesses[1] === 1 &&
    read.counter === 2;
  results.push({
    anchorAcId: 'AC-33102-1',
    verdict: serialised ? 'pass' : 'fail',
    detail: serialised
      ? `two concurrent increments serialised in FIFO order; counters=[1,2] witnesses=[0,1] final read=2`
      : `serialisation fault: counters=${JSON.stringify([a.counter, b.counter])} witnesses=${JSON.stringify([a.witness, b.witness])} read=${read.counter}`,
  });

  // AC-33109-1: witness field is present on every resolved increment.
  const witnessOk = typeof a.witness === 'number' && typeof b.witness === 'number';
  results.push({
    anchorAcId: 'AC-33109-1',
    verdict: witnessOk ? 'pass' : 'fail',
    detail: witnessOk
      ? `every increment returned a numeric witness (a=${a.witness}, b=${b.witness})`
      : `witness field missing or non-numeric: a.witness=${a.witness} b.witness=${b.witness}`,
  });

  return { results };
}
