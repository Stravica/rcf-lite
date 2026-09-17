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

## What leaves the machine

- Nothing until the operator says yes. `add` is local-only; `preview`
  is read-only; `submit --yes` is the only sub-verb that reaches
  the network.
- What DOES leave (after `submit --yes`): the redacted title and body
  the operator saw in `preview`, plus the environment stamp,
  filed as a GitHub issue under the reporter's ambient `gh` login.

## What is stored locally

The raw capture in `.rcf/feedback/entries.jsonl` is UNREDACTED so an
operator (or a later triage tool) can see exactly what the agent
recorded before the redaction rules run. That is why the store is
gitignored and refuses to write on a project whose `.gitignore` does
not cover `.rcf/feedback/`. Concretely, a raw entry MAY carry
absolute paths, hostnames, private IPs, emails, operator identity,
or secret-looking strings the redactor would strip on submit. Nothing
in the raw log is committed and nothing in it is sent.

## What redaction strips before an issue is filed

Rendered issue bodies (`preview` and `submit`) run every string
through the design 5 rules and record the substitutions in a ledger
the operator sees at preview time:

- Absolute paths (POSIX and Windows, including paths with spaces),
  the project root (both the as-typed and the realpath spelling),
  and the project's git remote URLs.
- Emails, non-allowlisted hostnames and URLs, private and link-local
  IPs (v4 and v6, `fc00::/7`, `fe80::/10`), operator identity from
  the identity seed.
- Secret-shaped strings: GitHub tokens, AWS keys, `sk-`/`sk_live_`,
  Slack `xox[abp]-`, JWTs, PEM blocks (BEGIN..END), `Bearer <token>`,
  and the whole `Authorization:` header line (a line-anchored rule
  folds the scheme, the credential and any tail together so the token
  never reaches the body on its own; `authorization` is deliberately
  NOT in the vocabulary list below because the vocabulary rule would
  fold `Authorization: Basic` alone and leave the credential),
  high-entropy blobs.
- Well-known `key: value` pairs whose key matches an open secret-key
  vocabulary (design amendment R3a). The vocabulary is exported from
  `src/feedback/redact.js` as `SECRET_KEY_VOCABULARY` and is shared by
  the first-pass redactor, the URL query-parameter scanner and the
  whole-text residual safeguard, so all three cover the same set. The
  current stems are: `passphrase`, `clientsecret`, `client_secret`,
  `client-secret`, `privatekey`, `private_key`, `private-key`,
  `accesskey`, `access_key`, `access-key`, `apikey`, `api_key`,
  `api-key`, `credential`, `credentials`, `signature`, `password`,
  `passwd`, `session`, `cookie`, `secret`, `bearer`, `creds`,
  `token`, `salt`, `cred`, `pass`, `auth`, `pwd`, `sig`, `pw`,
  `key`. Match is right-bounded at a word edge so `keyword` and
  `authors` do not fold. `hash` folds only when the value is 16+
  characters (so a short commit digest displayed for humans stays).
  The vocabulary is English-only; a non-English key stem
  (`motdepasse=`, `contrasena=`, `passwort=`, `senha=`,
  `wachtwoord=`) is not recognised on its own. A non-English key
  paired with a 32+ char high-entropy value still folds via the
  entropy-blob backstop; a shorter value carrying a non-English key
  should be hand-redacted before submit.
- Vocabulary-key labels separated from a value-shape token by any
  separator (design amendment R4). The R4 pass runs after the primary
  rule-5 loop and folds a vocabulary key labelling a value via
  markdown-table pipes (`| password | Sup3rSecretV@lue!! |`), prose
  bridges (`password is Sup3rSecretValueLong`, `password was ...`,
  `password set to ...`), arrows, whitespace runs, tabs, hyphens,
  HTML numeric entities (`pass&#61;SuperSecretValue1234`,
  `pass&#x3d;...`) and any other non-`:=` separator up to 40 chars
  between the key and the value. The value has to be 8+ chars and
  carry at least two character classes among {upper, lower, digit,
  symbol}, so ordinary prose (`the password is required`,
  `the password field is required`) is left alone; false positives
  are visible in the ledger and preferred over a labelled value
  reaching the body. The residual safeguard runs the same scan so a
  shape the primary pass missed refuses submit fail-closed.
- URL-embedded credentials (design amendment R3b, rule 9, ledger name
  `url-credential`). A URL's `user:pass@host` userinfo is dropped
  before the hostname pass so the host still folds cleanly. Under a
  known webhook host (`hooks.slack.com/services`,
  `discord.com/api/webhooks`, `discordapp.com/api/webhooks`,
  `hooks.zapier.com`, `api.telegram.org/bot`) the path AFTER the
  recognisable prefix is folded to `<url-credential>` because the
  token IS the path. Query parameters whose name matches the
  vocabulary above or the presigned-URL set (`X-Amz-Signature`,
  `X-Amz-Credential`, `X-Amz-Security-Token`, `X-Amz-Date`, `sas`,
  `se`, `sv`, `sp`, `access_token`) have their values replaced with
  `<url-credential>`. Any remaining path or query segment that trips
  a 16+/mixed-class entropy heuristic is also replaced.
