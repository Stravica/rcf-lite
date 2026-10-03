# Document intake into the brief ledger

This document is the content of the `rcf_define_intake` MCP prompt
served argument-free by the server. It walks the harness through
intake and lands every finding as an open-question statement the
intent loop then asks.

## What intake is

The owner hands over a folder. One file is the brief (short, prose,
the "what we are building" document); the rest are supporting
documents (ADRs, spec sketches, old READMEs, OpenAPI YAML, meeting
notes). The split that reaches the brief ledger is the harness's
work; the mechanical scans and the follow-up questions are
rcf-lite's.

Intake is harness-split and tool-scanned. The harness writes
`<source>.statements.md` beside each source; rcf-lite mints the
statements, runs the three mechanical scans against the existing
body, and appends one `openQuestion` statement per finding. The loop
then reads one check (`brief:openQuestions`) and the owner answers
in one place (ADR-4130).

## The walk

Walk the folder brief-first. For each source, in this order:

1. Open the source.
2. Split it into one statement per line. A statement is a sentence
   that stands on its own: a capability (something the product must
   do), a constraint (a rule it must obey), an actor (a person or
   role), an entity (a thing it keeps track of), an externalSystem
   (another system), a surface (a screen or channel), outOfScope
   (something explicitly not in), an openQuestion (a question still
   to answer), or an amendment (a correction to an earlier
   statement).
3. Write `<source>.statements.md` next to the source. Each line is
   one statement with a leading `[kind]` marker and a trailing
   `(source: <path>:<line-span>)` marker.
4. Show the file to the owner in one message. Correct based on their
   reply.
5. Run `rcf define ledger brief add --from <path>` (or the
   `rcf_define_ledger` MCP tool with `verb: add`, `from: <path>`).
   The mechanical scans run by default; findings are appended as
   openQuestion statements. Report the scan findings as plain
   questions.
6. Move to the next source.

Never add two sources through one `brief add --from`. Each `add`
scans the new ids against the existing body, and the scan source
marker `scan:<name>:<ids>` names the ids from both sides.

## The line grammar

Each line of a statement file is a statement. The grammar:

```
[<kind>] <text> (source: <path>:<line-span>)
```

- `[<kind>]` is one of the nine kinds above. When absent, the kind
  defaults to the harness's `--kind` flag (default `capability`), or
  to `openQuestion` when the line ends with `?` or begins with
  `TBC`, `TBD`, `Open:` or `Question:`.
- `(source: ...)` names the file and the line range in the source.
  When absent, the harness's `--source` flag or the file path itself
  is used.
- Everything between the two markers is the statement text,
  verbatim.

## What the owner sees

A statement file is operator prose. The owner reads it; the harness
corrects based on their reply. Example:

```
[capability] Officers can put a loan on hold for up to 30 days. (source: briefs/loans.md:12-14)
[constraint] A loan on hold must not accrue late fees. (source: briefs/loans.md:15)
[openQuestion] Who approves a hold longer than 30 days? (source: briefs/loans.md:16)
```

After `brief add --from` runs, the loop will ask about each of these
through `rcf define questions --persona productOwner`.

## After intake

Run `rcf define questions --persona productOwner`. The next set is
the `resolvedBy` questions for every capability, constraint, entity,
actor, externalSystem and surface statement, suggesting existing
REQ titles that share two or more words of 4+ characters. The owner
decides which become new REQs, which point at existing REQs, and
which are omitted.

At L1 (`levels.intentComplete.ok === true`) the agent pre-populates
`[draft]` entities, components and interfaces as engineer entry
material. These are drafts the engineer refines; they are never a
product-owner blocker.
