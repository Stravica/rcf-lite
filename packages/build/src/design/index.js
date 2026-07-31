// Public surface for the design substage module
// (ui-design-gate-0.7.0-spec §5). CLI handler at `src/cli/design.js`.

export {
  firstBaselineDisagreement,
  missingDesignStageArtefacts,
  writeJourneyAdd,
  writeMarkComplete,
  writeNavSet,
  writeThemeA11ySet,
} from './writer.js';
