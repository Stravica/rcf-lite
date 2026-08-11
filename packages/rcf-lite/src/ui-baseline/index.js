// Public surface for the UI-baseline module (ui-design-gate-0.7.0
// spec §5.4, §6). The CLI handler lives at `src/cli/ui-baseline.js`;
// consumers reach the module through this barrel.

export {
  UI_BASELINE_DEFAULTS_V1,
  composeDefaults,
  deepGet,
  deepSet,
  isKnownBaselinePath,
} from './defaults.js';

export {
  baselineDesignDisagreement,
  composeUiBaselineRecord,
  nextUiBaselineId,
  preflightSeamOverrides,
  writeUiBaselineOptOut,
  writeUiBaselineRecord,
} from './manifest-writer.js';

export {
  normaliseNonInteractiveInput,
  runInteractiveSession,
} from './session.js';
