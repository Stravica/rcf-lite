# probe-pack-observability-logging fixture

Self-contained fixture used by the `observability-logging`
blueprint's contribution probes. Provides a minimal in-process
logger factory (`src/logger-factory.mjs`) that realises the
blueprint's load-bearing shape: one JSON object per stdout line,
seven-field minimum set on every emission, ambient correlationId
via `runWithCorrelation`, and PII redaction at the boundary
regardless of call-site discipline.

## Layout

- `src/logger-factory.mjs`: factory. Sole writer to the injected
  outSink and errSink so probes can substitute string buffers and
  assert emitted bytes.

## Declared env vars

- `RCF_FIXTURE_LOGGER_CORRELATION_HEADER` (optional): overrides the
  ambient correlationId header name a probe injects; defaults to
  `X-Correlation-Id` per the blueprint's default elicit value.

No account gate. The blueprint is process-local; every probe runs
in-process against the real logger factory and asserts positive
evidence (parsed JSON lines, exact correlationId round-trip, exact
redaction category strings on the emitted line).

## Reviewer boot

```
export PATH=$HOME/.n/n/versions/node/24.14.0/bin:$PATH
node ./blueprints/observability-logging/contributions/probes/run-line-shape-and-fields.mjs
node ./blueprints/observability-logging/contributions/probes/run-correlation-id-flow.mjs
node ./blueprints/observability-logging/contributions/probes/run-redaction-boundary.mjs
```
