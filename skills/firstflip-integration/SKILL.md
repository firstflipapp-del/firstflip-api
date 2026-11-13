---
name: firstflip-integration
description: Build and troubleshoot FirstFlip API integrations using the published contract, scoped business keys, payment links, signed webhooks and sandbox checks.
---

# FirstFlip integration

Use the bundled [API contract](references/openapi.yaml), [services contract](references/api/services.openapi.json), [operation catalog](references/tools.json) and [guide bundle](references/knowledge.md). They are generated together from the public developer documentation. The catalog identifies each operation's method, path, scope, input schema and example; the guide bundle is divided into `<guide name="…">` sections.

Before implementing an operation, read its contract and the relevant guide section. Use `quickstart`, `authentication` and `who-controls-what` for setup; `charges` or `payment-links` for collections; `cards` for card operations; `webhooks` for signature handling; `idempotency-and-errors` for failed or ambiguous calls; `testing` and `going-live` before launch. Read only the product sections needed for the task. Do not infer endpoints, SDK methods, live availability, prices or fees from an operation name.

Keep business secret keys and webhook signing secrets on the developer's server. Use the operation's required scope. Public discovery and installation do not grant API access or bypass account verification. Test keys simulate supported operations. A live key does not prove a service is enabled or its live prerequisites are met; use the documented operation response and actual launch evidence. For a missing capability, explain that the published contract does not expose it instead of calling an app's internal endpoints.

For MCP writes, choose a nonempty `idempotency_key` once per logical operation and save it before the call. Retry with that same key and identical arguments. The CLI prints a generated key when one was omitted; keep it for retries. A timeout is an unknown outcome: retrieve the resource or reconcile it before starting another operation. Do not ask a customer to pay again while the original payment remains uncertain.

Fulfil an order or send a paid-order email only after a verified successful payment. Browser redirects do not establish payment status. Verify `FirstFlip-Signature` against the raw notification bytes, enforce the documented timestamp window, and deduplicate `FirstFlip-Event-Id` before side effects. Query the charge when its status is unclear.

When diagnosing a failure, collect the operation, safe request fields, HTTP status, canonical error code and `Request-Id`; never collect a full secret, card security code or unmasked identity document. Honor `Retry-After`. Explain what was changed and how it was verified. Test failure, duplicate, timeout and forged-notification cases before reporting an integration ready.

This skill provides integration guidance and code. Execute a live financial operation only within the user's actual authorization, with its amount, recipient and effect clear. It does not authorize account approval, bypass KYC/KYB, enable a live rail or reopen a disabled storefront.
