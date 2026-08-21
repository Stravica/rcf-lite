# Why the checkpoint-then-copy path works, and when to prefer online-backup

## The setup

Under SQLite in WAL mode (ADR-601's default posture), committed writes land in a write-ahead log file (`<db>-wal`) and are periodically checkpointed into the main database file. Readers see committed writes across both the main file and the WAL; a bare `cp` of the main file captures only the pre-checkpoint state and can miss recent committed writes.

## Why the checkpoint fixes it

`PRAGMA wal_checkpoint(TRUNCATE)` forces every committed WAL page into the main file and truncates the WAL. After the checkpoint, the main file alone holds every committed write as of the checkpoint moment; a subsequent `cp` captures a consistent snapshot as of that moment. Writers on the source connection stay available: writes committed after the checkpoint land in a new WAL segment and are outside the artifact (which is the intended semantics: the artifact is a snapshot as of the checkpoint, not as of the `cp` completion).

## Why online-backup is still preferred

Two properties online-backup gives that checkpoint-then-copy does not:

- **Streaming rather than dual-storage.** The online-backup API streams pages to the destination without materialising the main file at a specific moment; for a large store, checkpointing everything into the main file at once is an operator-visible I/O spike.
- **No writer blocking on the checkpoint call.** `PRAGMA wal_checkpoint(TRUNCATE)` waits for readers to release the WAL; on a busy store this can pause the writer for the duration of the wait. Online-backup does not have this pause.

For rcf-lite-tier stores (small working sets, one host, human-scale write rate) the difference is not operator-visible and either path is defensible. Bindings that expose online-backup cleanly (node:sqlite, better-sqlite3) should use it; bindings that don't (older builds, unusual environments) use checkpoint-then-copy without apology.

## What breaks if you skip the checkpoint

A bare `cp` of a WAL-mode SQLite file without checkpointing produces an artifact that is missing every committed write in the WAL at copy time. On restore the missing writes are gone. This is the failure mode ADR-605's alternatives paragraph refers to: the operator sees a backup file that opens cleanly and reports the right schema version but is missing an unpredictable tail of recent writes. The runner never takes this path; the checkpoint-then-copy path in `sqlite-file-copy.md` is the fallback the runner uses when online-backup is not available.
