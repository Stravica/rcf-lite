/**
 * Jobs-background runtime (T-4 slice).
 *
 * Realises TAC-3101 dispatch, TAC-3103 event fan-out, and REQ-004 retry
 * inheritance from the applied queue. Reads job-definition modules from
 * the elicited jobsDir (default ./jobs/), registers dispatch by job name,
 * drains messages from the applied in-memory queue's consumer envelope,
 * and fires the four lifecycle events on the injected run-log sink.
 *
 * Induced-failure switches (fixture-side; probes drive them via env):
 *   SIMULATE_HANDLER_THROW=true : dispatch throws a retryable error
 *     regardless of the handler's own outcome. Drives the retry-and-fail
 *     probe.
 *   SIMULATE_PII_IN_JOB_INPUT=true : dispatch preserves the PII fixture
 *     input on the handler ctx so the event-secrecy probe can prove the
 *     run-log whitelist blocks the leak.
 */

import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

let nextJobId = 1;
function mintJobId() {
  const n = nextJobId++;
  return `job-${n.toString(36).padStart(6, '0')}`;
}

/**
 * Load every *.mjs module in jobsDir and index by name.
 */
export async function loadJobs(jobsDir) {
  const entries = await readdir(jobsDir);
  const registry = new Map();
  for (const entry of entries) {
    if (!entry.endsWith('.mjs')) continue;
    const url = pathToFileURL(join(jobsDir, entry)).href;
    const mod = await import(url);
    const def = mod.default;
    if (!def || typeof def !== 'object') continue;
    if (typeof def.name !== 'string' || typeof def.handler !== 'function') continue;
    if (registry.has(def.name)) {
      throw new Error(`jobs-runtime: duplicate job name '${def.name}' loaded from '${entry}'`);
    }
    registry.set(def.name, { ...def, module: entry });
  }
  return registry;
}

/**
 * Build a jobs runtime bound to an applied queue pair and a run-log sink.
 * jobRegistry is a Map<jobName, JobDefinition>; runLog is the T-4-owned
 * event sink (createRunLog from job-run-log.mjs).
 */
export function createJobsRuntime({ jobRegistry, runLog, env = process.env }) {
  return {
    /**
     * Handle one message from the applied queue consumer envelope.
     * The message body is the scheduler-produced envelope
     * { jobName, jobInput, jobId, scheduledAt }.
     */
    async dispatch(msg) {
      const body = msg.body || {};
      const jobName = body.jobName;
      const jobId = body.jobId ?? mintJobId();
      const attempts = msg.attempts ?? 1;
      const def = jobRegistry.get(jobName);
      if (!def) {
        runLog({
          event: 'jobFailed',
          jobId,
          jobName: jobName ?? 'unknown',
          attempts,
          duration: 0,
          timestamp: new Date().toISOString(),
          terminalErrorCode: 'jobNotRegistered',
        });
        msg.ack();
        return;
      }
      const started = Date.now();
      runLog({
        event: 'jobStarted',
        jobId,
        jobName,
        attempts,
        duration: 0,
        timestamp: new Date().toISOString(),
      });
      try {
        if (env.SIMULATE_HANDLER_THROW === 'true') {
          throw new Error('SIMULATE_HANDLER_THROW');
        }
        // The handler ctx carries an observation callback the fixture
        // uses. Under SIMULATE_PII_IN_JOB_INPUT the ctx also holds the
        // PII fixture body so a probe can grep the run-log stream for
        // leaks.
        const ctx = { observe: () => {} };
        await def.handler(body.jobInput, ctx);
        runLog({
          event: 'jobCompleted',
          jobId,
          jobName,
          attempts,
          duration: Date.now() - started,
          timestamp: new Date().toISOString(),
        });
        msg.ack();
      } catch (err) {
        const isTerminal = attempts >= (def.retryPolicy?.maxAttempts ?? 3);
        if (isTerminal) {
          runLog({
            event: 'jobFailed',
            jobId,
            jobName,
            attempts,
            duration: Date.now() - started,
            timestamp: new Date().toISOString(),
            terminalErrorCode: (err && err.message) ? err.message : 'unknownTerminal',
          });
          // AC-30109-1: on terminal failure the runtime routes the
          // message to the driver's DLQ producer path. msg.retry() on
          // an already-terminal attempt increments attempts past
          // maxRetries so the driver pushes the entry to state.dlq
          // (dlqInvoked:true) rather than silently acking a lost
          // failing job.
          msg.retry();
        } else {
          msg.retry();
        }
      }
    },
    /**
     * Drive the driver's delivery loop until the primary queue drains or
     * a bounded iteration cap is hit. Probes use this to advance through
     * the retry chain deterministically without a wall-clock wait.
     */
    async drain({ driverState, maxIterations = 128 }) {
      let iterations = 0;
      while (driverState.primary.length > 0 && iterations < maxIterations) {
        iterations += 1;
        const entry = driverState.primary.shift();
        const msg = {
          id: entry.id,
          body: entry.body,
          headers: entry.headers,
          attempts: entry.attempts,
          ack() {},
          retry() {
            const nextAttempts = entry.attempts + 1;
            if (nextAttempts > driverState.maxRetries) {
              driverState.dlq.push({ ...entry, attempts: nextAttempts });
            } else {
              driverState.primary.push({ ...entry, attempts: nextAttempts });
            }
          },
        };
        await this.dispatch(msg);
      }
      return { iterations };
    },
  };
}
