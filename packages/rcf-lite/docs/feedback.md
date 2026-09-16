# `rcf feedback`

Slice 1 of the feedback surface. The core verb records blueprint and
core findings to a private, gitignored log under `.rcf/feedback/`, so an
agent can capture what misbehaves at the moment it happens without
interrupting the operator and without any network traffic. Later slices
add redaction and preview (slice 2), destination resolution (slice 3),
submission under the operator's own GitHub identity (slice 4), the
one-ask-per-session hook (slice 5) and RULE 17 in the managed
instructions block (slice 6).

## What is collected

- What the agent saw a blueprint or `rcf-lite` itself do that contradicts
  its own docs, fails, or forced a workaround.
- The blueprint or verb the finding is about, the anchor id (AC / REQ /
  TAC / ADR), a closed-enum symptom class, a severity, a plain title, a
  markdown body and one or more evidence pointers (a command, a
  `path:line`, an id).
- An environment stamp: harness, `rcf-lite` version, Node version and
  platform. Blueprint entries additionally stamp `blueprintVersion`,
  `libraryPrefix`, `libraryRef` and `resolvedSha` (or `tarballSha256`)
  from the manifest and the blueprint-libraries registry so a maintainer
  can tell which pin the reporter was on.

## What is never collected

- Absolute paths, hostnames, private IPs, emails, operator identity,
  secret-looking strings. Redaction lives in slice 2; the agent is
  instructed (RULE 17) not to put any of these into the body.
- Attachments, screenshots and arbitrary binary files.
- Anything sent over the network. Slice 1 is local-only. Slice 4 adds a
  consent-gated submit path through the reporter's own `gh` CLI.

## Store layout

Everything under `.rcf/feedback/` in the project root:

- `entries.jsonl`: append-only JSON Lines. State transitions
  (`submitted`, `bundled`, `deferredUntilSession`, `discarded`) are
  appended as new lines with the same `id`; the reader folds by id,
  last line wins.
- `state.json`: per-session ask ledger (slice 5).
- `outbox/<ISO-timestamp>-<repo-slug>.md`: bundle files written by
  slice 4 when the submit path cannot land the entry directly.

The directory is gitignored via the 0.6.0 managed-block aggregator; a
fresh `rcf init` writes the entry into `.gitignore` automatically. On a
pre-upgrade project without the entry, `rcf feedback add` refuses with a
one-line pointer at `rcf doctor --fix` (or pass `--force` to bypass).

## Sub-verbs (slice 1)

### `rcf feedback add`

Records one entry.

```
rcf feedback add \
  --kind blueprint|core \
  --target <ref> \
  [--anchor <id>] \
  --class <symptom-class> \
  --severity blocker|major|minor \
  --title <text> \
  (--body <text> | --body-file <path>) \
  --evidence <pointer> [--evidence <pointer> ...] \
  [--harness claude-code|codex|other] \
  [--ask-now] \
  [--force]
```

- Prints `recorded <id> (<n> pending). Nothing sent.` on stdout.
- Exit 0 on success. Exit 2 on usage errors (bad enum, oversize body,
  gitignore not covering the store). Exit 3 when `--kind blueprint` and
  the target does not resolve to a known blueprint (entry is recorded
  with `destination.reason = unresolved`; the agent should relay the
  stderr line).

Symptom class enum: `docs-mismatch`, `validate-fails`, `apply-fails`,
`internal-contradiction`, `stale-citation`, `missing-scenario`,
`verb-error`, `verb-hang`, `wrong-output`, `other`.

Body cap: 8 KB (UTF-8). Title cap: 120 characters.

### `rcf feedback list [--all] [--json]`

Prints pending entries by default (`recordedAt` ascending). `--all`
includes every state; `--json` emits the full entry objects. No file
writes, no network calls.

### `rcf feedback status [--json]`

Prints counts by status and the environment-driven opt-out state.
`gh` availability and the destinations table land in slices 4 and 3
respectively; slice 1 reports them as pending.

### `rcf feedback defer`

Appends a `deferredUntilSession` state line for every currently pending
entry, stamped with the current session id. Entries stay in the log so
the next session sees them; the current session's Stop hook (slice 5)
will not re-ask.

### `rcf feedback discard <id> [<id>...] | --all`

Appends a `discarded` state line for the named entries (or every
pending entry with `--all`). Discarded entries are hidden from `list`
default output and excluded from the carry-over ask count in slice 5.

## Later-slice sub-verbs (stubs)

`preview`, `submit`, `opt-in`, `opt-out` and `hook` are registered as
"not yet available" and exit 3 with a one-line note naming the slice
that ships them. This keeps `rcf feedback --help` referable at slice-1
time without inventing verb behaviour ahead of the ACs.

## Environment variables

- `RCF_FEEDBACK_ASK=0` silences the Stop-hook ask (slice 5).
- `RCF_FEEDBACK_DISABLE=1` makes `add` a no-op (slice 5).
- `RCF_FEEDBACK_SESSION_ID` overrides the session id stamped on new
  entries (defaults to `unknown` when the harness does not export one).

## Related

- Design of record: `projects/rcf-lite-wsd/specs/2026-09-16-feedback-submission-design.md`
  in the operator repo.
- Chain: REQ-155 (Local feedback capture) and its USes.
- FBS: FBS-180 (Slice 1: capture and store).
