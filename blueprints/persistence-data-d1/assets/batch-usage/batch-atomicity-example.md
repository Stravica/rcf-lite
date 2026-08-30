# Batch atomicity in the D1 facade

D1 does not expose explicit BEGIN / COMMIT to the Worker binding. `db.batch([...])` is the vendor's atomicity primitive for multi-statement writes: the vendor's contract states that a mid-batch failure aborts and rolls back the entire sequence. This asset shows the shape a facade verb takes when its domain contract requires two or more statements to land as one unit (AC-13105-1, AC-13105-2).

## Verb shape

```javascript
// src/store/entityBVerbs.js
// A verb whose domain contract requires insertA + insertB + auditEntry
// to land as one unit, or none.

export function entityBVerbs(db, onEvent) {
  return {
    async createEntityBWithAudit({
      entityAId,
      entityBId,
      payload,
      auditActor,
      now,
    }) {
      const batch = [
        db
          .prepare(
            'INSERT INTO entityB (id, entityAId, payload, createdAt) VALUES (?, ?, ?, ?)'
          )
          .bind(entityBId, entityAId, payload, now),
        db
          .prepare(
            'UPDATE entityA SET updatedAt = ? WHERE id = ?'
          )
          .bind(now, entityAId),
        db
          .prepare(
            'INSERT INTO auditEntry (id, actor, action, targetId, at) VALUES (?, ?, ?, ?, ?)'
          )
          .bind(crypto.randomUUID(), auditActor, 'entityBCreated', entityBId, now),
      ];

      try {
        const results = await db.batch(batch);
        return { entityBId };
      } catch (err) {
        onEvent({
          event: 'queryFailed',
          ts: new Date().toISOString(),
          verb: 'createEntityBWithAudit',
          code: err.cause?.code ?? 'unknown',
        });
        throw err;
      }
    },
  };
}
```

Notes:

- Every statement in the batch is a prepared statement authored inside the verb. The static SQL literals live in the verb body; values reach D1 only through `bind`. The prepared-statement discipline holds inside the batch as it does for single-statement verbs.
- The verb does not chain sequential `db.prepare(...).run()` calls under an application-side try-catch to fake atomicity. The vendor's batch primitive is the only shape that gives the atomicity guarantee. AC-13105-1 verifies this by inspection.
- On any statement in the batch failing, D1 rolls the sequence back (the vendor's contract); the verb rethrows without surfacing any partial state to the caller. AC-13105-2 exercises this against a local D1 primed to violate a UNIQUE constraint on the second statement.

## What batch is not

Not a cross-verb transaction. `batch()` is atomic across the statements in one call. Two independent facade verbs called sequentially by a consumer are NOT one transaction; the facade does not expose a begin/commit primitive because D1 does not support one on the Worker binding. AC-13105-3 verifies this by inspection.

Not a way to fake atomicity around a computed decision. A workflow that reads with `first()`, computes something, then writes-if-condition is not atomic; a concurrent Worker request can change the read's result between the read and the write. Push the condition into the SQL (an `INSERT ... WHERE NOT EXISTS`, an `UPDATE ... WHERE version = ?`, an optimistic-lock pattern) so the whole decision lands in one batched statement.

Not the only shape for a single-statement write. Single-statement writes commit as their own transaction naturally (SQLite's default autocommit); use `db.prepare(...).run()` directly for those verbs. Batch is reserved for the multi-statement-atomic case; using batch for a one-statement write is harmless but adds a wrapper the verb does not need.

## Query-count budget

D1's queries-per-Worker-invocation limit (currently 1000 on Paid, 50 on Free per the vendor's currently published limits) counts statements inside batches as individual queries. A verb whose batch grows past a few dozen statements is a design smell; break the domain contract into smaller atomic units, or reconsider whether the contract truly needs cross-statement atomicity.
