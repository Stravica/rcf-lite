# Uptime monitor configuration

Reference for a vendor-neutral uptime-monitor configuration consuming the `uptimeMonitor` profile's single URL check. Uptime monitors probe a public URL from external vantage points and page the operator when the check fails against a threshold. Field names below reflect the shape most uptime-monitor products expose.

```
url: https://<public-hostname>/health
method: GET
expectedStatus: 200
interval: 60 seconds
timeout: 10 seconds
regions: <one-or-more-vantage-points>
alertOn: <threshold-of-consecutive-failures>
```

Notes.

- The `url` path `/health` matches the shipped `uptimeMonitor` profile default (same path as `loadBalancer`; the difference sits in the flip cadence per ADR-1502, not in the path). Override with `probeInterface.options.uptimeMonitor.path`.
- The profile's response contract is status-code-only with content-length zero on every response; the monitor reads only the status code.
- `interval`, `timeout`, and `alertOn` are usually monitor-side tunables; the profile keeps its readiness evaluator cadence set for a stable answer over the monitor's flap window so a transient dependency blip does not page.
- Uptime monitors that page on body content are outside this profile's scope; a project on such a monitor authors a `custom:<name>` profile or supersedes ADR-1505.

Reference: general uptime-monitor documentation across vendors is consistent on the single-URL status-code-plus-optional-body-string shape (Pingdom, UptimeRobot, BetterStack, Datadog Synthetics, StatusCake); consult the specific vendor's docs for exact field names.
