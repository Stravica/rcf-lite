/**
 * Jobs-background scheduler (jobs-background fixture slice).
 *
 * Realises TAC-3102. Ships the inProcess mode (a Node clock-driven
 * scheduler); workerCron and external modes are documented shipping-
 * shape alternatives that live outside this fixture. The clock is
 * INJECTED as a { now, advance } seam so probes drive fake-clock cron
 * fires deterministically without a wall-clock wait; a real-project
 * inProcess scheduler passes the system clock ({ now: Date.now, advance
 * is a no-op }) and uses setInterval instead of manual advance.
 *
 * The scheduler publishes messages to the applied queue via the
 * messaging-queue producer facade. Each fire produces a message body
 * { jobName, jobInput, jobId, scheduledAt } that the jobs runtime
 * consumes.
 */

let nextJobId = 1;
function mintJobId() {
  const n = nextJobId++;
  return `job-${n.toString(36).padStart(6, '0')}`;
}

/**
 * Very small POSIX cron parser sufficient for the fixture's two toy
 * jobs. Supports the every-minute pattern (five asterisks separated by
 * single spaces) and the step-form every-N-minutes pattern (asterisk
 * slash N in the minute field, four asterisks after it) to keep the
 * seam legible; a production project brings a full cron parser
 * (cron-parser, cronx). The
 * fixture's parser is limited by design: the shipped facade is portable
 * and this fixture just proves the seam works.
 */
function parseCron(cronString) {
  const parts = cronString.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error(`fixture cron parser: unsupported cron '${cronString}'`);
  const minuteField = parts[0];
  if (minuteField === '*') return { everyMinutes: 1 };
  const stepMatch = /^\*\/(\d+)$/.exec(minuteField);
  if (stepMatch) return { everyMinutes: Number.parseInt(stepMatch[1], 10) };
  throw new Error(`fixture cron parser: unsupported cron minute field '${minuteField}'`);
}

/**
 * Build a scheduler bound to a producer facade (publishes to the applied
 * queue) and a run-log sink (fires jobScheduled records).
 */
export function createScheduler({ mode = 'inProcess', clock, publisher, runLog }) {
  if (mode !== 'inProcess') {
    throw new Error(`fixture scheduler only ships inProcess mode; got '${mode}'`);
  }
  if (!clock || typeof clock.now !== 'function') {
    throw new Error('scheduler requires an injected clock with .now()');
  }
  const schedules = [];
  return {
    /**
     * Register a cron-scheduled job.
     */
    cron({ jobName, cronString, input = {} }) {
      const spec = parseCron(cronString);
      schedules.push({
        kind: 'cron',
        jobName,
        input,
        everyMinutes: spec.everyMinutes,
        lastFireMinute: Math.floor(clock.now() / 60000),
      });
    },
    /**
     * Register a one-shot delayed job.
     */
    delayed({ jobName, delayMs, input = {} }) {
      schedules.push({
        kind: 'delayed',
        jobName,
        input,
        fireAtMs: clock.now() + delayMs,
      });
    },
    /**
     * Advance the fake clock and publish any fires that come due. Returns
     * the count of publishes. Probes call this to drive the scheduler
     * deterministically.
     */
    async tick() {
      const nowMs = clock.now();
      const nowMinute = Math.floor(nowMs / 60000);
      let fires = 0;
      for (const s of schedules) {
        if (s.kind === 'cron') {
          const minutesSince = nowMinute - s.lastFireMinute;
          if (minutesSince >= s.everyMinutes) {
            await publishOne(s, nowMs);
            s.lastFireMinute = nowMinute;
            fires += 1;
          }
        } else if (s.kind === 'delayed') {
          if (!s.fired && nowMs >= s.fireAtMs) {
            await publishOne(s, nowMs);
            s.fired = true;
            fires += 1;
          }
        }
      }
      return fires;
      async function publishOne(schedule, _ms) {
        // Record scheduledAt from the SAME time domain as the runtime's
        // jobStarted timestamp (Date.now()) so the scheduled-to-started
        // delta is a meaningful tolerance in one clock. The fake clock
        // still drives WHEN a cron fires; only the recorded ISO
        // timestamp shifts to the runtime's domain.
        const jobId = mintJobId();
        const scheduledAt = new Date().toISOString();
        const body = { jobName: schedule.jobName, jobInput: schedule.input, jobId, scheduledAt };
        await publisher.publish(body);
        if (typeof runLog === 'function') {
          runLog({
            event: 'jobScheduled',
            jobId,
            jobName: schedule.jobName,
            attempts: 0,
            duration: 0,
            timestamp: scheduledAt,
          });
        }
      }
    },
    /** Snapshot schedules; probes read this for assertions. */
    inspect() {
      return schedules.map((s) => ({ ...s }));
    },
  };
}

/**
 * Build a fake-clock seam. Probes drive advance(ms) to fire cron.
 */
export function createFakeClock(startMs = 0) {
  let ms = startMs;
  return {
    now() { return ms; },
    advance(deltaMs) { ms += deltaMs; return ms; },
    set(v) { ms = v; },
  };
}
