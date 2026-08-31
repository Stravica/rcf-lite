# D1 store facade module shape

The facade (TAC-1401) is one module that reads the D1 binding from the Worker `env`, exposes named domain verbs, issues every statement as a parameterised prepared statement, uses `db.batch([...])` for multi-statement atomicity, and emits structured lifecycle events on the injected sink. This asset shows the exact shape with a worked domain example.

## Module layout

```
src/store/
  facade.js          // this file: createStore + named verbs
  entityAVerbs.js    // named verbs partitioned by domain slice (optional)
  entityBVerbs.js
  sessionVerbs.js
  auditVerbs.js
```

The `facade.js` module is the ONLY file in the source tree that reads `env[BINDING_NAME]`. Every domain slice imports helpers from `facade.js` (the request-scoped `db` handle, the event emitter) and exports its named verbs; `facade.js` re-exports them into the store's public surface. A grep of the source tree for `env.<BINDING_NAME>` (or `env["<BINDING_NAME>"]`) returns exactly one match, and it is inside `facade.js`. AC-13101-1 is verified by that grep.

## `createStore` factory

```javascript
// src/store/facade.js
// The ONE module that reads the D1 binding.

let isolateFirstInvocation = true;

export function createStore({ env, bindingName, onEvent }) {
  const db = env[bindingName]; // The ONE binding read in the tree.
  if (!db) {
    throw new Error(`D1 binding '${bindingName}' not present on env`);
  }

  if (isolateFirstInvocation) {
    isolateFirstInvocation = false;
    onEvent({
      event: 'facadeReady',
      ts: new Date().toISOString(),
      bindingName,
      environment: env.ENVIRONMENT ?? 'unknown',
    });
  }

  return {
    // Named domain verbs (per AC-13101-2, no raw-query passthrough).
    ...entityAVerbs(db, onEvent),
    ...entityBVerbs(db, onEvent),
    ...sessionVerbs(db, onEvent),
    ...auditVerbs(db, onEvent),
  };
}
```

## Named domain verb (single-statement)

```javascript
// src/store/entityAVerbs.js
// Every SQL literal is static and authored here.

export function entityAVerbs(db, onEvent) {
  return {
    async findEntityAByName({ name }) {
      try {
        return await db
          .prepare('SELECT id, name, createdAt, updatedAt FROM entityA WHERE name = ?')
          .bind(name)
          .first();
      } catch (err) {
        onEvent({
          event: 'queryFailed',
          ts: new Date().toISOString(),
          verb: 'findEntityAByName',
          code: err.cause?.code ?? 'unknown',
        });
        throw err;
      }
    },

    async insertEntityA({ id, name, createdAt, updatedAt }) {
      try {
        return await db
          .prepare(
            'INSERT INTO entityA (id, name, createdAt, updatedAt) VALUES (?, ?, ?, ?)'
          )
          .bind(id, name, createdAt, updatedAt)
          .run();
      } catch (err) {
        onEvent({
          event: 'queryFailed',
          ts: new Date().toISOString(),
          verb: 'insertEntityA',
          code: err.cause?.code ?? 'unknown',
        });
        throw err;
      }
    },
  };
}
```

Notes:

- The SQL literal is a static string authored inside the verb. It does not embed values from consumer arguments; the values reach D1 only through `bind`. AC-13104-1 verifies this by grep.
- The verb's typed parameter list names the fields the SQL literal binds. It does not accept a `sql` or `query` string parameter. AC-13104-2 verifies this by inspection of the exported surface.
- The verb catches D1 errors, emits a `queryFailed` event carrying only metadata (the verb name, the D1 error code), and rethrows. The event payload never includes `name` or any bound value. ADR-1403's discipline is enforced at emit time.

## Named domain verb (multi-statement atomic write via batch)

See `assets/batch-usage/batch-atomicity-example.md` for the worked shape.

## What this asset is not

Not a runnable facade. The snippets above are the SHAPE; a project's own domain verbs are authored per the domain's actual tables. Types, error wrappers, and observability adapters are project decisions on top of the shape.

Not an ORM. Projects that reach for Drizzle or Kysely wire it inside the verb bodies and preserve the outward verb surface. The prepared-statement discipline (static SQL literals inside the verb, values only through `bind`) survives an ORM: most ORMs emit static SQL from typed queries at build time, and the AC-13104-1 grep still lands on static literals.

Not the ci-pipeline gate. TAC-1403's deploy-gate is a CI file, not a facade responsibility; the two surfaces meet only through the shared event-record shape.
