// Test-side preload for the FBS-231 round 6 refresh test (US-16103,
// AC-16103-4, decision 86), loaded by a child only, through
// NODE_OPTIONS=--import=<this file> beside test/_helpers/feedback-lock-pause.mjs
// (test/_helpers/feedback-lock-world.js, clockJump). It never replaces,
// fakes or drops the result of a call: it moves the child's wall clock
// (new Date() and Date.now()) only, the same seam as the pinned clock of the
// pause preloads. With RCF_TEST_CLOCK_BEHIND_MS unset it does nothing.
//
//   RCF_TEST_CLOCK_BEHIND_MS  the child's clock runs this many milliseconds
//                             behind the real clock ...
//   RCF_TEST_CLOCK_CATCH_UP   ... until this file exists: from the first
//                             clock read that finds it, the child's clock
//                             reads the real clock, so it jumps forward by
//                             RCF_TEST_CLOCK_BEHIND_MS at once, as if the
//                             child had been running that much longer.
//
// A command held at a pause point while the fixture writes the file wakes,
// when the fixture releases it, to a clock that has moved on by that much:
// everything it did before the pause it did that long ago.
import fs from 'node:fs';

const env = process.env;
const behindMs = Number(env.RCF_TEST_CLOCK_BEHIND_MS ?? 0);

if (behindMs > 0) {
  if (!Number.isFinite(behindMs)) throw new Error(`feedback-clock-jump: RCF_TEST_CLOCK_BEHIND_MS is not a number: ${env.RCF_TEST_CLOCK_BEHIND_MS}`);
  const RealDate = Date;
  const exists = fs.existsSync;
  const catchUp = env.RCF_TEST_CLOCK_CATCH_UP;
  let caughtUp = false;
  const lag = () => {
    if (!caughtUp && catchUp && exists(catchUp)) caughtUp = true;
    return caughtUp ? 0 : behindMs;
  };
  class LaggingDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(RealDate.now() - lag());
      else super(...args);
    }

    static now() { return RealDate.now() - lag(); }
  }
  globalThis.Date = LaggingDate;
}
