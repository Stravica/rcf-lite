# First-deploy bootstrap versus steady-state upload

The blueprint's ship path (`wrangler versions upload` on every merge, `wrangler versions deploy <versionId>` on operator-triggered promote) works only against a Worker that already exists on the vendor. A fresh Worker has to be bootstrapped once with a different verb. This asset documents both flows.

## Why the distinction exists

The vendor refuses `wrangler versions upload` against a Worker that has not been deployed at least once:

```
You cannot upload a new version of a Worker that does not yet exist.
Please run the 'deploy' command first.
```

The vendor also refuses `wrangler secret put <NAME>` against a Worker that does not yet exist:

```
This Worker does not exist yet, so secrets cannot be set in advance
with 'wrangler secret put'.
```

And the vendor refuses `wrangler deploy` when the Worker code references secret bindings that have not been set:

```
The following required secrets have not been set: <NAME>, <NAME>, ...
```

The three refusals compose into one bootstrap constraint: the FIRST deploy has to (a) create the Worker, (b) set every referenced secret in the same act. Only `wrangler deploy --secrets-file <path>` satisfies both.

## The bootstrap flow (once per Worker)

Run this once, from an operator machine with the vendor credentials in the environment. The secrets file is a temp file in a directory the repo ignores; it must not touch the working tree and must not survive the run.

```bash
# 1. Compose a temp secrets file. Sourced from the project's secrets
#    contract (see the security-secrets-management blueprint or the
#    equivalent project-authored pipeline). NO plaintext in the shell
#    history; use a here-doc into a temp path outside the repo.
TMP_SECRETS="$(mktemp -t bootstrap-secrets.XXXXXX.json)"
trap 'rm -f "$TMP_SECRETS"' EXIT

# 2. Write the JSON object of secret NAME -> VALUE the Worker needs.
#    The value strings are resolved from the secrets contract; this
#    example shows the shape, not the values.
cat > "$TMP_SECRETS" <<'JSON'
{
  "<SECRET_NAME_1>": "<value-from-secrets-contract>",
  "<SECRET_NAME_2>": "<value-from-secrets-contract>"
}
JSON

# 3. First deploy: creates the Worker on the vendor AND sets every
#    secret in one atomic act.
wrangler deploy --secrets-file "$TMP_SECRETS"

# 4. The trap removes the temp file. Verify it's gone.
[ ! -f "$TMP_SECRETS" ] || { echo "bootstrap-secrets leaked" >&2; exit 1; }
```

After the bootstrap deploy returns success, the Worker exists on the vendor, every referenced secret is set, and the steady-state ship path becomes available.

## The steady-state flow (every merge and every operator-triggered promote)

Once the Worker exists, the blueprint's ship path is the only one used:

```bash
# On every merge to main (build-and-upload workflow, see
# `ci-workflows/build-and-upload.yml.md`):
wrangler versions upload --preview-alias main

# On operator-triggered promote (promote workflow, see
# `ci-workflows/promote.yml.md`):
wrangler versions deploy <versionId>

# When a secret's value has to rotate, steady-state is `wrangler secret
# put <NAME>` invoked from a CI step whose environment has the new value
# from the secrets contract. No temp file, because the Worker already
# exists.
wrangler secret put <NAME>
```

## Reader notes

- The bootstrap flow is a one-time operator act. The blueprint's Deploy Adapter (TAC-1301) does NOT wrap it; the adapter's verbs are the steady-state surface. A project that automates bootstrap wraps this shell flow in a project-local script under `scripts/deploy/` and gates it behind an explicit operator invocation.
- The temp secrets file is the only shape wrangler 4.x accepts for pre-existence secret provisioning. Any alternative (`wrangler secret put` before `wrangler deploy`, an interactive prompt, environment-variable smuggling into `wrangler.toml`) either fails or leaks the value.
- The `--secrets-file` path must be outside the repo working tree, deleted on shell exit, and never emitted to stdout. The bootstrap shell above uses `mktemp` and a `trap` to enforce this.
- After bootstrap, the CI workflows never invoke `wrangler deploy`. Every version reaches the vendor via `wrangler versions upload` (which does NOT change the served version) and every production change rides `wrangler versions deploy <versionId>` from the promote workflow. Preserving this discipline is what keeps the promote-is-explicit invariant load-bearing.
- A project that superseded the default vendor (per ADR-1302) with a different target (Fly.io, Vercel, a hyperscaler's FaaS, a self-hosted target) authors an equivalent bootstrap flow against that vendor's own create-and-provision primitives; the WHEN (once per environment, before steady-state) stays; the WHAT (which CLI verb, which primitive) is vendor-specific.
