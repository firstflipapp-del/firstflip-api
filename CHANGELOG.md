# Changelog

All changes to the FirstFlip API contract. Within `v1` changes are additive only.

## Unreleased

- **Virtual cards (test mode only)**: `POST /v1/cards` plus 10 more operations — `GET /v1/cards`, `GET /v1/cards/{id}`,
  `fund`, `withdraw`, `freeze`, `unfreeze`, `close`, `spend_limits`, `simulate_authorization` and `transactions`.
  Cards are **sandbox virtual USD cards**: `livemode: false` on every object, no PAN, no network token, no
  settlement, no 3-D Secure step-up. Money is a `balance` the sandbox moves by `fund` and `withdraw`, and
  authorizations come from `simulate_authorization`, which answers `201` with an `approved` or `declined`
  `card_transaction` regardless of HTTP status — `decline_code` is the verdict, not the status code. New scopes
  `cards:read` / `cards:write`; new error codes `insufficient_balance` (400), `card_closed` and `card_not_active`
  (409); new events `card.created`, `card.funded`, `card.withdrawn`, `card.frozen`, `card.unfrozen`,
  `card.closed`, `card.limits.updated`, `card.authorization.approved`, `card.authorization.declined`.
  Every POST needs an `Idempotency-Key`.
  Live cards remain planned and undocumented: they need an issuer rail, encrypted PAN handling and step-up.
  See the new [virtual cards guide](guides/cards.md) for lifecycle diagrams, sandbox-to-live key structure and
  the error/decline folds. All 11 routes are callable three ways: REST, the MCP tools (11 added) and
  `firstflip.cards.*` in the Node client.
- **Two platform ceilings on cards** (additive: one new error code, one new decline code). A key may hold **250 open
  cards**: the 251st `POST /v1/cards` answers the new `409 card_limit_reached` (`param: cards`) and writes nothing, and
  closing a card frees a slot, so a working integration cannot be locked out. And a business may commit **$1,000,000 of
  approved authorization spend per rolling 30 days** across every card it holds in that mode — two keys of one mode draw
  on the same bucket: past that,
  `simulate_authorization` answers `201` with the new `decline_code: over_tenant_monthly_limit` and no money moves. It
  sits fifth in the decision order — after your three axes, before `insufficient_funds` — and it is the only one of the
  six you cannot set. Neither ceiling is a body field and no call raises them; funding a card above the spend ceiling
  still lands, because what is capped is spend. `CardDeclineCode` in the Node client and every generated surface now
  name all six, and `sdks/node/test` pins that union to the order the spec states in both places it appears.
