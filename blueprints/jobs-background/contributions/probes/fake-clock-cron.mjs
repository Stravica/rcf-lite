/**
 * Fake-clock cron probe (local-conformance flavour).
 *
 * Drives the fixture scheduler (inProcess mode with the fake-clock
 * seam) plus the in-memory queue seam plus the jobs-runtime through
 * one POSIX cron minute for the refresh-cache job. Asserts:
 *
 *   - one fire (`fires === 1`),
 *   - a jobStarted event fires on the injected run-log sink with
 *     jobName 'refresh-cache' and attempts === 1,
 *   - a jobCompleted event fires,
 *   - jobCompleted.duration <= registry.get('refresh-cache').timeoutMs,
 *   - a scheduled-to-started DELTA computed in one clock domain
 *     (both timestamps come from Date.now() after the scheduler fix
 *     of 2026-09-11): the probe asserts the delta is within the
 *     tolerance the row claims. When no tolerance can be defended,
 *     the row records the observed delta and reports it as the
 *     observed value; it never claims a tolerance it does not check.
 *
 * The queue driver is in-memory and the clock is fake, so this row
 * verifies LOCAL conformance of the jobs-runtime and scheduler
 * against the elicited contract. Real Cloudflare Queues cron-trigger
 * coverage is the paired real-account row; this row's AMBER status
 * (in the criterion-e evidence sidecar) is honest about the local
 * engine.
 *
 * Anchors AC-jobs-scheduledRunsOnCron.
 */

import { createQueuePair } from '../../../../packages/rcf-lite/test/fixtures/infra-s3-and-queue/src/queue-driver.mjs';
import { createProducer, queueConfigFromEnv } from '../../../../packages/rcf-lite/test/fixtures/infra-s3-and-queue/src/producer.mjs';
import { createRunLog } from '../../../../packages/rcf-lite/test/fixtures/infra-s3-and-queue/src/job-run-log.mjs';
import { loadJobs, createJobsRuntime } from '../../../../packages/rcf-lite/test/fixtures/infra-s3-and-queue/src/jobs-runtime.mjs';
import { createScheduler, createFakeClock } from '../../../../packages/rcf-lite/test/fixtures/infra-s3-and-queue/src/scheduler.mjs';
import { PROJECT_ROOT } from './probe-utils.mjs';
import { resolve } from 'node:path';

const FIRE_TOLERANCE_MS = 30000;

export default async function runProbe() {
  const cfg = queueConfigFromEnv();
  const pair = createQueuePair({ queueName: cfg.queueName, dlqName: cfg.dlqName, maxRetries: cfg.maxRetries });
  const events = [];
  const runLog = createRunLog({ upstream: (e) => events.push(e) });
  const producer = createProducer({
    binding: pair.producer,
    queueName: cfg.queueName,
    onEvent: () => {},
  });
  await producer.ready;
  const jobsDir = resolve(PROJECT_ROOT, 'packages/rcf-lite/test/fixtures/infra-s3-and-queue/jobs');
  const registry = await loadJobs(jobsDir);
  const runtime = createJobsRuntime({ jobRegistry: registry, runLog, env: { ...process.env } });
  const clock = createFakeClock(0);
  const scheduler = createScheduler({ mode: 'inProcess', clock, publisher: producer, runLog });
  scheduler.cron({ jobName: 'refresh-cache', cronString: '* * * * *', input: { cacheKey: 'demo' } });
  clock.advance(60000);
  const fires = await scheduler.tick();
  await runtime.drain({ driverState: pair.state, maxIterations: 16 });

  const jobScheduled = events.find((e) => e.event === 'jobScheduled' && e.jobName === 'refresh-cache');
  const jobStarted = events.find((e) => e.event === 'jobStarted' && e.jobName === 'refresh-cache');
  const jobCompleted = events.find((e) => e.event === 'jobCompleted' && e.jobName === 'refresh-cache');

  const results = [];

  const firesPass = fires === 1;
  results.push({
    anchorAcId: 'AC-jobs-scheduledRunsOnCron',
    verdict: firesPass ? 'pass' : 'fail',
    detail: firesPass
      ? `scheduler.tick() published exactly 1 fire after clock.advance(60000)`
      : `expected fires=1, got fires=${fires}`,
    evidence: { fires, cron: '* * * * *' },
  });

  const startedOk = jobStarted && jobStarted.attempts === 1;
  results.push({
    anchorAcId: 'AC-jobs-scheduledRunsOnCron',
    verdict: startedOk ? 'pass' : 'fail',
    detail: startedOk
      ? `jobStarted fired for refresh-cache with attempts=${jobStarted.attempts}`
      : `jobStarted missing or attempts wrong: ${JSON.stringify(jobStarted)}`,
    evidence: { jobStartedEvent: jobStarted || null },
  });

  const completedOk = jobCompleted != null;
  const durationOk = jobCompleted ? jobCompleted.duration <= registry.get('refresh-cache').timeoutMs : false;
  results.push({
    anchorAcId: 'AC-jobs-scheduledRunsOnCron',
    verdict: completedOk && durationOk ? 'pass' : 'fail',
    detail: completedOk && durationOk
      ? `jobCompleted fired for refresh-cache with duration=${jobCompleted.duration}ms within timeoutMs=${registry.get('refresh-cache').timeoutMs}`
      : `completedOk=${completedOk} durationOk=${durationOk}; jobCompleted=${JSON.stringify(jobCompleted)}`,
    evidence: { jobCompletedEvent: jobCompleted || null, timeoutMs: registry.get('refresh-cache').timeoutMs },
  });

  // Delta calculation in a single time domain (Date.now()); the
  // scheduler was updated 2026-09-11 to record scheduledAt via
  // Date.now(). This is the tolerance the row claims , assert it.
  let scheduledToStartedMs = null;
  let deltaWithinTolerance = false;
  if (jobScheduled && jobStarted) {
    scheduledToStartedMs = Date.parse(jobStarted.timestamp) - Date.parse(jobScheduled.timestamp);
    deltaWithinTolerance = Math.abs(scheduledToStartedMs) <= FIRE_TOLERANCE_MS;
  }
  results.push({
    anchorAcId: 'AC-jobs-scheduledRunsOnCron',
    verdict: (scheduledToStartedMs !== null && deltaWithinTolerance) ? 'pass' : 'fail',
    detail: scheduledToStartedMs === null
      ? `scheduled-to-started delta could not be computed: jobScheduled=${JSON.stringify(jobScheduled)} jobStarted=${JSON.stringify(jobStarted)}`
      : deltaWithinTolerance
        ? `scheduled-to-started delta ${scheduledToStartedMs}ms is within the elicited fireToleranceMs=${FIRE_TOLERANCE_MS}`
        : `scheduled-to-started delta ${scheduledToStartedMs}ms exceeds the elicited fireToleranceMs=${FIRE_TOLERANCE_MS}`,
    evidence: {
      jobScheduledTimestamp: jobScheduled && jobScheduled.timestamp,
      jobStartedTimestamp: jobStarted && jobStarted.timestamp,
      scheduledToStartedMs,
      fireToleranceMs: FIRE_TOLERANCE_MS,
      note: 'scheduler.mjs 2026-09-11 records scheduledAt via Date.now() so scheduled and started are in the same clock domain',
    },
  });

  return {
    results,
    extra: {
      events,
      fireToleranceMs: FIRE_TOLERANCE_MS,
      engineNote: 'in-memory queue driver + fake-clock seam; real Cloudflare Queues cron-trigger is the paired real-account row',
    },
  };
}
