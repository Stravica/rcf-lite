# Load balancer health check configuration

Reference for a vendor-neutral load-balancer target-group health check consuming the `loadBalancer` profile's single HTTP GET at `/health` with status-code-only response. Field names below reflect the shape most application-load-balancer products expose; substitute the exact field names of the vendor at hand.

```
protocol: HTTP
port: <traffic-port>
path: /health
matcher: 200
interval: 15 seconds
timeout: 5 seconds
healthyThreshold: 2
unhealthyThreshold: 2
```

Notes.

- The `path` `/health` matches the shipped `loadBalancer` profile default. Override with `probeInterface.options.loadBalancer.path`.
- The `matcher: 200` reflects the profile's response contract: pass is status code 200 with content-length zero; fail is status code 503 with content-length zero. The LB reads only the status code.
- `interval`, `timeout`, `healthyThreshold`, `unhealthyThreshold` are common defaults; tune per the LB's expectations and the readiness evaluator cadence the project chose (a shorter LB interval than the evaluator cadence sees stale answers; a longer LB interval flips slower than the underlying state).
- The response body is empty. A body-inspecting matcher against this profile is a project misconfiguration; the profile refuses at boot any override adding a body field (AC-14106-3).

Reference: general load-balancer health-check documentation across major vendors is consistent on the single-endpoint status-code-only shape (AWS ELB/ALB target-group health checks, GCP load balancer health checks, Azure Load Balancer health probes, Cloudflare Load Balancer monitors); consult the specific vendor's docs for exact field names.
