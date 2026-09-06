# probe-pack-application-file-upload fixture

Dependency-free sample app the `application-file-upload` probe pack drives on the shelf gate. Node HTTP server serving one upload surface at `/upload` with two transport branches (multipart POST default and tus.io elicited alternative) plus break switches so the pack's four negative runs can be driven from a single boot.

## Boot

```
cd packages/rcf-lite/test/fixtures/probe-pack-application-file-upload
node server.js
```

Prints `LISTENING <port>` once bound.

## Environment

| Var | Purpose | Default |
|---|---|---|
| `PORT` | HTTP port the server binds to. `4200` is refused (reserved for the operator workspace). | `3000` |
| `FILE_UPLOAD_BREAK` | Force a default break across every request. Values: `no-input`, `no-live-region`, `send-refused`, `no-chunks`. Per-request `?break=` still wins when both are set. Useful for driving the pack's negative runs on plain `/upload` without a per-request query. | unset |

## Query switches

| Query | Purpose |
|---|---|
| `?transport=multipart` | Recommended default transport (per ADR-2401). |
| `?transport=tus` | tus.io 1.0.0 elicited alternative; the client-side loop pushes numeric offsets to `window.__tusPatchOffsets`. |
| `?state=<name>` | n/a: this blueprint models states through the file-row lifecycle (`idle`, `uploading`, `refused`, `complete`) driven by the seed and the autostart flag, not through a state selector. Use `?seed=` instead. |
| `?seed=demo` | Default seed. Two small text files that upload to `complete`. |
| `?seed=refused` | Seeds one refused file (`not-allowed.exe`, `mime-refused`) alongside one honest file. Autostarts. |
| `?seed=large` | Seeds one large file with five chunks so the chunked transport check has enough chunks to observe. |
| `?autostart=1` | Kicks off the upload loop on page load (default off, on for `seed=refused`). |
| `?caps=<list>` | n/a for this blueprint. application-file-upload declares no capabilities and no requiresAppliedCapabilities, so there is nothing to gate; the fixture ignores this switch. |
| `?theme=<name>` | n/a for this blueprint. No theme-gated surface or resize seam, so the fixture does not vary its render on theme; the switch is ignored. |
| `?break=no-input` | Drops the file input, leaving only the drop-zone and the keyboard opener (pack check `AC-23101-1` refuses; WCAG 2.5.7 alternative gone). |
| `?break=no-live-region` | Drops the polite live-region wrapper (pack check `AC-23102-1` refuses). |
| `?break=send-refused` | Sends the refused file to the server anyway (pack check `AC-23103-1` refuses; the refused filename appears in `window.__uploadRequestLog`). |
| `?break=no-chunks` | Collapses the chunked path to a single request (pack check `AC-23104-1` refuses; `[data-chunks-uploaded]` stays at 1 and no PATCH is issued on the tus branch). |

## Routes

- `/` index of fixture links.
- `/upload` upload surface (accepts every switch above).
- `POST /upload/chunk` synthetic acknowledgement endpoint for the multipart branch.
- `PATCH /upload/tus` synthetic acknowledgement endpoint for the tus branch (echoes `Upload-Offset`).

## Manual boot for the gate reviewer

```
PORT=4321 node server.js
curl -s http://127.0.0.1:4321/upload | head -20
```

Two-line boot: start the server, hit `/upload` to confirm the surface renders.
