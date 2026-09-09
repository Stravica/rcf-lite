# application-spa CHANGELOG

## 1.5.1 (B6a application core hardening, 2026-09-09)

- B6a hardening pass: chain-consistency lint zero (pass1 + pass2); added deliveredBy to every REQ pointing at a TAC responsibility or interface, added ownerRef and disposition to every AC per section 7b, closed case drifts on `content-security-policy` in REQ-018, AC-1125-1 and AC-1131-1 to match the owner spelling on TAC-209.
- Added AC-1123-6 (telemetry buffer overflow with drop-oldest and drop-count observability on reconnect) covering the 2026-09-08 review finding F-1 on TAC-206.responsibilities[3], and AC-1107-6 (theme persistence failure: visible session-only theme, aria-live unsaved announcement, no persisted preference) covering F-2 on TAC-202.responsibilities[2].


