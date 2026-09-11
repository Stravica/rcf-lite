/**
 * Event-secrecy probe.
 *
 * Schedules a job whose input carries a PII fixture body
 * { userId: 1234, ssn: '123-45-6789', email: 'test@example.com' }.
 * Drives the job through completion. Grep the serialised run-log event
 * stream for every PII literal; asserts zero matches.
 *
 * Anchors AC-jobs-eventSecrecy.
 */

import { createQueuePair } from '../../../../packages/rcf-lite/test/fixtures/infra-s3-and-queue/src/queue-driver.mjs';
import { createProducer, queueConfigFromEnv } from '../../../../packages/rcf-lite/test/fixtures/infra-s3-and-queue/src/producer.mjs';
import { createRunLog } from '../../../../packages/rcf-lite/test/fixtures/infra-s3-and-queue/src/job-run-log.mjs';
import { loadJobs, createJobsRuntime } from '../../../../packages/rcf-lite/test/fixtures/infra-s3-and-queue/src/jobs-runtime.mjs';
import { createScheduler, createFakeClock } from '../../../../packages/rcf-lite/test/fixtures/infra-s3-and-queue/src/scheduler.mjs';
import { PROJECT_ROOT } from './probe-utils.mjs';
import { resolve } from 'node:path';

const PII_LITERALS = ['1234', '123-45-6789', 'test@example.com'];
const EVENT_WHITELIST = new Set(['event', 'jobId', 'jobName', 'attempts', 'duration', 'timestamp', 'terminalErrorCode']);
const AC_FIRST8 = 'With SIMULATE_PII_IN_JOB_INPUT=true set on the shared sample-app fixture,';

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
  const runtime = createJobsRuntime({
    jobRegistry: registry,
    runLog,
    env: { SIMULATE_PII_IN_JOB_INPUT: 'true' },
  });
  const clock = createFakeClock(0);
  const scheduler = createScheduler({ mode: 'inProcess', clock, publisher: producer, runLog });
  scheduler.delayed({
    jobName: 'send-welcome-email',
    delayMs: 0,
    input: { userId: 1234, ssn: '123-45-6789', email: 'test@example.com' },
  });
  clock.advance(1);
  await scheduler.tick();
  await runtime.drain({ driverState: pair.state, maxIterations: 8 });
  const serialised = JSON.stringify(events);
  const leaks = PII_LITERALS.filter((lit) => serialised.includes(lit));
  const wrongKeys = new Set();
  for (const ev of events) {
    for (const k of Object.keys(ev)) {
      if (!EVENT_WHITELIST.has(k)) wrongKeys.add(k);
    }
  }
  const results = [];
  const pass = leaks.length === 0 && wrongKeys.size === 0 && events.some((e) => e.event === 'jobCompleted');
  results.push({
    anchorAcId: 'AC-jobs-eventSecrecy',
    verdict: pass ? 'pass' : 'fail',
    detail: pass
      ? `${AC_FIRST8} - no PII literal appears in the serialised run-log stream; every event carries only whitelisted keys ${JSON.stringify([...EVENT_WHITELIST])}; ${events.length} events recorded`
      : `${AC_FIRST8} - leaks=${JSON.stringify(leaks)}; wrongKeys=${JSON.stringify([...wrongKeys])}; events=${JSON.stringify(events)}`,
    evidence: {
      piiLiteralsChecked: PII_LITERALS,
      leakedLiterals: leaks,
      whitelist: [...EVENT_WHITELIST],
      nonWhitelistedKeys: [...wrongKeys],
      eventCount: events.length,
      jobCompletedFired: events.some((e) => e.event === 'jobCompleted'),
    },
  });
  return { results, extra: { events, piiLiterals: PII_LITERALS } };
}
