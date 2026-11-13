# @firstflip/node

The official Node.js library for the [FirstFlip API](../../README.md). No dependencies; Node 18+.

> Beta. The npm package is not published yet. Copy `sdks/node` into your project and
> `npm install ./path/to/sdks/node`.

## Use

```js
const FirstFlip = require('@firstflip/node');
const firstflip = new FirstFlip(process.env.FIRSTFLIP_SECRET_KEY); // ffk_test_… — server only

const charge = await firstflip.charges.create({
  amount: 32000,
  currency: 'NGN',
  reference: 'order_1042',
  customer: { email: 'ada@example.com' },
});
// redirect the customer to charge.hosted_url
```

| Method | API |
|---|---|
| `firstflip.account.retrieve()` | `GET /account` |
| `firstflip.charges.create(params, { idempotencyKey? })` | `POST /charges` |
| `firstflip.charges.retrieve(id)` | `GET /charges/:id` |
| `firstflip.charges.list({ limit, starting_after, status, reference })` | `GET /charges` |
| `firstflip.charges.listAll(params)` | every page, as an async iterator |
| `firstflip.charges.cancel(id)` | `POST /charges/:id/cancel` |
| `firstflip.charges.simulatePayment(id)` | `POST /charges/:id/simulate_payment` (test mode) |
| `firstflip.paymentLinks.create(params)` | `POST /payment_links` |
| `firstflip.paymentLinks.retrieve(id)` / `.list()` / `.listAll()` | `GET /payment_links[/:id]` |
| `firstflip.paymentLinks.deactivate(id)` | `POST /payment_links/:id/deactivate` |
| `firstflip.subaccounts.create(params)` | `POST /subaccounts` |
| `firstflip.subaccounts.retrieve(id)` / `.list()` / `.listAll()` | `GET /subaccounts[/:id]` |
| `firstflip.subaccounts.suspend(id)` / `.activate(id)` | `POST /subaccounts/:id/suspend` · `/activate` |
| `firstflip.transfers.create(params)` | `POST /transfers` |
| `firstflip.transfers.list({ limit, starting_after, status, batch_id })` / `.listAll()` | `GET /transfers` |
| `firstflip.transfers.retrieve(id)` / `.simulate(id, status)` | `GET /transfers/:id` · `POST /transfers/:id/simulate` (test mode) |
| `firstflip.transfers.createBatch(transfers)` | `POST /transfers/bulk` — 1 to 50 payouts |
| `firstflip.transfers.retrieveBatch(id)` | `GET /transfers/bulk/:id` |
| `firstflip.fx.createQuote(params)` | `POST /fx/quotes` — `scenario` picks the test outcome |
| `firstflip.fx.retrieveQuote(id)` / `.simulateQuote(id, status)` | `GET /fx/quotes/:id` · `POST /fx/quotes/:id/simulate` (test mode) |
| `firstflip.fx.createTrade({ quote_id })` | `POST /fx/trades` |
| `firstflip.fx.retrieveTrade(id)` / `.simulateTrade(id, status)` | `GET /fx/trades/:id` · `POST /fx/trades/:id/simulate` (test mode) |
| `firstflip.virtualAccounts.create(params)` | `POST /virtual_accounts` |
| `firstflip.virtualAccounts.retrieve(id)` / `.deactivate(id)` | `GET /virtual_accounts/:id` · `POST /virtual_accounts/:id/deactivate` |
| `firstflip.virtualAccounts.createBatch(accounts)` | `POST /virtual_accounts/bulk` — 1 to 50 static accounts |
| `firstflip.virtualAccounts.retrieveBatch(id)` | `GET /virtual_accounts/bulk/:id` |
| `firstflip.virtualAccounts.simulatePayment(id, { amount, reference })` | `POST /virtual_accounts/:id/simulate_payment` (test mode) |
| `firstflip.verifications.createBvn(params)` | `POST /verifications/bvn` |
| `firstflip.verifications.retrieveBvn(id)` / `.simulateBvn(id, outcome)` | `GET /verifications/bvn/:id` · `POST /verifications/bvn/:id/simulate` (test mode) |
| `firstflip.verifications.resolveBank({ account_bank, account_number })` | `POST /verifications/bank_account` — the name behind a payout destination |
| `firstflip.otps.pricing()` | `GET /otps/pricing` — retail price per medium in NGN |
| `firstflip.otps.create(params)` | `POST /otps` — email, sms or whatsapp codes as a service |
| `firstflip.otps.retrieve(id)` / `.validate(id, code)` | `GET /otps/:id` · `POST /otps/:id/validate` |
| `firstflip.assistant.ask(question)` | `POST /assistant` — answers from the docs only; nothing is written, so no `Idempotency-Key` |
| `firstflip.cards.create(params, { idempotencyKey? })` | `POST /cards` — issue a USD card for one of your customers |
| `firstflip.cards.retrieve(id)` / `.list({ limit, starting_after, status })` / `.listAll(params)` | `GET /cards/:id` · `GET /cards` |
| `firstflip.cards.listTransactions(id, { type, status, limit, starting_after })` | `GET /cards/:id/transactions` |
| `firstflip.cards.fund(id, { amount })` | `POST /cards/:id/fund` — sandbox balance up, one ledger row |
| `firstflip.cards.withdraw(id, { amount })` | `POST /cards/:id/withdraw` — sandbox balance down (not from a frozen card) |
| `firstflip.cards.freeze(id, { reason? })` | `POST /cards/:id/freeze` — an omitted reason sends no body at all |
| `firstflip.cards.unfreeze(id)` | `POST /cards/:id/unfreeze` — no body, keyed write |
| `firstflip.cards.close(id, { reason? })` | `POST /cards/:id/close` — terminal; `unfreeze` on a closed card tells you to issue a new one |
| `firstflip.cards.updateSpendLimits(id, { daily_limit, per_transaction_limit, monthly_limit })` | `POST /cards/:id/spend_limits` — `null` clears a ceiling |
| `firstflip.cards.simulateAuthorization(id, params)` | `POST /cards/:id/simulate_authorization` (test mode) — drives the decline codes |