- AI agents package (`agents/`): a zero-dependency Node 18+ MCP server and CLI that expose every API-key
  operation (53 tools) to AI agents. `mcp-server.js` speaks JSON-RPC 2.0 over stdio (protocolVersion
  2024-11-05) with tool annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`);
  `firstflip-cli.js` offers `list`, `describe <op>` and `call <op>` with the same validation. Both read
  `agents/tools.json`, generated from the spec by `scripts/build-agent-tools.js`, which resolves cross-file
  `$ref`s into `api/services.openapi.json`, strips non-schema keys, and converts OpenAPI 3.0 nullable to
  type arrays. Secret key comes from `FIRSTFLIP_SECRET_KEY` env only; never logged, never in output.
  29 tests across 5 files. See [agents guide](guides/agents.md).
- Every operation carries a display label: all 57 operations in both spec files publish `x-display-name`, set equal to
  the operation's `summary`. A tool that lists the API therefore renders the same words the reference does, and the
  server's contract check fails if an operation loses the field or its label drifts from its summary.
- The contract is served by the API itself: `GET /docs/openapi.yaml` and `GET /docs/api/services.openapi.json`
  return the same bytes this repository publishes, from the host you are already calling, so a code generator or
  an agent does not need repository access. The service file sits at the path the main spec's relative `$ref`s
  point at, so the fetched YAML resolves unchanged; both answers are cacheable for five minutes and revalidate
  with `ETag`. A client that sends `Accept-Encoding: gzip` gets the same document compressed, with a validator of
  its own, so a revalidation can never answer 304 for the wrong representation. A server-side test holds the
  served bytes equal to the gated files.
- The Node client now proves its own coverage: every API-key operation the contract documents has a method in
  `sdks/node` (53 of the 53 — the four hosted pay/landing pages are browser endpoints, so they are not API-key
  operations and are not in the count), and the test suite reads `openapi.yaml` and
  `api/services.openapi.json` to fail if a covered operation loses its method, a method calls a path the spec does not
  publish, or the card set changes size without the README and the pin moving with it. The suite also reads the README
  and the guides: a coverage claim the code does not support, or a leftover "no SDK method yet", fails the build. So
  "the docs work in the client" is a checked statement rather than a convention — which is what the first version of
  this entry promised without any test that could keep it.
- The published surface is now privacy-gated, not privacy-asserted: `scripts/check-public-privacy.js` runs in
  `npm run check:guide` and reads every file on the export list looking for three shapes only — a credential-shaped
  value (vendor key prefix, private-key marker with material beside it, JWT, a connection string carrying a password,
  a 32+ mixed-case-plus-digit run), a secret *name* given a literal value, and a citation of private monorepo source.
  It reports zero on all 62 exported files, and its own `--self-test` seeds eight leaks and nine harmless look-alikes
  (npm integrity digests, inline base64 artwork, counting-hex fixtures, canonical uuids, env-var names) so a rule that
  went deaf or a rule that started shouting both fail the build instead of getting muted. Injecting one fake key into
  a shipped page turns it red; removing it turns it green — that is the run's own fail-first proof.
- Response examples and closed sets on every service operation: all 26 sandbox operations and the three hosted
  HTML pages now show a real success body (walked through its own schema, so a dropped field or an impossible
  status fails the server's contract check), and the payout/FX value sets are published as enums instead of bare
  strings — `Transfer.type` (5 corridors), `Transfer.currency` (14 payout currencies), `Transfer.debit_currency`
  (15 wallets) and `base_currency`/`target_currency` on `FxQuote`/`FxTrade` (`NGN/USD`, `GHS/USD`, `USD/NGN`).
  The contract check reads those sets out of the validator and the rate table, so a corridor added in code and
  not here is a build failure in both directions. See [payouts](guides/payouts.md#corridors-and-required-fields).
- An example on every documented operation: the cancel, deactivate, suspend and activate answers, the three list
  answers, the hosted-link pages (404, 410, 503 and their rate limit) and the `charge.expired` /
  `charge.cancelled` webhook payloads now show their shape, so nothing in the reference is left to guess at. The
  webhook deliveries also carry a `Webhooks` tag instead of appearing as an orphan section. The server's contract
  check fails if any documented operation loses its example, and the checkScripts suite covers the same rule.
- Key truth headers on `/v1`: every answer that went through the `Idempotency-Key` layer now says what the
  key did — `Idempotency-Status-Version: 1`, `Idempotent-Replayed: true|false` and
  `Idempotency-Key-State: completed|pending|failed`, plus `Idempotent-Original-At` and
  `Idempotency-Reference` on a replay. Fresh runs, a key still in flight and a released key used to look
  identical to an SDK; now each is distinguishable without guessing. Additive only (headers, no change to
  status or body). Both specs declare the five headers on exactly the keyed answers — `2xx`, `409`, `422` —
  and the server's contract check now pins the header names to the middleware's, the keyed operations to the
  routes that mount the layer, and the documented `Idempotency-Key-State` values to the three the server
  sends. See [idempotency](guides/idempotency-and-errors.md#what-the-key-actually-did--read-it-from-the-headers).
- Business API surface: per-key **scopes** (`charges:read`, `transfers:write`, …), sub-accounts
  (`POST/GET /v1/subaccounts`, suspend, activate), hosted pay/landing pages, and the services sandbox:
  OTP pricing/lookup/validate, FX quotes and trades, virtual accounts (single and bulk), BVN and
  bank-account verification, transfers and **bulk payouts** (`POST /v1/transfers/bulk`, 1–50 items).
  Every one is test mode only and records, never moves, money.
- Guides: [sub-accounts](guides/subaccounts.md) (create, list, suspend, activate; sandbox limits),
  [payouts](guides/payouts.md) (corridors and required fields, amount rules, simulate, list, bulk retries),
  [FX](guides/fx.md) (pairs, quotes, every failure scenario, trade, simulate),
  [virtual accounts](guides/virtual-accounts.md) (static vs dynamic, payment outcomes, bulk, lifetime),
  [verifications](guides/verifications.md) (BVN consent flow, bank-account resolution) and
  [one-time passwords](guides/one-time-passwords.md) (pricing, create, validate, attempts) and
  [assistant](guides/assistant.md) (grounded Q&A: limits, what it refuses, the grounding rule).
- Payouts: `GET /v1/transfers` (filters `status` and `batch_id`, `limit`, `starting_after`), plus
  `firstflip.transfers.list`/`.listAll`. List cursors break `createdAt` ties with the record id, so
  paging a bulk payout returns every row exactly once instead of ending at the first shared timestamp.
- Every list (`charges`, `payment_links`, `subaccounts`, `transfers`) accepts a `created_from`
  (inclusive) / `created_before` (exclusive) window, RFC 3339 with a bare date read as midnight UTC,
  so a period can be reconciled without walking the whole history. A malformed instant is
  `400 invalid_parameter` naming the parameter.
- Every response now carries a `Request-Id` header (a UUID for that request, on errors too), so a
  support ticket can name the exact request. The specs now say so on the responses themselves: all 285
  services responses and all 44 main-spec responses declare the headers the router sends —
  `Request-Id` and `Cache-Control: no-store` on everything (both `required`), the rate-limit pair on
  everything a limiter saw, `Retry-After` on every `429` and `503`. `POST /v1/assistant` also gains the
  `503` it always returned, separating `assistant_disabled` (retrying will not help) from
  `assistant_unavailable` (retry after `Retry-After`), and the server's contract check now fails when
  any response block stops declaring its headers or repeats a status key.
- Scopes are published in the machine-readable place as well as the prose: each operation that takes a
  key declares `x-required-scope` (53 operations over 20 scopes; the four hosted sandbox pages take no
  key), and [authentication](guides/authentication.md) lists what each scope unlocks. A key created
  without a list keeps everything its mode allows; a key with a list is never widened. A request whose
  key lacks the scope answers `403 insufficient_scope`. Two checks hold this: the server's contract
  check pins each documented scope to the scope its route enforces, in both directions, and
  `scripts/check-guide-scopes.js` pins the guide's table to the spec, in both directions.
- Postman: 57 requests in eight folders, every path id wired to the variable the previous step saves;
  the services requests come from `api/services.postman_collection.json`, kept in lockstep with
  `api/services.openapi.json` by the server's contract check. That check now also fails when a
  documented query parameter is missing from its example, and the `GET /v1/transfers` example shows
  `limit`, `status`, `batch_id`, `starting_after`, `created_from` and `created_before`.
- Tooling: `npm run bundle` inlines the `$ref`'d services paths so the assistant knowledge lists every
  endpoint (57); examples added to the list filters and hosted-page token so a rebuild is byte-identical.
- Docs: during the beta, FirstFlip issues test keys and registers webhook endpoints on request (send us
  your https URL); the Developer screen in the app is coming.
- Docs: the webhook delivery log can show `secret_unavailable`; `POST /v1/assistant` answers `400 question_required` / `question_too_long`;
  `idempotency_key_required` has type `idempotency_error`.
- Licence: the SDK and code samples are MIT; the docs are © First Flip Ltd, readable and usable to
  integrate with the FirstFlip API.
- `POST /v1/assistant`: ask integration questions; answers come from these docs only (30/hour per key).
- Postman: guided walkthrough, per-request notes and checks; payment links use `{{payment_link_id}}`.
- Payment links: `POST/GET /v1/payment_links`, `GET /v1/payment_links/:id`, `POST /v1/payment_links/:id/deactivate` (test mode). Charges gain `payment_link` (additive).
- SDK: `firstflip.paymentLinks.*`, `firstflip.subaccounts.*` (create, retrieve, list/listAll, suspend,
  activate), `firstflip.fx.*` (quote and trade, each with its simulate), `firstflip.virtualAccounts.*`
  (create, retrieve, bulk, retrieveBatch, deactivate, simulatePayment), `firstflip.verifications.*`
  (BVN create/retrieve/simulate, `resolveBank`), `firstflip.otps.*` (pricing, create, retrieve, validate)
  and `firstflip.transfers.*` (create, retrieve, list/listAll, simulate, `createBatch` for
  bulk payouts, `retrieveBatch`) — every API-key operation except the four hosted pages and the 11 card routes
  has a method (the card routes are REST + MCP tools only; see the first entry in this section).
  `firstflip.assistant.ask`
  is the one POST sent without an `Idempotency-Key`: `/assistant` has no idempotency middleware and a
  question writes nothing.
- `@firstflip/node` 0.1.0-beta.1 (`sdks/node`): typed client, automatic Idempotency-Key reused across retries, safe retry policy, `listAll` pagination, webhook `verify`/`constructEvent`. Tested end to end against the server.

## 1.0.0-beta.1 — 2026-09-28

Hardening after a security review. No request or response shape changed except as listed.

- New error codes, all in the standard error shape: `413 body_too_large`, `429 rate_limited`
  (type `rate_limit_error`), `503 service_unavailable`. `404 not_found` for unknown paths.
- Amounts with cents such as `5.10` are accepted (a rounding check wrongly refused some). New
  per-charge maximum: ₦1,000,000,000 / $1,000,000.
- Rate lookups that fail answer `503 rate_unavailable` instead of `500`.
- Idempotency: key order in the body no longer matters.
- `charge.expired` is now sent even if nobody reads the charge; lists show expired charges as `expired`.
- Webhook endpoints must use port 443. Failed attempts are labelled (`timeout`, `http_500`, …).

## 1.0.0-beta — 2026-09-28

First public shape of the API, test mode only.

- Secret keys `ffk_test_…` / `ffk_live_…` (live not issued yet), optional IP allow-list, instant revocation.
- `GET /v1/account`.
- Charges: `POST /v1/charges`, `GET /v1/charges`, `GET /v1/charges/:id`, `POST /v1/charges/:id/cancel`,
  `POST /v1/charges/:id/simulate_payment` (test mode).
- Hosted sandbox payment page (`hosted_url`).
- Webhooks: `charge.paid`, `charge.cancelled`, `charge.expired`, signed with `FirstFlip-Signature`
  (`t=…,v1=…` HMAC-SHA256), retried for about 2 days, resendable.
- `Idempotency-Key` required on every POST.
- Docs: webhook verification samples in Node.js and Python are tested against the server's signer; the
  PHP sample follows the same algorithm but has not been run yet.
