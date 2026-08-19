# Contributing to RCF Lite

Thanks for taking the time to contribute. This document covers how to get a working development setup, the one house rule that makes this repository unusual, and what we expect from a pull request.

**Current status:** the project is not accepting external code contributions yet. Bug reports and feature discussion via Issues are very welcome, and everything below describes the setup and conventions that will apply when code contributions open.

## Development setup

You need:

- Node.js >= 24
- pnpm 9

Then:

```sh
git clone https://github.com/Stravica/rcf-lite.git
cd rcf-lite
pnpm install
pnpm run vendor   # regenerates src/view/vendored/mermaid.min.js from the pinned dev dependency
pnpm test
```

The full test suite must pass before you open a pull request. There is no build step; the CLI runs directly from source (`pnpm rcf <verb>`).

### pnpm version discipline

CI runs pnpm 9. Local pnpm 9 keeps you in step with what the pipeline actually installs from, and there is one lockfile-shape concern that matters if you happen to have pnpm 11 or newer on your machine:

- Any override pins (`pnpm.overrides`) belong in the ROOT `package.json`. That is the location pnpm 9 reads them from.
- pnpm 11 introduced an alternative `overrides:` block inside `pnpm-workspace.yaml`. Do NOT put pins there. pnpm 9 does not read that location and CI will silently skip your override; if you put the same pin in both, pnpm 9 rejects the workspace file with a hard error on install.

If your local pnpm is newer than 9 and refuses to install because a dependency was published inside its minimum-release-age window, run once with `--config.minimum-release-age=0` and note it in your PR description. Do not commit a config change to weaken the guard globally.

## This repository runs on RCF

RCF Lite is developed using the methodology it implements. The umbrella package's own PRD, requirements, user stories, acceptance criteria, TAD and build queue live as JSON under [`rcf/`](./rcf), and they are not decoration: they are the source of truth for what the tool does.

**Schemas dependency doctrine.** `@stravica-ai/rcf-schemas` is an external, exact-pinned dependency (`"0.4.2"`, never `"^0.4.2"`). It stays standalone because the language-neutral schema contract serves the whole RCF product line, not just Lite. Every umbrella release deliberately reviews the schemas pin as a mandatory checklist item; the pack-verify step in the registry runbook catches a mis-pin at pre-publish time.

**Any change to the tool's behaviour requires a matching update to the `rcf/` artefacts.** If you change what a verb does, add a flag, or alter an output format, the relevant requirement, story or acceptance criterion changes with it, in the same pull request. Spec-first is the house culture and the point of the project. If you are unsure which artefacts a change touches, `rcf query` can trace it, or ask in the pull request and we will help.

Pure refactors, test-only changes and documentation fixes do not need artefact updates; the pull request template asks you to say so explicitly.

## Pull requests

- Branch from `main`, using a short descriptive branch name (for example `fix-view-empty-tree` or `feat-query-json-output`).
- CI must pass. The suite runs on every pull request; a red build will not be reviewed.
- Never force-push to `main`. Force-pushing your own feature branch to rework a review is fine.
- Fill in the pull request template: what changed, which `rcf/` artefacts were updated (or why none were needed), and your test evidence.
- Keep pull requests focused. One behaviour change per PR reviews faster and traces cleaner.

## Where to ask

- **Bugs and defects:** open an [issue](https://github.com/Stravica/rcf-lite/issues) using the bug report form.
- **Questions, modelling advice and methodology discussion:** use [Discussions](https://github.com/Stravica/rcf-lite/discussions). "How should I model X?" is a discussion, not a bug.
- **Security problems:** never open a public issue; see [SECURITY.md](./SECURITY.md).

## Licensing

This project is licensed under Apache-2.0, and contributions are accepted on the same inbound = outbound terms: by submitting a contribution you agree it is licensed under Apache-2.0. There is no CLA and no DCO ceremony.