Every API-key operation the published spec documents has a method here: **53 of the 53** API-key operations. (The surface
is 57 documented operations; 4 of them are the hosted pay and landing pages `/sandbox/pay/{token}` and `/sandbox/l/{token}`,
which a browser opens — your server never calls them, so they are not API-key operations and are not counted in the 53.)

The cards namespace is the reason that sentence is measured rather than asserted. Until the 10 Nov round this README
understated the client's own coverage and the suite carried a hard-coded exclusion list for `/cards`, which meant the card
surface could ship, grow and stay absent from the client while every test stayed green. The exclusion is gone: the suite
walks the spec in both directions now, and it reads this README and the guides, so a coverage claim that the code does not
support fails the build.

```js
// Issue a card, fund it, and spend it under a ceiling you control.
const card = await firstflip.cards.create({
  customer: { email: 'ada@example.com', first_name: 'Ada', last_name: 'Okafor' },
  reference: 'customer_8842_usd',
  daily_limit: 500,
});
await firstflip.cards.fund(card.id, { amount: 250 });
const auth = await firstflip.cards.simulateAuthorization(card.id, { amount: 60, merchant: 'Shoprite' });
console.log(auth.status, auth.decline_code);

await firstflip.cards.freeze(card.id, { reason: 'report lost' });
await firstflip.cards.updateSpendLimits(card.id, { daily_limit: null }); // no ceiling
```

```js
for await (const c of firstflip.charges.listAll({ status: 'paid' })) console.log(c.id, c.reference);

// One payout run: a single Idempotency-Key covers the whole batch, so a retry never pays twice.
const batch = await firstflip.transfers.createBatch([
  { amount: 25, currency: 'USDT', type: 'stablecoin', network: 'SOLANA', account_number: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU' },
  { amount: 25, currency: 'USDT', type: 'stablecoin', network: 'SOLANA', account_number: '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM' },
], { idempotencyKey: 'payout-run-2026-11-04' });
console.log(batch.count, batch.data.map((t) => t.status));
```

