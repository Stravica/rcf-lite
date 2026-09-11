# application-error-handling CHANGELOG

## 1.0.8 - 2026-09-11

- Adds a contributions/probes pack meeting rule 7d.
- Probes: two-boundaries-registered, category-vocabulary, record-shape-adr-1701.
- Framework boundary probe drives /throw-handler whose handler throws an Error whose induced stack carries system-path substrings and a file-URI substring; the wire body is inspected for those substrings and for stack markers. That observation targets AC-16102-2 and is anchored to it.
- Process boundary probe spawns the fixture as a child with crashOnRequest=true, hits /crash-real which schedules a real uncaught throw via setImmediate after the response is committed; the registered uncaughtException handler emits the error record (code, category unknown, message, correlationId, cause with stack, context) ONLY through the injected logging companion (no direct stdout or stderr write of the record per REQ-004), then writes a level=info type=companion-dump JSON line to stderr carrying the companion's invocations array, then process.exit(1); the probe reads the companion-dump stderr line and OS exit code from the child.on('exit') event.
- REQ-004 companion-invocation observation reads the companion-dump stderr line the child writes just before process.exit; both the framework path (an in-process /throw-handler request) AND the process path (the emit written by the uncaughtException handler before process.exit) show up in the companion's invocation list on that same child. No in-process /crash-process short-circuit is used for REQ-004 evidence.
- AC-16102-4 (mid-stream close) is a conformanceOnly row anchored on AC-16102-4: the probe drives /stream-then-throw so the fixture flushes headers, writes a partial body, then the framework boundary catches a mid-stream exception, emits EXACTLY ONE record through the injected companion factory naming the streaming-in-progress condition with category 'unknown', and closes the socket without rewriting the wire; the row observes exact-one-emission and category server-side and carries a limitation naming that the browser-network wire-close half is not observable on a server-driven probe pack.
- The process-boundary result records the correlationId as its own record.correlationId, and the evidence status field carries the OS exit code (numeric), not an HTTP-shaped fabrication.
- Detail texts open with the first eight words of the AC or REQ text they observe.
- Anatomy test pin bumped to 1.0.8.


## 1.0.3 (register-sweep patch, 2026-09-10)

- Register: neutral wording in shipped prose (no capability change).

## 1.0.2 (application-core completion pass, 2026-09-09)

- Adds top-level elicits[] block on blueprint.json declaring the one apply-time answer (classification-additions); backed by REQ-003 naming the transient/permanent/unknown defaults and the elicited-additions grammar per section 7c.
- Adds refusal-path ACs to US-16102 (stack-and-path scrubbing, non-Error throw defaults, mid-stream exception connection close), US-16104 (non-object context refusal, nested-and-array redaction, circular context handling), US-16105 (permanent no-Retry-After, unknown mapped as permanent, elicited-category retry contract), US-16106 (no-companion fallback stderr JSON single line, direct console.error passthrough, companion factory throw fallback), US-16107 (null-injection refusal, stub invocation contract, transportWriter throw recovery). US-16101 and US-16103 also extended with clean-shutdown preservation, browser-runtime path, double-throw handling, deep cause chain, cause-context redaction and null-vs-undefined cause discipline. Every story now at the 7a floor (4-5 ACs per story, 30 ACs total).

## 1.0.1 (application-core hardening, 2026-09-09)

- hardening pass: chain-consistency lint zero (pass1 + pass2); added deliveredBy to every REQ, added ownerRef and disposition to every AC per section 7b, closed `boundaryFor` and `transportWriter` restatements on AC-16107-1 via ownerRef back to TAC-1701.
- Added AC-16101-2 (unhandled promise rejection: one record under the `unknown` category, process terminates with exit code 1) covering the 2026-09-08 review finding F-1 on TAC-1701.responsibilities[0].
