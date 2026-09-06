# infra-s3-and-queue fixture

Shared sample-app fixture for the `object-storage-s3` (T-2) and `messaging-queue-cloudflare` (T-3) blueprints (infra round 5 spec section 3.6). T-2 side: boots MinIO in a container, exposes a facade over `@aws-sdk/client-s3` against MinIO on `http://localhost:9000`, and hosts induced-failure switches the six shipped probes drive against. T-3 side: to be added by track T-3 as a sibling docker-compose service and `wrangler dev` seam under `src/`.

## Boot MinIO

Docker (the shipped, verified path):

```sh
docker compose up -d minio
```

Podman (equivalent incantation; not verified in this pass, provided per authoring standard):

```sh
podman-compose up -d minio
```

Or plain Podman without podman-compose:

```sh
podman run -d --name infra-minio-fixture \
  -e MINIO_ROOT_USER=rcf-dev \
  -e MINIO_ROOT_PASSWORD=rcf-dev-only \
  -p 9000:9000 -p 9001:9001 \
  minio/minio:latest server /data --console-address ":9001"
```

If port 9000 or 9001 is already bound on the host, override via
`MINIO_PORT=19000 MINIO_CONSOLE_PORT=19001 docker compose up -d minio`.

Port 4200 is Dave's workspace port; never bind it. This fixture uses 9000 (S3 API) and 9001 (console) by default.

## MinIO console

Once MinIO is up, the browser console is at `http://localhost:9001` with credentials `rcf-dev` / `rcf-dev-only` (fixture-only).

## Credentials and endpoint (elicited parameters realised)

- Endpoint URL: `http://localhost:9000` (S3_ENDPOINT_URL env override).
- Bucket: `rcf-test` (S3_BUCKET env override).
- Credential pair: `rcf-dev` / `rcf-dev-only` (matches MINIO_ROOT_USER / MINIO_ROOT_PASSWORD; wired via the fixture's `src/secrets.mjs` shim that realises the security-secrets-management `secretRef` contract).
- Region: `auto`.
- Force path style: `true` (MinIO requires; R2 also supports).

## Create the bucket once (one-shot)

```sh
docker compose up -d minio && sleep 4 && npm install --silent && node src/create-bucket.mjs
```

Idempotent: exits 0 whether the bucket exists or was created.

## Two-line gate-reviewer boot

```sh
docker compose up -d minio && sleep 4 && npm install --silent && node src/create-bucket.mjs
node ../../../../blueprints/object-storage-s3/contributions/probes/run-facade-round-trip.mjs
```

The first line brings up MinIO, waits, installs the fixture's own `@aws-sdk/client-s3` runtime dep, and creates the `rcf-test` bucket. The second line runs the first probe; the remaining five probe shims live alongside it and follow the same shape.

## Induced-failure switches

Four switches simulate failure modes the negative-run probes exercise. Each is wired end-to-end at v1.0.0 and each was proven fail-verdict on the shipped head:

- `SIMULATE_MINIO_DOWN=true`: unbind the port before the probe runs (`docker compose stop minio`); the `facade-round-trip` probe surfaces a HeadBucket connection error, aggregate verdict fail, node exit 1.
- `SIMULATE_403_ON_GET=true`: the facade's `getObject` throws a synthetic AccessDenied 403 shape; the `put-get-round-trip` probe surfaces the fail on AC-28102-1, node exit 1.
- `SIMULATE_PART_UPLOAD_FAIL=true`: the multipart uploader refuses part 2 with a thrown error; the `multipart-upload` probe surfaces the fail (the initial 10 MiB put propagates the mid-multipart error and the AbortMultipartUpload path runs in the facade before the rejection reaches the caller), node exit 1.
- `SIMULATE_PRESIGN_MALFORMED=true`: the facade tampers the returned URL's X-Amz-Signature; the `presigned-url` probe's first fetch returns 403 instead of 200, aggregate verdict fail, node exit 1.

Two additional switches from the spec's original enumeration (event-secrecy leak simulation and above-cap large-payload simulation) are not carried at v1.0.0: the event-secrecy whitelist is enforced in code (not via a runtime switch), and the 10 MiB multipart probe already exercises the above-threshold path. A future v1.1 may add either if a runtime-switched form yields something the shipped path does not already prove.

## Presigned URL wall-clock TTL test

`SIMULATE_PRESIGN_EXPIRE=true` on the `presigned-url` probe issues a 60 s TTL, waits 62 s, and asserts the second fetch returns 403. Without the switch the probe asserts the tampered-signature 403 shape instead so CI does not spend a full minute waiting.

## R2 real-account smoke

`node ../../../../blueprints/object-storage-s3/contributions/probes/run-r2-real-account-smoke.mjs`:

- Without `CI_HAS_CLOUDFLARE_ACCOUNT`: exits 0 with `accountBoundSkipped: true` per spec section 3.5.
- With `CI_HAS_CLOUDFLARE_ACCOUNT` set alongside `R2_ACCOUNT_ID`, `R2_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` in `.rcf/secrets/dev.env` (or the environment), runs a real round-trip against the R2 bucket.

## Tear down

```sh
docker compose down -v
```

Removes the container and the anonymous volume; no orphan state on the host.
