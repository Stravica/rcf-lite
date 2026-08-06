# rcf-lite registry runbook (packaging consolidation)

**Status: SPEC. This runbook is executed at release time only, after the packaging migration PR has landed and Baz has given the go. Nothing in this document runs automatically.**

Companion to `docs/2026-08-06_packaging-consolidation-proposal.md`. Read that first for context and the ruling items.

## Scope

Steps for transitioning the RCF Lite suite from four separately-published packages (`@stravica-ai/rcf-build-lite`, `@stravica-ai/rcf-verify-lite`, `@stravica-ai/rcf-lite-core`, `@stravica-ai/rcf-schemas`) to a single published umbrella (`rcf-lite` or `@stravica-ai/rcf-lite` per ruling R1) with schemas remaining separately published (per the 2026-08-06 Baz ruling).

Legacy packages are DEPRECATED, never UNPUBLISHED — unpublish would break existing consumers' lockfiles.

## Preconditions

Every item must be true before running any step below.

- [ ] Packaging migration PR has landed on `main`; the umbrella package builds green, `pnpm test` passes, `rcf validate` passes, `rcf coverage --strict` passes.
- [ ] Ruling item R1 is resolved (name choice: `rcf-lite` vs `@stravica-ai/rcf-lite`). This runbook references `<UMBRELLA_NAME>` throughout; substitute the ruled name.
- [ ] Ruling item R5 is resolved (release-train sequencing: `0.7.1` packaging-only, or fold into `0.8.0`). This runbook references `<UMBRELLA_VERSION>`; substitute the ruled version.
- [ ] `@stravica-ai/rcf-schemas` pin in umbrella package.json is EXACT (`"0.4.2"`, not `"^0.4.2"`) and reviewed for this release. Doctrine per ruling on schemas standalone; every release deliberately reviews the pin. Record the review decision (hold or bump) in the release notes.
- [ ] Baz has given the go for the release.
- [ ] Baz-owned action complete: OIDC trusted-publisher binding on npm re-registered under `<UMBRELLA_NAME>` (see step 4 for the exact npm-side steps).

## Pre-publish acceptance (mandatory, per R2)

Runs before ANY tag push. Proves the tarball is self-contained.

```sh
# From the repo root, on the migration PR's merge commit on main.
cd packages/rcf-lite

# 1. Produce the tarball.
pnpm pack
# -> writes rcf-lite-<UMBRELLA_VERSION>.tgz  (or scoped: stravica-ai-rcf-lite-...)

# 2. Install into a clean temp dir.
SMOKE_DIR="$(mktemp -d)"
cd "$SMOKE_DIR"
npm init -y >/dev/null
npm install /path/to/packages/rcf-lite/rcf-lite-<UMBRELLA_VERSION>.tgz

# 3. CLI smoke — every command must succeed.
npx rcf --help
npx rcf --version
npx rcf verify --help
npx rcf-verify --help              # transition alias, must still work
npx rcf init                       # in this scratch dir; produces the RCF scaffold

# 4. Resolution smoke — no workspace symlinks may leak in.
find node_modules/rcf-lite -type l  # (or node_modules/@stravica-ai/rcf-lite) — MUST print nothing.
# Additionally, grep the installed tree for any `workspace:*` spec, which would prove pack-time
# resolution failed silently.
grep -r 'workspace:\*' node_modules/rcf-lite  # MUST print nothing.

# 5. Chain-integrity smoke on a scratch project.
mkdir smoke-project && cd smoke-project
npx rcf init
npx rcf validate
# Both must exit 0.
```

Any failure aborts the release. Fix in the umbrella source, re-pack, re-smoke.

## Registry actions

Sequential. Each step's success is a precondition for the next. Every step logs the exact command run and its output; the log is committed to the release notes.

### Step 1. Reserve the losing name (squat-block)

If ruling R1 chose one name, publish a placeholder squat-block on the OTHER at version `0.0.0`, pointing at the winner via README. This is a one-time action; a future clash can never happen.

If the winner is `rcf-lite`, publish `@stravica-ai/rcf-lite@0.0.0` as a placeholder pointing at `rcf-lite`, and vice versa. Placeholder package README:

> This package name is reserved. The RCF Lite tooling ships as `<UMBRELLA_NAME>`; install that instead. See https://github.com/Stravica/rcf-lite.

### Step 2. Publish the umbrella

Tag-driven under the updated `.github/workflows/publish.yml`. Verify the workflow file after the migration PR merged:

- Single tag prefix (`v*` or `rcf-lite-v*`).
- Single package dir (`packages/rcf-lite`).
- Publishes via `pnpm publish --provenance --access public` (public for either name; scoped-package first publish also needs `--access public` explicitly).
- Prerelease dist-tag on hyphenated versions preserved.

Tag and push:

```sh
# From repo root, on main at the release commit.
git tag <TAG_PREFIX>-v<UMBRELLA_VERSION>
git push origin <TAG_PREFIX>-v<UMBRELLA_VERSION>
```

Watch the workflow. On green:

```sh
npm view <UMBRELLA_NAME>
npm view <UMBRELLA_NAME> versions
npm view <UMBRELLA_NAME>@<UMBRELLA_VERSION> dist-tags
# 'latest' dist-tag must resolve to <UMBRELLA_VERSION>.
```

Post-publish install smoke from the real registry, in another temp dir:

```sh
SMOKE_DIR="$(mktemp -d)" && cd "$SMOKE_DIR"
npm init -y >/dev/null
npm install <UMBRELLA_NAME>
npx rcf --help
npx rcf verify --help
npx rcf-verify --help
npx rcf init
npx rcf validate
```

### Step 3. Deprecate the legacy packages

For each of the four legacy packages, publish a deprecation notice. Never unpublish.

