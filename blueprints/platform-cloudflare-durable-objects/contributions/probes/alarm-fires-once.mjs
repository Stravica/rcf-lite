// Alarm-fires-once probe for platform-cloudflare-durable-objects v1.0.0.
//
// Sets an alarm on a SingleCellObject for the current clock time,
// drives alarm() once, asserts the doAlarmFired event fires with
// {objectName, scheduledTime}, and asserts a second alarm() call
// on the drained storage records scheduledTime null (the alarm was
// consumed by the first fire, matching the once-per-schedule
// contract). The clock is fixed to a fresh integer so the assertion
// is deterministic.
//
// anchorAcId: AC-33104-1.
// accountBound: false.

export const anchorAcId = 'AC-33104-1';
export const accountBound = false;

export default async function runProbe() {
  const { createInMemoryDoStorage } = await import('../../../../packages/rcf-lite/test/fixtures/cf-platform/src/do-storage.mjs');
  const { SingleCellObject } = await import('../../../../packages/rcf-lite/test/fixtures/cf-platform/src/do-single-cell.mjs');

  const events = [];
  const eventSink = (rec) => events.push(rec);
  const fixedNow = 1_800_000_000_000; // 2027-01 fixed instant, deterministic
  const clock = () => fixedNow;
  const storage = createInMemoryDoStorage({ backend: 'sql' });
  const cell = new SingleCellObject({ storage, eventSink, name: 'alarm-1', clock });

  const results = [];

  const { scheduledTime } = await cell.setAlarm(100);
  await cell.alarm();
  const firstFires = events.filter((e) => e.event === 'doAlarmFired');
  const stillPersisted = await storage.getAlarm();
  const firstOk =
    firstFires.length === 1 &&
    firstFires[0].objectName === 'alarm-1' &&
    firstFires[0].scheduledTime === scheduledTime &&
    stillPersisted === null;
  results.push({
    anchorAcId: 'AC-33104-1',
    verdict: firstOk ? 'pass' : 'fail',
    detail: firstOk
      ? `alarm() fired once; doAlarmFired carried objectName=alarm-1 scheduledTime=${scheduledTime}; storage.getAlarm() drained to null`
      : `alarm-fires-once fault: fires=${firstFires.length} record=${JSON.stringify(firstFires[0] ?? null)} storageAlarm=${stillPersisted}`,
  });

  // Second alarm() on the drained storage records scheduledTime null.
  events.length = 0;
  await cell.alarm();
  const secondFires = events.filter((e) => e.event === 'doAlarmFired');
  const secondOk =
    secondFires.length === 1 &&
    secondFires[0].scheduledTime === null;
  results.push({
    anchorAcId: 'AC-33104-1',
    verdict: secondOk ? 'pass' : 'fail',
    detail: secondOk
      ? `second alarm() on drained storage recorded scheduledTime null (no re-fire for the same schedule)`
      : `second-alarm behaviour mismatch: fires=${secondFires.length} record=${JSON.stringify(secondFires[0] ?? null)}`,
  });

  return { results };
}
