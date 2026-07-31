# Persona programme: tail-interview template

<!-- Never-skip-RCF invariant is a platform rule; see build-cycle-playbook.md §13 and elicitation-playbook.md §11.1 for the byte-identical statement. Editors: any change to guidance wording is subject to canary release-block. -->

## 1. Why this exists

Personas run against a shipping build; the run produces a corpus of behaviour a real user would see. Two classes of finding do not surface in that corpus by construction:

1. **Affective failure modes.** Register fatigue, first-impression posture, "did that feel long to read" - the persona is an LLM; asking it to notice these during the run is asking it to be something it structurally cannot be.
2. **Silent non-asks.** Credentials the persona would have volunteered if asked. Permissions the operator granted that the agent forgot to act on. Preferences the persona has a settled view on that the run never touched. A persona reporting only what the agent said produces a corpus with a systematic blind spot on the credentials and permissions it never got a chance to describe.

The tail interview is the mechanised second question, run after the main persona task closes. It never turns the persona back into a human; it just asks the questions the run itself could not, in a dedicated turn, and records the answers on the run's report for the corpus reader.

## 2. When to run it

At the end of every persona run, immediately after the main task closes and before the report is finalised. The tail interview is a mandatory closing turn - the persona role definition dispatches it in a fresh turn against the same persona; the corpus reader picks up the appended answers alongside the primary run.

## 3. The tail interview

Reach the persona in a dedicated turn, in character, and pose these five questions. The persona answers as the persona, not as a reviewer of the run; if the honest answer is "I do not know" or "as an LLM I cannot judge", say so - do not fabricate an answer to have something to write.

> **Tail interview.** After the persona run's main task completes, the persona role is asked the following questions in a dedicated dispatch turn. Answer as the persona, in the persona's voice, without breaking character. If the honest answer is "I do not know" or "as an LLM I cannot judge", say so; do not fabricate.
>
> 1. **Response length and density.** Across the run, did any agent response feel long or dense to read? Which ones, and at what points? If none felt long, say so plainly; do not invent length concerns to have an answer.
> 2. **Silent non-asks.** What did the agent NOT ask you that you (as the persona) would have volunteered if asked? Think about credentials, permissions, preferences, or context that would have been useful earlier in the run but the agent never raised. If nothing comes to mind, say so.
> 3. **First-impression posture.** Read the agent's first response again. Does it read as "the agent has this in hand and you can steer" or "the agent is asking you to do the work of parsing"? Name specifics.
> 4. **Register drift.** Did the agent's register (formality, jargon density, verbosity) change across the run? If yes, at what point and in which direction? If no, say so.
> 5. **Anything else the run made you think about that the questions above did not cover?**

## 4. Recording the answers

The persona role appends the answers to the run's report under a dedicated `tailInterview` section. Each answer carries the question id (1-5) so a corpus reader can join across runs; free-text follow-ups land at question 5.

The corpus reader treats the tail interview as advisory signal, not ground truth. An LLM persona's introspective answers are lower-fidelity than a human's, and reading them straight would over-weight them. The value is directional: a pattern of "the agent felt long at the same point across three runs" is signal even if any single answer is noisy.

## 5. What this is not

- Not a reviewer's verdict on the run. The persona is playing the persona; the reviewer's verdict lives elsewhere.
- Not a scoring rubric. There is no numeric grading; the answers are prose.
- Not a substitute for the primary run. A persona programme with a strong tail interview and a weak primary run is a bad persona run; the tail interview does not compensate.

## 6. Where the template lives

Ships with the build-lite guidance pack so operators running personas via rcf-lite have the template as a discoverable resource; `rcf guidance persona-programme` prints it, and MCP-wired agents reach the same content via the `rcf://docs/persona-programme` resource. The operator-side persona role definitions that run the interview inherit the template from here; a change to the wording lands in one place.