```sh
npm deprecate '@stravica-ai/rcf-build-lite@*' \
  'This package has moved. Install <UMBRELLA_NAME> instead — it ships the same rcf CLI plus rcf verify, lockstep-versioned. See https://github.com/Stravica/rcf-lite#migration.'

npm deprecate '@stravica-ai/rcf-verify-lite@*' \
  'This package has moved. Install <UMBRELLA_NAME> instead — verify is now rcf verify (or rcf-verify alias) inside the single install. See https://github.com/Stravica/rcf-lite#migration.'

npm deprecate '@stravica-ai/rcf-lite-core@*' \
  'This package is now an internal workspace-only module of <UMBRELLA_NAME>. Direct installation is no longer supported. See https://github.com/Stravica/rcf-lite#migration.'
```

Note: `@stravica-ai/rcf-schemas` is NOT deprecated. Per the 2026-08-06 Baz ruling it remains a standalone published package (serves the whole RCF product line, not just Lite).

Verify each deprecation:

```sh
npm view @stravica-ai/rcf-build-lite deprecated
npm view @stravica-ai/rcf-verify-lite deprecated
npm view @stravica-ai/rcf-lite-core deprecated
```

Each MUST print the migration message.

### Step 4. Trusted-publisher (OIDC) binding — Baz-owned

The current OIDC binding is against workflow filename `publish.yml` on repo `Stravica/rcf-lite` and mapped to each of `@stravica-ai/rcf-build-lite`, `@stravica-ai/rcf-verify-lite`, `@stravica-ai/rcf-lite-core`. The re-registration is:

1. On https://www.npmjs.com/, under `<UMBRELLA_NAME>` -> Settings -> Trusted publishers, add a new publisher: GitHub Actions, repo `Stravica/rcf-lite`, workflow filename `publish.yml`, environment (none, matches current).
2. Keep the existing bindings on the legacy packages IN PLACE until at least one deprecation cycle passes. This is defensive: if a critical patch to a legacy version becomes necessary, the machinery still exists.
3. After a defined cooldown (recommend 90 days from deprecation), remove the OIDC bindings from the three legacy packages.

Step 4 is Baz-owned; Dave does not have registry admin.

### Step 5. Announce

Announcement channels:

- Repo README: pin the migration story at the top (already done by the migration PR).
- GitHub Discussions (`Stravica/rcf-lite`): pin a top-level post — title "rcf-lite: one install replaces four packages", body walks through the migration and the `rcf verify` subcommand.
- Release notes on the umbrella's release: reference the ruling docs (this runbook + the proposal), the deprecation notices, and the transition-grace `rcf-verify` alias.
- Downstream repos consumed by Dave / operator-facing tooling that pin the legacy packages: PR the version bumps.

### Step 6. Post-release checklist

After the release lands and the smokes pass:

- [ ] Legacy packages show deprecation notices via `npm view`.
- [ ] Umbrella package installs cleanly from public registry.
- [ ] `rcf`, `rcf verify`, `rcf-verify` all resolve in a fresh install.
- [ ] Announcement posted.
- [ ] `next-session.md` / relevant work items updated with the release outcome and the 90-day OIDC-cleanup calendar entry (per step 4).
- [ ] Downstream consumers PR'd for the version bump.

## Version-skew management (doctrine, standing rule)

The 2026-08-06 Baz ruling to keep `@stravica-ai/rcf-schemas` standalone re-introduces the version-skew surface the umbrella consolidation kills elsewhere. The mitigation is doctrine, not hygiene:

- Umbrella's `dependencies` pins `@stravica-ai/rcf-schemas` EXACTLY (`"0.4.2"`, not `"^0.4.2"`). Never a caret, never a tilde.
- Every umbrella release deliberately reviews the schemas pin: hold, or bump to a specific version, recording the decision in the release notes.
- Schemas bumps that require an umbrella update land as a coordinated pair: schemas released first (via its own repo's publish workflow), then umbrella bumps its exact-pin, tests, releases.
- The pack-verify step above (`grep -r 'workspace:\*'`) plus the post-install `rcf validate` on a scratch project catches a mis-pin at pre-publish time.

If this doctrine ever bends (a caret slips into the umbrella's schemas dep, or a release ships without the pin review), fix in the next release and note the incident in the release notes.

## Rollback

If the release smokes fail after step 2 has succeeded:

- DO NOT unpublish. Cut a patch release with the fix and publish that; consumers pick up the fix on next `npm install`.
- Update the legacy packages' deprecation message to point at the patch version if the patch changes the migration story.

If a legacy consumer critically needs a patch to a legacy version (unlikely once deprecation is out but possible):

- Cut the patch on a maintenance branch off the pre-migration tag (`build-v0.7.1`, `verify-v0.2.1`, etc).
- Publish under the legacy package name — the OIDC bindings on legacy packages remain in place per step 4 for the cooldown window.
- Update the deprecation notice to include the patch version as the last supported legacy release.

## References

- Proposal doc: `docs/2026-08-06_packaging-consolidation-proposal.md`.
- 2026-08-06 Baz ruling on schemas standalone: recorded in the proposal doc's "Considered and ruled" section; feed source is this dispatch's coordinator turn.
- 2026-08-06 Baz ratification of "one rcf CLI" (verify as subcommand): recorded as ruling item R3 in the proposal doc (RATIFIED).
- Ruling-sheet item 17 (R1: registry name choice): open, Baz-owned.
- Ruling-sheet item 11 (0.8.0 amendment: schemas scope-tag bump): interacts with schemas pin review at umbrella release time.
- Current publish workflow: `.github/workflows/publish.yml`.
- Current CI workflow: `.github/workflows/ci.yml`.
