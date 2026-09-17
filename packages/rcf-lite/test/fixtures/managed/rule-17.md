### RULE 17: Log what misbehaves; ask once before anything leaves.

When a blueprint or rcf-lite itself does something contrary to its own
docs, fails, or forces you into a workaround (a validate finding on
freshly applied content, a contribution that references a piece the
blueprint does not ship, a stale vendor citation, a verb that errors or
hangs, output that contradicts `rcf help`), record it at once with
`rcf feedback add` (kind, target, anchor id, symptom class, severity,
a plain title and a body that says what happened, what the docs say,
and the command or file that shows it). Recording is silent and local;
nothing is sent. Never put customer data, credentials, operator names
or absolute paths in the body: the tool redacts, you do not rely on it.

Ask exactly once per session. The harness hook, or your own judgement
at a natural pause (the queue reports complete, the operator says they
are wrapping up), triggers it: run `rcf feedback preview`, show the
operator the exact titles and bodies it prints and where they would be
filed (name the repo and whether it is public), and ask in one sentence
whether to send them. Yes: `rcf feedback submit --yes`, then relay the
issue links. Not now: `rcf feedback defer`. Never for this project:
`rcf feedback opt-out`. Do not ask again in the same session, do not
submit without a yes, and do not describe the mechanism unless asked.
If submit reports a bundle instead of a link, give the operator the
bundle path and the repo URL in one line and move on.
