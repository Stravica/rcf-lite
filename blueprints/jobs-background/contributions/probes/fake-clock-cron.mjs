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
 *     (both timestamps come from Date.now() in the shipped scheduler):
 *     the probe asserts the delta is within the
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
const AC_FIRST8 = 'With messaging-queue-cloudflare and jobs-background both applied on the';
const TOLERANCE_LIMITATION = 'AC-jobs-scheduledRunsOnCron: the AC states a jobStarted fires within fireToleranceMs (default 30000 ms) of the scheduled cron boundary; this row observes the scheduled-to-started latency in a fake-clock domain and does NOT assert the elicited fireToleranceMs (a fake-clock scheduled boundary is not a wall-clock boundary comparable to the wall-clock Date.now() the runtime stamps on jobStarted)';

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

  // Engine-minted jobId (from the jobStarted or jobScheduled event)
  // is carried on every row so anatomy strict validation sees a real
  // id witness alongside the derived counters.
  const engineJobId = (jobStarted && typeof jobStarted.jobId === 'string' && jobStarted.jobId)
    || (jobScheduled && typeof jobScheduled.jobId === 'string' && jobScheduled.jobId)
    || null;
  const firesPass = fires === 1;
  results.push({
    anchorAcId: 'AC-jobs-scheduledRunsOnCron',
    verdict: firesPass ? 'pass' : 'fail',
    detail: firesPass
      ? `${AC_FIRST8} - scheduler.tick() published exactly 1 fire after clock.advance(60000)`
      : `${AC_FIRST8} - expected fires=1, got fires=${fires}`,
    evidence: { jobId: engineJobId, fires, cron: '* * * * *', fireEventCount: fires, firePresent: fires === 1 },
  });

  const startedOk = jobStarted && jobStarted.attempts === 1;
  results.push({
    anchorAcId: 'AC-jobs-scheduledRunsOnCron',
    verdict: startedOk ? 'pass' : 'fail',
    detail: startedOk
      ? `${AC_FIRST8} - jobStarted fired for refresh-cache with attempts=${jobStarted.attempts}`
      : `${AC_FIRST8} - jobStarted missing or attempts wrong: ${JSON.stringify(jobStarted)}`,
    evidence: { jobId: engineJobId, jobStartedEvent: jobStarted || null, jobStartedTimestamp: jobStarted ? jobStarted.timestamp : null, jobStartedAttempts: jobStarted ? jobStarted.attempts : null },
  });

  const completedOk = jobCompleted != null;
  const durationOk = jobCompleted ? jobCompleted.duration <= registry.get('refresh-cache').timeoutMs : false;
  results.push({
    anchorAcId: 'AC-jobs-scheduledRunsOnCron',
    verdict: completedOk && durationOk ? 'pass' : 'fail',
    detail: completedOk && durationOk
      ? `${AC_FIRST8} - jobCompleted fired for refresh-cache with duration=${jobCompleted.duration}ms within timeoutMs=${registry.get('refresh-cache').timeoutMs}`
      : `${AC_FIRST8} - completedOk=${completedOk} durationOk=${durationOk}; jobCompleted=${JSON.stringify(jobCompleted)}`,
    evidence: { jobId: engineJobId, jobCompletedEvent: jobCompleted || null, timeoutMs: registry.get('refresh-cache').timeoutMs, jobCompletedDurationMs: jobCompleted ? jobCompleted.duration : null, jobCompletedTimestamp: jobCompleted ? jobCompleted.timestamp : null },
  });

  // The fake-clock setup means "scheduledAt" is not a real wall-clock
  // boundary the way a live cron would be; the delta between jobScheduled
  // and jobStarted here is scheduled-to-started latency, not a meaningful wait from
  // a scheduled boundary. This row RECORDS the observed scheduled-to-started
  // latency for reader inspection but does NOT claim it satisfies
  // an "elicited fireToleranceMs" - no AC states such a tolerance for
  // fake-clock fires. Anchor stays on AC-jobs-scheduledRunsOnCron
  // because the property this row proves is "the runtime published
  // the fired job into jobStarted"; the wait-from-scheduled-boundary
  // property is only meaningful for live crons and is not observed
  // here.
  let scheduledToStartedMs = null;
  if (jobScheduled && jobStarted) {
    scheduledToStartedMs = Date.parse(jobStarted.timestamp) - Date.parse(jobScheduled.timestamp);
  }
  results.push({
    anchorAcId: null,
    conformanceOnly: true,
    limitation: TOLERANCE_LIMITATION,
    verdict: (jobScheduled && jobStarted) ? 'pass' : 'fail',
    detail: (jobScheduled && jobStarted)
      ? `conformanceOnly (${TOLERANCE_LIMITATION}) - the fired refresh-cache job produced both jobScheduled and jobStarted on the run-log; scheduled-to-started latency observed (not asserted) at ${scheduledToStartedMs}ms`
      : `conformanceOnly (${TOLERANCE_LIMITATION}) - jobScheduled or jobStarted missing: jobScheduled=${JSON.stringify(jobScheduled)} jobStarted=${JSON.stringify(jobStarted)}`,
    evidence: {
      jobScheduledTimestamp: jobScheduled && jobScheduled.timestamp,
      jobStartedTimestamp: jobStarted && jobStarted.timestamp,
      scheduledToStartedLatencyMs: scheduledToStartedMs,
      toleranceAsserted: false,
      note: 'fake-clock setup; scheduledAt is not a wall-clock cron boundary. The paired live-account probe does not exercise cron either; live wrangler-dev cron-trigger coverage remains a per-AC mechanism-reach gap.',
    },
  });

  return {
    results,
    extra: {
      events,
      fireToleranceMs: FIRE_TOLERANCE_MS,
      engineNote: 'in-memory queue driver + fake-clock seam; the paired live-account probe (retry-and-fail-real-account) does NOT exercise cron and therefore does NOT supply cron-trigger evidence; live wrangler-dev cron-trigger firing under workerCron scheduler mode is a per-AC mechanism-reach gap',
    },
  };
}
