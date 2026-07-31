// Public surface for the baseline-AC injection module
// (elicitation-and-playbook-hardening-0.7.0-spec §5).

export {
  planSweep,
  applySweepDecisions,
  applyPendingBaselinesForUs,
} from './sweep.js';

export {
  writeOptOut,
  removeOptOut,
  nextOptOutId,
  isOptedOut,
  optOutMap,
} from './opt-out.js';

export {
  listOpenCandidates,
  usHasOpenCandidates,
  openCandidatesForUs,
} from './open-candidates.js';

export {
  fbsRefusalForOpenSweep,
  formatStage1RefusalMessage,
} from './gate.js';
