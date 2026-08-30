# Kubernetes probe podspec (separate-port topology)

Reference fragment for a Kubernetes podspec that consumes the `kubernetes` profile with `probeListener.separatePort: 9091`: probes bind to a dedicated container port that is NOT published on the `Service`; only the traffic port is public. The kubelet reaches the probe port on the pod network.

```yaml
containers:
  - name: <container-name>
    image: <image-ref>
    ports:
      - name: http
        containerPort: 8080
      - name: probe
        containerPort: 9091
    livenessProbe:
      httpGet:
        path: /live
        port: probe
      initialDelaySeconds: 5
      periodSeconds: 10
      timeoutSeconds: 1
      failureThreshold: 3
    readinessProbe:
      httpGet:
        path: /ready
        port: probe
      initialDelaySeconds: 2
      periodSeconds: 5
      timeoutSeconds: 1
      failureThreshold: 3
```

And the matching `Service` that publishes only the traffic port:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: <service-name>
spec:
  selector:
    app: <selector-label>
  ports:
    - name: http
      port: 80
      targetPort: http
```

Notes.

- The probe port (`9091` here) appears on the pod but not on the `Service`; the probe surface is reachable to the kubelet on the pod network and not from cluster consumers of the `Service`.
- The separate probe listener binds only the profile's resolved probe path set; any other path on port 9091 returns not-found (AC-14104-2).
- Reachability equivalence between probes and user traffic is traded for probe-traffic isolation; the fused topology is the default and matches observability-essentials's posture for the case where the trade goes the other way.

Reference: kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes for probe field references and the pattern of using a distinct container port for probes.
