// Public surface for the intake module (spec §6).

export { classifyFidelity, FIDELITY_LEVELS } from './fidelity.js';
export { scanArtefactForFindings } from './validate.js';
export { runIntakePhases } from './orchestrator.js';
export { writeIntakeRecord, composeIntakeRecord, nextIntakeId } from './manifest-writer.js';
