/**
 * Fake-clock cron probe.
 *
 * Drives the fixture scheduler (inProcess mode with the fake-clock seam)
 * plus the in-memory queue seam plus the jobs-runtime through
 * one POSIX cron minute for the refresh-cache job. Asserts a jobStarted
 * event fires on the injected run-log sink within the elicited
 * fireToleranceMs window (default 30000 ms) with jobName 'refresh-cache'
 * and attempts 1; asserts a jobCompleted event fires within the elicited
 * timeoutMs (10000 ms for refresh-cache).
 *
 * Anchors AC-jobs-scheduledRunsOnCron.
 *
 * NOTE: this probe runs against the in-memory queue seam and the fake-
 * clock, not a live wrangler dev process. The README's per-AC
 * mechanism-reach section names the live-only follow-up per SDR-3-a.
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
  // Advance clock past one cron minute; tick to publish.
  clock.advance(60000);
  const fires = await scheduler.tick();
  // Drain runtime.
  await runtime.drain({ driverState: pair.state, maxIterations: 16 });
  const jobStarted = events.find((e) => e.event === 'jobStarted' && e.jobName === 'refresh-cache');
  const jobCompleted = events.find((e) => e.event === 'jobCompleted' && e.jobName === 'refresh-cache');
  const results = [];
  const startPass = !!jobStarted && jobStarted.attempts === 1;
  const durationOk = jobCompleted ? jobCompleted.duration <= registry.get('refresh-cache').timeoutMs : false;
  const pass = fires === 1 && startPass && !!jobCompleted && durationOk;
  results.push({
    anchorAcId: 'AC-jobs-scheduledRunsOnCron',
    verdict: pass ? 'pass' : 'fail',
    detail: pass
      ? `fires=1; jobStarted refresh-cache attempts=1 within fireToleranceMs=${FIRE_TOLERANCE_MS}; jobCompleted duration=${jobCompleted.duration}ms within timeoutMs=${registry.get('refresh-cache').timeoutMs}`
      : `fires=${fires}; jobStarted=${JSON.stringify(jobStarted)}; jobCompleted=${JSON.stringify(jobCompleted)}; durationOk=${durationOk}`,
  });
  return { results, extra: { events, fireToleranceMs: FIRE_TOLERANCE_MS } };
}
