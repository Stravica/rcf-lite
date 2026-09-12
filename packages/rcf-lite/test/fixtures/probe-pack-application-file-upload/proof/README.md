# MCP-route smoke: application-file-upload probe pack

Captured on 2026-09-06 against the shipped fixture with the pinned Playwright MCP as the browser driver. Every JSON file here is the raw output of the `rcf verify browser` command that produced the verdict; the top of each file includes any driver stderr lines and the JSON body follows. Filenames follow the convention `pack-mcp-route.<label>.<ts>.json`; the timestamp is the `createdAt` value the runner stamped into each file (colons replaced with dashes for filesystem safety).

## Files

| File | Command | Aggregate | Purpose |
|---|---|---|---|
| `pack-mcp-route.multipart.2026-09-06T17-54-00Z.json` | `rcf verify browser FBS-001 --url http://127.0.0.1:13970/upload --probe-pack application-file-upload --json` on the honest fixture (multipart default branch) | warn (agent-driver invariant, unrelated to this pack; every pack check passes) | Baseline: every check `pass` against the compliant fixture on the multipart branch. |
| `pack-mcp-route.tus.2026-09-06T17-55-00Z.json` | Same shape with `--url http://127.0.0.1:13971/upload?transport=tus` | warn (same invariant caveat) | Baseline: every check `pass` against the compliant fixture on the tus branch; AC-23104-1 detail cites the numeric `Upload-Offset` values observed on the PATCH request log. |
| `pack-mcp-route.negative-no-input.2026-09-06T17-53-00Z.json` | Same shape with `FILE_UPLOAD_BREAK=no-input` on the fixture boot | block | `AC-23101-1` fails: upload region missing the file input (WCAG 2.5.7 keyboard alternative gone). |
| `pack-mcp-route.negative-no-live-region.2026-09-06T17-53-00Z.json` | Same shape with `FILE_UPLOAD_BREAK=no-live-region` | block | `AC-23102-1` fails: `[data-live-region="polite"]` wrapper missing. |
| `pack-mcp-route.negative-send-refused.2026-09-06T17-53-00Z.json` | Same shape with `FILE_UPLOAD_BREAK=send-refused` | block | `AC-23103-1` fails: refused filename `not-allowed.exe` appears in the upload request log. |
| `pack-mcp-route.negative-no-chunks.2026-09-06T17-53-00Z.json` | Same shape with `FILE_UPLOAD_BREAK=no-chunks` | block | `AC-23104-1` fails: `[data-chunks-uploaded]` stays at 1 (single-request path). |

## Reproduce

```
# Boot the fixture on a free port (default 3000; refuses 4200).
cd packages/rcf-lite/test/fixtures/probe-pack-application-file-upload
PORT=13970 node server.js

# In another shell, create a scratch rcf project, apply the blueprint,
# set FBS-001.uiBearing=true and FBS-001.contextRequirements.tacIds
# to ['TAC-2401-application-file-upload-input'], then invoke
# rcf verify browser with the pinned Playwright MCP.
rcf init --project-name t2-scratch --non-interactive --no-agent-setup --no-playwright-mcp
rcf define blueprint add /path/to/blueprints/application-file-upload
rcf define update FBS-001 --json --set uiBearing=true
rcf define update FBS-001 --json --set 'contextRequirements={"tacIds":["TAC-2401-application-file-upload-input"]}'
rcf verify browser FBS-001 --url http://127.0.0.1:13970/upload --probe-pack application-file-upload --json
rcf verify browser FBS-001 --url http://127.0.0.1:13970/upload?transport=tus --probe-pack application-file-upload --json
```

For the four negative runs, boot the fixture with `FILE_UPLOAD_BREAK=<switch>` and repeat the multipart command.

## Node engine

Every run above used Node 24.14.0 (`/Users/thefoot/.n/n/versions/node/24.14.0/bin/node`), the engine rcf-lite declares.
