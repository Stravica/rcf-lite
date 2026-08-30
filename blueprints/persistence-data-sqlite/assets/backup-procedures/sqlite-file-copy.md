# SQLite backup procedure (default engine, ADR-601 + ADR-605)

The backup runner (TAC-604) produces a self-contained artifact without downtime. Under SQLite in WAL mode (the default engine), two paths satisfy the AC-5108-1 downtime-free property; pick the one the project's SQLite binding supports cleanly.

## Path 1: online-backup API (preferred)

The SQLite online-backup API opens a second connection in backup mode and streams pages from the source to the destination file. Writers on the source connection stay available for the full duration; the copy is transactionally consistent at the point the API completes.

```javascript
// Inside TAC-604's backup implementation, using the node:sqlite binding.
import { DatabaseSync } from 'node:sqlite';

export async function backup(sourceDb, outputPath) {
  const dest = new DatabaseSync(outputPath);
  try {
    // Bindings vary in shape; the essence is 'open a backup handle from
    // source to dest and step it to completion'. node:sqlite exposes
    // sourceDb.backup(dest); some bindings require .step(-1) loops.
    await sourceDb.backup(dest);
    return {
      artifactPath: outputPath,
      completedAt: new Date().toISOString(),
    };
  } finally {
    dest.close();
  }
}
```

Emit the `backupCheckpoint` event on the store's event sink at completion (AC-5108-3), carrying `{ event: 'backupCheckpoint', ts, artifactPath, completedAt }`.

## Path 2: checkpoint-then-copy

For bindings that do not expose the online-backup API, a WAL checkpoint followed by a filesystem-level copy of the main file is a defensible fallback. The checkpoint flushes all committed WAL pages into the main file; the copy captures every committed write as of the checkpoint moment. Writers on the source connection stay available; concurrent writes after the checkpoint land in a new WAL segment and are not in the artifact (which is the intended semantics: the artifact is a snapshot as-of the checkpoint).

```javascript
// Inside TAC-604's backup implementation.
import { copyFile } from 'node:fs/promises';

export async function backup(sourceDb, sourcePath, outputPath) {
  sourceDb.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  await copyFile(sourcePath, outputPath);
  return {
    artifactPath: outputPath,
    completedAt: new Date().toISOString(),
  };
}
```

Emit the `backupCheckpoint` event as above.

## Recovery

Recovery is opening the artifact through the store facade against a compatible build:

```
cp backup.sqlite /path/to/deployed/store.sqlite
# restart the process; facade openStore({ path: '/path/to/deployed/store.sqlite' })
# runs, opened event fires, schemaVersion matches the artifact's version
```

The refuse-newer property (AC-5103-1) applies here: recovering a newer-than-build artifact under an older build fails at boot; the fix is to recover under a build at or ahead of the artifact's schema version.

## What this procedure is not

Not a logical dump. The artifact is a SQLite file, not a portable SQL script; a project that needs cross-engine restore layers a project-authored dump runner beside this one (see ADR-605's alternatives).

Not a replication story. Cross-region replication is engine-native (SQLite Litestream or the alternate engine ADR-601 is superseded to); the backup runner produces one artifact per invocation and does not orchestrate shipping.

Not a retention manager. The artifact filename and the delete-old-artifacts cadence are project concerns; the runner writes the artifact and emits the checkpoint event.
