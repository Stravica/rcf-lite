# Resend sender-domain verification pointer

Sender-domain verification is a provider-owned operation the project performs against Resend before any outbound message is accepted. This file is a pointer to Resend's own public documentation, not a copy of Resend's verification checklist. Copies drift; the pointer does not.

## Where the operator goes

Resend maintains public documentation covering sender-domain setup and the DNS records required (SPF, DKIM, DMARC alignment). The operator applies the blueprint, then walks Resend's own step list against the domain they intend to send from. The blueprint does not restate those steps because Resend owns the source and updates it on its own cadence.

- Resend's public docs are hosted under the provider's own docs site; the operator finds the sender-domains section through the provider's own top-level navigation.
- The DNS records the provider requires are published on the provider's own docs page; they change from time to time and the provider's page is the current source.
- The verification-passing UI signal is published on the provider's own dashboard; the operator confirms verification there before running the blueprint's runtime-verify AC that requires a real send.

## What the blueprint gates on locally

Independent of Resend's verification workflow, this blueprint's `AC-4102-1` gates the runtime-verify of the unverified-sender refusal class: a fresh project applying the blueprint before verifying the from-address with the provider will observe `RESEND_SENDER_UNVERIFIED` returned from the adapter. The refusal is the AC's binding, not a bug; the AC passes because the class is surfaced correctly. The operator then completes the provider-side verification and observes the happy-path AC (AC-4101-2) pass on the same running project.

## What this file is not

- Not a substitute for the provider's docs. If a step here contradicts the provider's own page, the provider's page is authoritative.
- Not a domain-selection guide. Which domain the project sends from is a project-side decision this blueprint does not touch.
- Not a compliance checklist. Regulatory requirements (double-opt-in, unsubscribe surfaces, retention of consent records) live outside this blueprint's scope; a project subject to them handles them separately.

## Placeholder-only examples

The example addresses that appear elsewhere in this blueprint's assets use IETF reserved test domains (`example.test`, `example.com` where the RFC permits) and are never real deliverable addresses. A real project resolves its own verified addresses through the configured secret resolver and never commits them to the repo.
