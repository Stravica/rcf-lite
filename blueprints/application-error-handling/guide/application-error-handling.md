# Guide: application-error-handling (v1.0.0)

## What it is

A shipped, org-neutral error-handling contract for a rcf-lite application. Two boundaries (process-level uncaught, framework-level request-pipeline), one shared internal error record shape, one classification vocabulary. Records emit through the applied logging companion so PII redaction, correlation propagation and structured emission all reuse the logging blueprint's discipline. The transport response mapping delegates to the applied transport blueprint's `errorEnvelope` ADR (application-api-rest for REST; a future blueprint for gRPC / message consumer).

## What it deliberately is not

- Not a transport wire envelope. application-api-rest owns `errorEnvelope` for REST; a future transport blueprint claims its own transport-specific errorEnvelope topic.
- Not a retry policy. The record carries `category`; the applying platform's retry surface reads it and decides. The blueprint names the per-class contract (transient => retryable; permanent => not retryable; unknown => permanent by wire, logged at error level) but does not itself schedule retries.
- Not a substitute for the logging companion's redaction. Context redaction at record construction uses the applied logging companion's redaction boundary; when no logging companion is applied, redaction is a pass-through (documented fallback).

## When to reach for it

- Any application that has not yet applied an error-handling companion. Applying this blueprint gives a working boundary and record shape without registering a library.
- Any project whose applied service blueprints (application-api-rest, application-spa) declare `suggestedCompanions: ["errorHandling"]` and no more specific library provides the role.

## When it does not fit

- A project standing on an organisation with a shipped error-handling library (`wsd-error-handling`, `acme-error-shape`) that provides the `errorHandling` role. The companion-suggestion mechanism resolves to the library over this shelf fallback.
- A project whose transport is not yet served by any transport blueprint the shelf ships. The delegation contract (ADR-1703) still holds; the project supplies its own `transportWriter`.

## What a good outcome looks like

- The uncaught boundary catches every process-level exception, emits one record and exits cleanly with code 1; the framework-level boundary maps every thrown exception to a mapped wire response with no raw stack trace; every record has code, category and correlationId; the cause chain is intact across every nested wrapping; the transport response reflects the classification (retryable vs not); `rcf define validate` clean.

## The operator decisions that remain open

- **The classification additions** (ADR-1702). Recommended defaults cover the three shared cases; per-domain additions (rate-limited, quota-exceeded, dependency-degraded) fit the same mechanism.
- **The applied transport blueprint.** REST projects apply application-api-rest 2.1.0 or later. Non-REST projects supply their own `transportWriter` against the substitutable interface.
- **The applied logging companion.** Recommended: apply observability-logging 1.0.0 or later (or a registered library-side provider). Without a logging companion, the fallback stderr path fires and the guide names the gap.

## Cost-honesty

Adds four REQs, seven USs, two TACs, three ADRs to the project's chain. The runtime cost is one boundary registration per boot plus one record construction per error emission (including a context deep-clone for redaction). No runtime dependency added to the project's `package.json`; the boundary is authored against the applying project's own runtime and its applied transport blueprint's writer interface.