```js
// FX: the quote arrives 'processing'; simulate the provider's answer, then trade against it.
const quote = await firstflip.fx.createQuote({ base_currency: 'USD', target_currency: 'NGN', quantity: 100000, scenario: 'processing' });
await firstflip.fx.simulateQuote(quote.id, 'ready');
const trade = await firstflip.fx.createTrade({ quote_id: quote.id });
await firstflip.fx.simulateTrade(trade.id, 'settled');

// A customer's own account number, and a BVN they consent to.
const account = await firstflip.virtualAccounts.create({
  currency: 'NGN',
  customer: { email: 'ada@example.com', first_name: 'Ada', last_name: 'Obi' },
});
console.log(account.account_number); // TEST-NGN-…
const bvn = await firstflip.verifications.createBvn({
  bvn: '22222222222', first_name: 'Ada', last_name: 'Obi', redirect_url: 'https://example.com/kyc',
});
console.log(bvn.status); // consent_pending — then firstflip.verifications.simulateBvn(bvn.id, 'verified')

// OTP as a service, and a payout destination checked before the money moves.
const otp = await firstflip.otps.create({ customer: { name: 'Ada Obi', phone: '+2348030000001' } });
console.log(otp.billing.amount, otp.sandbox.code); // NGN, and the sandbox code
await firstflip.otps.validate(otp.id, otp.sandbox.code);
const dest = await firstflip.verifications.resolveBank({ account_bank: '044', account_number: '0690000032' });
console.log(dest.account_name);
```

Sub-accounts, FX, virtual accounts, verifications, OTPs and transfers are **test mode only**:
`firstflip.subaccounts.create` returns `sandbox: { wallet_provisioned: false, accepts_real_money: false }`, a sandbox
identity with no wallet and no money; quotes and trades never settle real currency; virtual accounts are
`TEST-…` numbers that accept no transfers (`sandbox.accepts_real_transfers: false`); a BVN check returns a
`consent_pending` record with `consent_url: null` and never becomes KYC evidence; an OTP is priced in NGN and its
sandbox code is returned on create (`sandbox.code`) instead of being sent; and `transfers` never move funds
(`sandbox.funds_sent: false`). A live key gets `403 live_mode_unavailable` on every one of them.

## Listing

Every `list` and `listAll` takes `limit` (1–100, default 20) and `starting_after` for pagination, plus the
filters its resource documents. They also take a created window: `created_from` is inclusive and
`created_before` is exclusive, so this walks exactly one UTC day — and the window is carried onto every page:

```js
const day = { created_from: '2026-11-04', created_before: '2026-11-05' };
for await (const t of firstflip.transfers.listAll(day)) console.log(t.id, t.status);
```

Bare dates are UTC midnight; send a full RFC 3339 timestamp when you need a precise boundary. A malformed value
is a `400 invalid_parameter` with `param` naming the field.

## Retries and idempotency

Every `POST` gets an `Idempotency-Key` automatically, and the **same** key is reused on each retry, so a
retry can never create a second charge. Pass your own (`{ idempotencyKey: 'order_1042' }`) to make a
retry safe across process restarts too.

The client retries network errors, timeouts, `429`, `5xx`, `idempotency_in_progress` and
`rate_unavailable` (default 2 retries, honouring `Retry-After`). It never retries other `4xx`.

Options: `new FirstFlip(key, { timeoutMs: 30000, maxRetries: 2, baseUrl, fetch })`.

## Errors

```js
try {
  await firstflip.charges.create({ amount: 100, currency: 'NGN' });
} catch (e) {
  if (e instanceof FirstFlip.FirstFlipError) {
    e.status; // 400
    e.code;   // 'amount_too_small' — branch on this
    e.param;  // 'amount'
    e.headers['request-id']; // quote this to support; every response carries one
  }
}
```

## Webhooks

```js
app.post('/webhooks/firstflip', express.raw({ type: 'application/json' }), (req, res) => {
  let event;
  try {
    event = FirstFlip.webhooks.constructEvent(req.body, req.get('FirstFlip-Signature'), process.env.FIRSTFLIP_WEBHOOK_SECRET);
  } catch {
    return res.sendStatus(400);
  }
  if (event.type === 'charge.paid') fulfil(event.data.object.reference); // dedupe on event.id
  res.sendStatus(200);
});
```

## TypeScript

Types ship in `src/index.d.ts` (`Charge`, `Event`, `ChargeCreateParams`, `TransferListParams`, `FirstFlipError`, …).

## Tests

```bash
npm test   # unit tests
```

## Licence

MIT. See [LICENSE](LICENSE).