- Rendered body cap: 8 KB after redaction; the fingerprint tail is
  kept so dedupe survives the truncation. The cap is enforced on the
  fully assembled body (free-form text + evidence rows + environment
  table + fingerprint twin + consent tail), not just the free-form
  head, so an oversized evidence pointer cannot push the rendered
  body past the cap.

Attachments, screenshots and arbitrary binary files are never
attached to an issue.

### Safeguard: final whole-text residual scan (AC-15601-4)

After the eight redaction rules run and dash / control-char / cap
normalisation is applied, one last pass runs `findResidualSecrets`
over the WHOLE rendered issue body (and over each bundle file) with
multiline patterns. If any residual shape survives (a token buried
inside a longer identifier, a multiline PEM block whose first-pass
delimiters were folded by dash normalisation, an `Authorization:`
line ...), the entry stays pending: `preview` prints the residual
line and pattern, `submit` refuses that entry and exits 3, and the
bundle write is refused fail-closed. This is defence-in-depth: the
per-field redaction ledger tells the operator what was stripped;
the safeguard guarantees that even if a shape re-appears after
per-field redaction + normalisation + assembly, nothing carrying it
leaves the machine.

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

### `rcf feedback opt-out` / `rcf feedback opt-in`

Silences (or restores) the per-session ask by writing
`rcf/feedback-settings.json`. The file is committed to the repo, so a
shared project silences the ask for everyone; `add`, `preview` and
`submit` keep working under `ask: false` for hand-driven flows. The
CLI merges over any existing file rather than overwriting it, so
`quietMinutes` and `redaction.allowHosts` (design section 8) survive.

### `rcf feedback hook <stop|session-end|session-start> [--harness <h>]`

The harness hook handler. Reads harness JSON from stdin, applies the
quiet rule (design section 3.5), and emits per-harness output:

- Claude Code Stop: exit 2 with the ask on stderr (Claude Code feeds
  the reason back to Claude, which speaks to the user).
- Codex Stop: stdout JSON `{"decision":"block","reason":"..."}` with
  exit 0.
- SessionEnd: writes a byte-idempotent bundle to
  `.rcf/feedback/outbox/<ISO>-session-end.md` for every currently
  pending entry so a crashed session's findings are pastable.
- SessionStart: with pending entries recorded under a prior session
  id, prints (or emits in the Codex `additionalContext` shape) one
  line the harness re-surfaces as context so the next Stop asks.

The `asked` ledger at `.rcf/feedback/state.json` is appended BEFORE
the emit so a crash between emit and reply cannot cause a second ask.
`--harness` defaults to `claude-code` when `CLAUDECODE=1` and to
`codex` when any `CODEX_*` env var is set; otherwise the flag is
required.

## Settings file (`rcf/feedback-settings.json`)

Written by `rcf feedback opt-out`, `opt-in` and (implicitly) `rcf
init`; read by the hook and by `rcf feedback status`. Defaults:

```json
{
  "settingsVersion": 1,
  "ask": true,
  "quietMinutes": 15,
  "redaction": { "allowHosts": [] }
}
```

- `ask` gates the Stop hook. `false` silences it; `add`, `preview`
  and `submit` keep working. Restore with `rcf feedback opt-in`.
- `quietMinutes` is the age threshold on the newest pending entry.
  A lower value asks sooner; a blocker-severity entry can pass
  `--ask-now` to bypass the age gate.
- `redaction.allowHosts` extends the shipped vendor allowlist for
  redaction (design section 5, rule 4).

## Hook install (`rcf init` step 6)

`rcf init` merges three feedback hook entries into
`.claude/settings.json` and `.codex/hooks.json` (design section 3.5,
ADR-4108): Stop (timeout 10), SessionEnd (timeout 5) and SessionStart
with matcher `startup|resume` (timeout 5). Each command line is:

```
npx rcf-lite feedback hook <event> --harness <claude-code|codex>
```

`--bin-path <path>` on `rcf init` replaces the `npx rcf-lite` prefix
with `node <path>` for pinned-bin deployments. `--no-feedback-hooks`
skips both writes; RULE 17 in the managed instructions block (slice
6) still covers the ask via the belt-and-braces fallback path.

`rcf doctor --check feedback-hooks` diagnoses drift: `missing-hook`
per file per event is fixable with `--fix`; `foreign-hook` (an entry
whose command names our verbs but whose flags or timeout differ) is
refused so a bespoke variant is never silently overwritten.

## Environment variables

- `RCF_FEEDBACK_ASK=0` silences the Stop-hook ask (slice 5).
- `RCF_FEEDBACK_DISABLE=1` makes `add` a no-op that prints
  `feedback disabled by env` and exits 0, without touching the tree.
  For locked-down environments where even a local log is unwanted.
- `RCF_FEEDBACK_SESSION_ID` overrides the session id stamped on new
  entries (defaults to `unknown` when the harness does not export one).

## Related

- Design of record: `projects/rcf-lite-wsd/specs/2026-09-16-feedback-submission-design.md`
  in the operator repo.
- Chain: REQ-155 to REQ-162 and their USes.
- FBS: FBS-180 (slice 1), FBS-181 (slice 2), FBS-182 (slice 3),
  FBS-183 (slice 4), FBS-184 (slice 5, the ask; this doc), FBS-185
  (slice 6, RULE 17 + release).
