// Public surface for the browser-verify module
// (ui-design-gate-0.7.0-spec §8, §9). CLI handler at
// `src/cli/browser-verify.js`.

export {
  UI_INVARIANTS_V1,
  compareTopLevelStructure,
  foldInvariantsForRecord,
  runInvariantsForCapture,
} from './invariants.js';

export {
  runAuthSmokeChecks,
  shouldRunAuthSmokeChecks,
} from './auth-smoke.js';

export {
  aggregateVerdict,
  composeBrowserVerificationRecord,
  nextBrowserVerificationId,
  writeBrowserVerificationAck,
  writeBrowserVerificationRecord,
} from './manifest-writer.js';

export {
  composeOperatorSessionRecord,
  runAgentScreenshotCritique,
  stubBrowserDriver,
} from './runner.js';
