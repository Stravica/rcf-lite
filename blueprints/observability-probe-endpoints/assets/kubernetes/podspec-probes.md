# Kubernetes probe podspec (fused topology default)

Reference fragment for a Kubernetes podspec that consumes the shipped `kubernetes` profile default: HTTPGet `/live` and `/ready` on the container's request-traffic port. The port name below assumes the container publishes its user-traffic listener on a named port `http`; substitute the project's chosen name.

```yaml
containers:
  - name: <container-name>
    image: <image-ref>
    ports:
      - name: http
        containerPort: 8080
    livenessProbe:
      httpGet:
        path: /live
        port: http
      initialDelaySeconds: 5
      periodSeconds: 10
      timeoutSeconds: 1
      failureThreshold: 3
    readinessProbe:
      httpGet:
        path: /ready
        port: http
      initialDelaySeconds: 2
      periodSeconds: 5
      timeoutSeconds: 1
      failureThreshold: 3
```

Notes.

- The paths `/live` and `/ready` match the shipped `kubernetes` profile default. Override in the profile with `probeInterface.options.kubernetes.paths.{liveness,readiness}` and adjust these fragments to match.
- `initialDelaySeconds`, `periodSeconds`, `timeoutSeconds`, and `failureThreshold` are project defaults; tune per the supervising cluster's expectations.
- The response contract is `{"status":"pass"}` on pass and `{"status":"fail"}` on fail with status codes 200 and 503; the kubelet reads only the status code. The body is present for operator triage under `kubectl describe pod` and equivalent introspection paths, and stays minimal by construction (ADR-1505).

Reference: kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes for the probe reference; kubernetes.io/docs/reference/generated/kubernetes-api/v1.30/#httpgetaction-v1-core for the HTTPGetAction field reference.
