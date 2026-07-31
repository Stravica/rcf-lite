// Public surface for the view-supervisor module (spec §9).

export {
  startDetached,
  stopDetached,
  statusOfDetached,
  runDetachedChild,
} from './supervisor.js';

export {
  readViewServerRecord,
  writeViewServerRecord,
  clearViewServerRecord,
  writePidFile,
  readPidFile,
  removePidFile,
  DEFAULT_PID_PATH,
  isPidAlive,
} from './manifest-writer.js';

export {
  supervisorLogPath,
  ensureLogDir,
  writeLogLine,
  readLogTail,
} from './logs.js';
