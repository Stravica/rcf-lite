# application-error-handling CHANGELOG

## 1.0.1 (B6a application core hardening, 2026-09-09)

- B6a hardening pass: chain-consistency lint zero (pass1 + pass2); added deliveredBy to every REQ, added ownerRef and disposition to every AC per section 7b, closed `boundaryFor` and `transportWriter` restatements on AC-16107-1 via ownerRef back to TAC-1701.
- Added AC-16101-2 (unhandled promise rejection: one record under the `unknown` category, process terminates with exit code 1) covering the 2026-09-08 review finding F-1 on TAC-1701.responsibilities[0].


