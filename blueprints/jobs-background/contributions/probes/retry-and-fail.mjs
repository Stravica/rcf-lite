/**
 * Retry-and-fail probe.
 *
 * With SIMULATE_HANDLER_THROW=true on the shared fixture, the jobs-runtime
 * throws a retryable error on every dispatch. Schedules a one-shot job
 * with send-welcome-email's maxAttempts=3. Drives the driver's delivery
 * loop until the message either terminals or DLQs. Asserts three
 * jobStarted events with the same jobId and attempts 1, 2, 3 followed by
 * a terminal jobFailed with a terminalErrorCode.
 *
 * Anchors AC-jobs-retryOnHandlerFailure.
 */

import { createQueuePair } from '../../../../packages/rcf-lite/test/fixtures/infra-s3-and-queue/src/queue-driver.mjs';
import { createProducer, queueConfigFromEnv } from '../../../../packages/rcf-lite/test/fixtures/infra-s3-and-queue/src/producer.mjs';
import { createRunLog } from '../../../../packages/rcf-lite/test/fixtures/infra-s3-and-queue/src/job-run-log.mjs';
import { loadJobs, createJobsRuntime } from '../../../../packages/rcf-lite/test/fixtures/infra-s3-and-queue/src/jobs-runtime.mjs';
import { createScheduler, createFakeClock } from '../../../../packages/rcf-lite/test/fixtures/infra-s3-and-queue/src/scheduler.mjs';
import { PROJECT_ROOT } from './probe-utils.mjs';
import { resolve } from 'node:path';

const AC_FIRST8 = 'With SIMULATE_HANDLER_THROW=true set on the shared sample-app fixture,';

export default async function runProbe() {
  const cfg = queueConfigFromEnv();
  // maxRetries on the driver matches send-welcome-email.maxAttempts=3.
  const pair = createQueuePair({ queueName: cfg.queueName, dlqName: cfg.dlqName, maxRetries: 3 });
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
  const runtime = createJobsRuntime({
    jobRegistry: registry,
    runLog,
    env: { SIMULATE_HANDLER_THROW: 'true' },
  });
  const clock = createFakeClock(0);
  const scheduler = createScheduler({ mode: 'inProcess', clock, publisher: producer, runLog });
  scheduler.delayed({ jobName: 'send-welcome-email', delayMs: 0, input: { userId: 7, email: 'ok@example.com' } });
  clock.advance(1);
  await scheduler.tick();
  await runtime.drain({ driverState: pair.state, maxIterations: 32 });
  const jobStartedEvents = events.filter((e) => e.event === 'jobStarted' && e.jobName === 'send-welcome-email');
  const jobFailed = events.find((e) => e.event === 'jobFailed' && e.jobName === 'send-welcome-email');
  const attemptsSeq = jobStartedEvents.map((e) => e.attempts);
  const jobIds = new Set(jobStartedEvents.map((e) => e.jobId));
  const dlqInvoked = pair.state.dlq.length > 0;
  const results = [];
  const attemptsOk = attemptsSeq.length === 3 && attemptsSeq[0] === 1 && attemptsSeq[1] === 2 && attemptsSeq[2] === 3;
  const oneJobId = jobIds.size === 1;
  const failedOk = !!jobFailed && typeof jobFailed.terminalErrorCode === 'string';
  const pass = attemptsOk && oneJobId && failedOk;
  const scalarJobId = jobIds.size > 0 ? [...jobIds][0] : null;
  results.push({
    anchorAcId: 'AC-jobs-retryOnHandlerFailure',
    verdict: pass ? 'pass' : 'fail',
    detail: pass
      ? `${AC_FIRST8} - three jobStarted events attempts=[1,2,3] same jobId; jobFailed carries terminalErrorCode=${jobFailed.terminalErrorCode}`
      : `${AC_FIRST8} - attemptsSeq=${JSON.stringify(attemptsSeq)}; jobIds.size=${jobIds.size}; jobFailed=${JSON.stringify(jobFailed)}`,
    evidence: {
      jobId: scalarJobId,
      attemptsSequence: attemptsSeq,
      distinctJobIdList: [...jobIds],
      jobStartedCount: jobStartedEvents.length,
      terminalJobFailed: jobFailed || null,
      dlqInvoked,
    },
  });
  return { results, extra: { events, dlqInvoked, attemptsSeq } };
}
