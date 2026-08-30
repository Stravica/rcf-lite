# Docker HEALTHCHECK

Reference for a Dockerfile fragment consuming the `dockerHealthcheck` profile's exec transport. The `HEALTHCHECK CMD` invokes the entry point the profile exposes; the exit code IS the probe answer.

```dockerfile
# ... application build stages omitted ...

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD /usr/local/bin/<service-binary> --healthcheck || exit 1
```

Notes.

- The `--healthcheck` flag on the service binary is the profile's exec entry point (TAC-1504's `execAdapter` exposes `runHealthcheck`); it reads the readiness predicate and exits 0 on pass, non-zero on fail.
- `--interval`, `--timeout`, `--start-period`, `--retries` are Docker HEALTHCHECK defaults; tune per the container orchestrator's expectations.
- `docker inspect` and Docker Compose's `depends_on: condition: service_healthy` consume the resulting health status.
- No HTTP probe listener is opened by the process when the `dockerHealthcheck` profile is selected (AC-14105-3).

Reference: docs.docker.com/reference/dockerfile/#healthcheck for the HEALTHCHECK instruction reference.
