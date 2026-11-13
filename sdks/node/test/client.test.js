'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const FirstFlip = require('../src');
const { FirstFlipError } = FirstFlip;

const KEY = `ffk_test_${'a'.repeat(48)}`;

// A scripted fetch: each call takes the next reply and records the request.
function fakeFetch(replies) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url: String(url), ...init });
    const r = replies.shift();
    if (r instanceof Error) throw r;
    return new Response(r.body === undefined ? '' : JSON.stringify(r.body), { status: r.status || 200, headers: r.headers || {} });
  };
  fn.calls = calls;
  return fn;
}

test('rejects anything that is not a secret key', () => {
  assert.throws(() => new FirstFlip('pk_test_x'));
  assert.throws(() => new FirstFlip(undefined));
  assert.equal(new FirstFlip(KEY, { fetch: fakeFetch([]) }).livemode, false);
});

test('create sends auth, JSON and an Idempotency-Key; retries reuse the SAME key', async () => {
  const f = fakeFetch([
    { status: 503, body: { error: { type: 'api_error', code: 'rate_unavailable', message: 'x' } }, headers: { 'retry-after': '0' } },
    new TypeError('socket hang up'),
    { status: 201, body: { id: 'ch_test_1', object: 'charge' } },
  ]);
  const ff = new FirstFlip(KEY, { fetch: f, baseUrl: 'https://example.test/v1', maxRetries: 3 });
  const c = await ff.charges.create({ amount: 32000, currency: 'NGN' });
  assert.equal(c.id, 'ch_test_1');
  assert.equal(f.calls.length, 3);
  const keys = f.calls.map((x) => x.headers['Idempotency-Key']);
  assert.ok(keys[0] && keys.every((k) => k === keys[0]), 'one key for the whole operation');
  assert.equal(f.calls[0].headers.Authorization, `Bearer ${KEY}`);
  assert.equal(f.calls[0].url, 'https://example.test/v1/charges');
  assert.deepEqual(JSON.parse(f.calls[0].body), { amount: 32000, currency: 'NGN' });
});

test('a caller-supplied Idempotency-Key is used as-is', async () => {
  const f = fakeFetch([{ status: 201, body: { id: 'ch_test_2' } }]);
  await new FirstFlip(KEY, { fetch: f }).charges.create({ amount: 1, currency: 'USD' }, { idempotencyKey: 'order-42' });
  assert.equal(f.calls[0].headers['Idempotency-Key'], 'order-42');
});

test('client errors are not retried and surface code/param', async () => {
  const f = fakeFetch([{ status: 400, body: { error: { type: 'invalid_request_error', code: 'amount_too_small', message: 'The minimum charge is 5000 NGN', param: 'amount' } } }]);
  const ff = new FirstFlip(KEY, { fetch: f });
  await assert.rejects(ff.charges.create({ amount: 1, currency: 'NGN' }), (e) => {
    assert.ok(e instanceof FirstFlipError);
    assert.equal(e.status, 400);
    assert.equal(e.code, 'amount_too_small');
    assert.equal(e.param, 'amount');
    return true;
  });
  assert.equal(f.calls.length, 1);
});

test('GETs carry no Idempotency-Key; query params are encoded; gives up after maxRetries', async () => {
  const f = fakeFetch([
    { status: 500, body: { error: { type: 'api_error', code: 'internal_error', message: 'x' } }, headers: { 'retry-after': '0' } },
    { status: 500, body: { error: { type: 'api_error', code: 'internal_error', message: 'x' } }, headers: { 'retry-after': '0' } },
  ]);
  const ff = new FirstFlip(KEY, { fetch: f, maxRetries: 1 });
  await assert.rejects(ff.charges.list({ status: 'paid', reference: 'a b' }), /x/);
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[0].headers['Idempotency-Key'], undefined);
  assert.match(f.calls[0].url, /status=paid&reference=a\+b/);
});

test('listAll walks every page with starting_after', async () => {
  const f = fakeFetch([
    { body: { object: 'list', data: [{ id: 'c3' }, { id: 'c2' }], has_more: true } },
    { body: { object: 'list', data: [{ id: 'c1' }], has_more: false } },
  ]);
  const ids = [];
  for await (const c of new FirstFlip(KEY, { fetch: f }).charges.listAll({ limit: 2 })) ids.push(c.id);
  assert.deepEqual(ids, ['c3', 'c2', 'c1']);
  assert.match(f.calls[1].url, /starting_after=c2/);
});

test('assistant.ask posts the question', async () => {
  const f = fakeFetch([{ body: { object: 'assistant_answer', answer: 'Use POST /v1/charges.' } }]);
  const r = await new FirstFlip(KEY, { fetch: f }).assistant.ask('How do I create a charge?');
  assert.equal(r.answer, 'Use POST /v1/charges.');
  assert.match(f.calls[0].url, /\/assistant$/);
  assert.deepEqual(JSON.parse(f.calls[0].body), { question: 'How do I create a charge?' });
});

test('subaccounts: create, suspend and activate hit the right paths with idempotency keys', async () => {
  const f = fakeFetch([
    { status: 201, body: { id: 'sa_test_1', object: 'subaccount' } },
    { body: { id: 'sa_test_1', status: 'suspended' } },
    { body: { id: 'sa_test_1', status: 'active' } },
  ]);
  const ff = new FirstFlip(KEY, { fetch: f, baseUrl: 'https://example.test/v1' });
  const sa = await ff.subaccounts.create({ name: 'Acme', email: 'a@acme.ng' });
  assert.equal(sa.id, 'sa_test_1');
  await ff.subaccounts.suspend('sa_test_1');
  await ff.subaccounts.activate('sa_test_1');
  assert.deepEqual(f.calls.map((c) => [c.method, c.url]), [
    ['POST', 'https://example.test/v1/subaccounts'],
    ['POST', 'https://example.test/v1/subaccounts/sa_test_1/suspend'],
    ['POST', 'https://example.test/v1/subaccounts/sa_test_1/activate'],
  ]);
  assert.ok(f.calls.every((c) => c.headers['Idempotency-Key']), 'every write is idempotent');
  assert.deepEqual(JSON.parse(f.calls[0].body), { name: 'Acme', email: 'a@acme.ng' });
});

test('transfers.createBatch sends { transfers } under one key and reads the batch back', async () => {
  const f = fakeFetch([
    { status: 201, body: { id: 'trb_test_1', object: 'transfer_batch', count: 2, data: [] } },
    { body: { id: 'trb_test_1', object: 'transfer_batch', count: 2, data: [] } },
  ]);
  const ff = new FirstFlip(KEY, { fetch: f, baseUrl: 'https://example.test/v1' });
  const items = [
    { amount: 1500, currency: 'KES', type: 'mobile_money', country: 'KE', account_number: '0712345678', beneficiary_name: 'A B' },
    { amount: 2500, currency: 'GHS', type: 'bank_account', country: 'GH', account_number: '1234567890', beneficiary_name: 'C D' },
  ];
  const batch = await ff.transfers.createBatch(items, { idempotencyKey: 'payout-run-1' });
  assert.equal(batch.count, 2);
  await ff.transfers.retrieveBatch('trb_test_1');
  assert.equal(f.calls[0].method, 'POST');
  assert.equal(f.calls[0].url, 'https://example.test/v1/transfers/bulk');
  assert.equal(f.calls[0].headers['Idempotency-Key'], 'payout-run-1');
  assert.deepEqual(JSON.parse(f.calls[0].body), { transfers: items });
  assert.equal(f.calls[1].url, 'https://example.test/v1/transfers/bulk/trb_test_1');
  assert.equal(f.calls[1].headers['Idempotency-Key'], undefined);
});

test('transfers.list filters a payout batch; listAll walks it with starting_after', async () => {
  const f = fakeFetch([
    { body: { object: 'list', data: [{ id: 'tr_test_2' }, { id: 'tr_test_1' }], has_more: true } },
    { body: { object: 'list', data: [{ id: 'tr_test_2' }, { id: 'tr_test_1' }], has_more: true } },
    { body: { object: 'list', data: [{ id: 'tr_test_0' }], has_more: false } },
  ]);
  const ff = new FirstFlip(KEY, { fetch: f });
  const page = await ff.transfers.list({ batch_id: 'trb_test_1', status: 'new', limit: 2 });
  assert.equal(page.data.length, 2);
  assert.match(f.calls[0].url, /\/transfers\?batch_id=trb_test_1&status=new&limit=2$/);
  const ids = [];
  for await (const t of ff.transfers.listAll({ batch_id: 'trb_test_1', limit: 2 })) ids.push(t.id);
  assert.deepEqual(ids, ['tr_test_2', 'tr_test_1', 'tr_test_0']);
  assert.match(f.calls[2].url, /starting_after=tr_test_1/);
});

test('listAll keeps a createdAt window on every page', async () => {
  const f = fakeFetch([
    { body: { object: 'list', data: [{ id: 'tr_test_3' }, { id: 'tr_test_2' }], has_more: true } },
    { body: { object: 'list', data: [{ id: 'tr_test_1' }], has_more: false } },
  ]);
  const ids = [];
  for await (const t of new FirstFlip(KEY, { fetch: f }).transfers.listAll({ created_from: '2026-11-04', created_before: '2026-11-05', limit: 2 })) ids.push(t.id);
  assert.deepEqual(ids, ['tr_test_3', 'tr_test_2', 'tr_test_1']);
  for (const call of f.calls) {
    assert.match(call.url, /created_from=2026-11-04/);
    assert.match(call.url, /created_before=2026-11-05/);
  }
  assert.match(f.calls[1].url, /starting_after=tr_test_2/);
});

test('an API error exposes the response headers, Request-Id included', async () => {
  const f = fakeFetch([{ status: 400, body: { error: { type: 'invalid_request_error', code: 'invalid_parameter', message: 'x', param: 'created_from' } }, headers: { 'request-id': 'req-123' } }]);
  const err = await new FirstFlip(KEY, { fetch: f }).transfers.list({ created_from: 'yesterday' }).then(() => null, (e) => e);
  assert.equal(err.code, 'invalid_parameter');
  assert.equal(err.param, 'created_from');
  assert.equal(err.headers['request-id'], 'req-123');
});

test('transfers.simulate posts the requested status', async () => {  const f = fakeFetch([{ body: { id: 'tr_test_1', status: 'successful' } }]);
  const out = await new FirstFlip(KEY, { fetch: f, baseUrl: 'https://example.test/v1' }).transfers.simulate('tr_test_1', 'successful');
  assert.equal(out.status, 'successful');
  assert.equal(f.calls[0].url, 'https://example.test/v1/transfers/tr_test_1/simulate');
  assert.deepEqual(JSON.parse(f.calls[0].body), { status: 'successful' });
  assert.ok(f.calls[0].headers['Idempotency-Key']);
});

test('fx: quotes and trades hit the documented paths; writes are keyed, reads are not', async () => {
  const f = fakeFetch([
    { status: 201, body: { id: 'fxq_test_1', object: 'fx_quote', status: 'processing' } },
    { body: { id: 'fxq_test_1', object: 'fx_quote', status: 'processing' } },
    { body: { id: 'fxq_test_1', object: 'fx_quote', status: 'ready', quote: {} } },
    { status: 201, body: { id: 'fxt_test_1', object: 'fx_trade', status: 'new' } },
    { body: { id: 'fxt_test_1', object: 'fx_trade', status: 'new' } },
    { body: { id: 'fxt_test_1', object: 'fx_trade', status: 'settled' } },
  ]);
  const ff = new FirstFlip(KEY, { fetch: f, baseUrl: 'https://example.test/v1' });
  const quote = { base_currency: 'NGN', target_currency: 'USD', quantity: 160000, scenario: 'processing' };
  await ff.fx.createQuote(quote);
  assert.equal((await ff.fx.retrieveQuote('fxq_test_1')).status, 'processing');
  assert.equal((await ff.fx.simulateQuote('fxq_test_1', 'ready')).status, 'ready');
  await ff.fx.createTrade({ quote_id: 'fxq_test_1' }, { idempotencyKey: 'trade-1' });
  await ff.fx.retrieveTrade('fxt_test_1');
  assert.equal((await ff.fx.simulateTrade('fxt_test_1', 'settled')).status, 'settled');
  assert.deepEqual(f.calls.map((c) => [c.method, c.url.replace('https://example.test/v1', '')]), [
    ['POST', '/fx/quotes'],
    ['GET', '/fx/quotes/fxq_test_1'],
    ['POST', '/fx/quotes/fxq_test_1/simulate'],
    ['POST', '/fx/trades'],
    ['GET', '/fx/trades/fxt_test_1'],
    ['POST', '/fx/trades/fxt_test_1/simulate'],
  ]);
  assert.deepEqual(JSON.parse(f.calls[0].body), quote);
  assert.deepEqual(JSON.parse(f.calls[2].body), { status: 'ready' });
  assert.deepEqual(JSON.parse(f.calls[5].body), { status: 'settled' });
  assert.equal(f.calls[3].headers['Idempotency-Key'], 'trade-1');
  assert.equal(f.calls[1].headers['Idempotency-Key'], undefined);
  assert.equal(f.calls[4].headers['Idempotency-Key'], undefined);
  for (const i of [0, 2, 3, 5]) assert.ok(f.calls[i].headers['Idempotency-Key'], 'every write is idempotent');
});

test('virtualAccounts: create, bulk, deactivate and simulate_payment', async () => {
  const f = fakeFetch([
    { status: 201, body: { id: 'va_test_1', object: 'virtual_account' } },
    { body: { id: 'va_test_1', object: 'virtual_account' } },
    { status: 201, body: { id: 'vab_test_1', object: 'virtual_account_batch', data: [] } },
    { body: { id: 'vab_test_1', object: 'virtual_account_batch', data: [] } },
    { body: { id: 'va_test_1', status: 'inactive' } },
    { status: 201, body: { id: 'vap_test_1', object: 'virtual_account_payment', status: 'reversed' } },
  ]);
  const ff = new FirstFlip(KEY, { fetch: f, baseUrl: 'https://example.test/v1' });
  const customer = { email: 'ada@example.com', first_name: 'Ada', last_name: 'Obi' };
  await ff.virtualAccounts.create({ customer, currency: 'NGN', type: 'dynamic', amount: 5000 });
  await ff.virtualAccounts.retrieve('va_test_1');
  const items = [{ customer }, { customer }];
  await ff.virtualAccounts.createBatch(items, { idempotencyKey: 'tenants-1' });
  await ff.virtualAccounts.retrieveBatch('vab_test_1');
  await ff.virtualAccounts.deactivate('va_test_1');
  assert.equal((await ff.virtualAccounts.simulatePayment('va_test_1', { amount: 4000, reference: 'pay-1' })).status, 'reversed');
  assert.deepEqual(f.calls.map((c) => [c.method, c.url.replace('https://example.test/v1', '')]), [
    ['POST', '/virtual_accounts'],
    ['GET', '/virtual_accounts/va_test_1'],
    ['POST', '/virtual_accounts/bulk'],
    ['GET', '/virtual_accounts/bulk/vab_test_1'],
    ['POST', '/virtual_accounts/va_test_1/deactivate'],
    ['POST', '/virtual_accounts/va_test_1/simulate_payment'],
  ]);
  assert.deepEqual(JSON.parse(f.calls[2].body), { accounts: items });
  assert.equal(f.calls[2].headers['Idempotency-Key'], 'tenants-1');
  assert.deepEqual(JSON.parse(f.calls[5].body), { amount: 4000, reference: 'pay-1' });
  assert.ok(f.calls[4].headers['Idempotency-Key']);
  assert.equal(f.calls[1].headers['Idempotency-Key'], undefined);
  assert.equal(f.calls[3].headers['Idempotency-Key'], undefined);
});

test('verifications: BVN consent, retrieve, then simulate the provider outcome', async () => {
  const f = fakeFetch([
    { status: 201, body: { id: 'bvn_test_1', object: 'bvn_verification', status: 'consent_pending' } },
    { body: { id: 'bvn_test_1', object: 'bvn_verification', status: 'consent_pending' } },
    { body: { id: 'bvn_test_1', object: 'bvn_verification', status: 'declined' } },
  ]);
  const ff = new FirstFlip(KEY, { fetch: f, baseUrl: 'https://example.test/v1' });
  const params = { bvn: '22222222222', first_name: 'Ada', last_name: 'Obi', redirect_url: 'https://example.com/kyc' };
  await ff.verifications.createBvn(params);
  await ff.verifications.retrieveBvn('bvn_test_1');
  assert.equal((await ff.verifications.simulateBvn('bvn_test_1', 'declined')).status, 'declined');
  assert.deepEqual(f.calls.map((c) => [c.method, c.url.replace('https://example.test/v1', '')]), [
    ['POST', '/verifications/bvn'],
    ['GET', '/verifications/bvn/bvn_test_1'],
    ['POST', '/verifications/bvn/bvn_test_1/simulate'],
  ]);
  assert.deepEqual(JSON.parse(f.calls[0].body), params);
  assert.deepEqual(JSON.parse(f.calls[2].body), { outcome: 'declined' });
  assert.ok(f.calls[0].headers['Idempotency-Key']);
  assert.equal(f.calls[1].headers['Idempotency-Key'], undefined);
  assert.ok(f.calls[2].headers['Idempotency-Key']);
});

test('verifications.resolveBank resolves a name before a payout', async () => {
  const f = fakeFetch([{ body: { object: 'bank_account_verification', account_name: 'FIRSTFLIP TEST CUSTOMER' } }]);
  const ff = new FirstFlip(KEY, { fetch: f, baseUrl: 'https://example.test/v1' });
  const out = await ff.verifications.resolveBank({ country: 'NG', type: 'bank_account', account_bank: '044', account_number: '0690000032' });
  assert.equal(out.account_name, 'FIRSTFLIP TEST CUSTOMER');
  assert.equal(f.calls[0].url, 'https://example.test/v1/verifications/bank_account');
  assert.equal(f.calls[0].method, 'POST');
  assert.ok(f.calls[0].headers['Idempotency-Key']);
});

test('otps: pricing is a read; create, retrieve and validate are keyed writes', async () => {
  const f = fakeFetch([
    { body: { object: 'otp_pricing', currency: 'NGN', data: [{ medium: 'sms', unit_amount: 8 }] } },
    { status: 201, body: { id: 'otp_test_1', object: 'otp', status: 'pending', sandbox: { code: '123456', delivered: false } } },
    { body: { id: 'otp_test_1', object: 'otp', status: 'verified' } },
  ]);
  const ff = new FirstFlip(KEY, { fetch: f, baseUrl: 'https://example.test/v1' });
  const price = await ff.otps.pricing();
  assert.equal(price.data[0].unit_amount, 8);
  const created = await ff.otps.create({ customer: { name: 'Ada Obi', phone: '+2348030000001' } });
  assert.equal(created.sandbox.code, '123456');
  const done = await ff.otps.validate('otp_test_1', '123456');
  assert.equal(done.status, 'verified');
  assert.deepEqual(f.calls.map((c) => [c.method, c.url.replace('https://example.test/v1', '')]), [
    ['GET', '/otps/pricing'],
    ['POST', '/otps'],
    ['POST', '/otps/otp_test_1/validate'],
  ]);
  assert.equal(f.calls[0].headers['Idempotency-Key'], undefined);
  assert.ok(f.calls[1].headers['Idempotency-Key']);
  assert.deepEqual(JSON.parse(f.calls[2].body), { otp: '123456' });
  assert.ok(f.calls[2].headers['Idempotency-Key']);
});

test('assistant.ask asks the question unkeyed, and retries a 503', async () => {
  const f = fakeFetch([
    { status: 503, body: { error: { type: 'api_error', code: 'assistant_unavailable', message: 'temporarily unavailable' } }, headers: { 'retry-after': '0' } },
    { body: { object: 'assistant_answer', answer: 'Use POST /v1/charges.', removed_claims: 0 } },
  ]);
  const ff = new FirstFlip(KEY, { fetch: f, baseUrl: 'https://example.test/v1' });
  const out = await ff.assistant.ask('How do I create a charge?');
  assert.equal(out.object, 'assistant_answer');
  assert.equal(out.answer, 'Use POST /v1/charges.');
  assert.deepEqual(f.calls.map((c) => [c.method, c.url.replace('https://example.test/v1', '')]), [
    ['POST', '/assistant'],
    ['POST', '/assistant'],
  ]);
  assert.deepEqual(JSON.parse(f.calls[1].body), { question: 'How do I create a charge?' });
  // POST /v1/assistant carries no idempotency middleware, so a key would promise a dedupe that does not exist.
  assert.equal(f.calls[0].headers['Idempotency-Key'], undefined);
});

test('webhooks.verify / constructEvent', () => {
  const secret = 'whsec_test';
  const body = JSON.stringify({ id: 'evt_1', type: 'charge.paid', data: { object: { id: 'ch_test_1' } } });
  const t = Math.floor(Date.now() / 1000);
  const header = `t=${t},v1=${crypto.createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;
  assert.equal(FirstFlip.webhooks.verify(body, header, secret), true);
  assert.equal(FirstFlip.webhooks.verify(Buffer.from(body), header, secret), true);
  assert.equal(FirstFlip.webhooks.verify(body + ' ', header, secret), false);
  assert.equal(FirstFlip.webhooks.verify(body, header, 'whsec_other'), false);
  assert.equal(FirstFlip.webhooks.verify(body, header, secret, { now: t + 301 }), false);
  assert.equal(FirstFlip.webhooks.constructEvent(body, header, secret).type, 'charge.paid');
  assert.throws(() => FirstFlip.webhooks.constructEvent(body, 'nope', secret), (e) => e.code === 'invalid_signature');
});

// The package ships .d.ts by hand and declares no dependencies, so no compiler runs in CI. This holds the
// declarations to the runtime: a method that ships without a type is invisible to a TypeScript caller.
function declaredMethods(source, namespace) {
  const start = source.indexOf(`  ${namespace}: {`);
  assert.notEqual(start, -1, `${namespace} is not declared`);
  const block = source.slice(start, source.indexOf('\n  };', start));
  return [...block.matchAll(/^ {4}(\w+)\(/gm)].map((m) => m[1]);
}

function interfaceBody(source, name) {
  const start = source.indexOf(`export interface ${name} {`);
  assert.notEqual(start, -1, `${name} is not declared`);
  return source.slice(start, source.indexOf('}', start));
}

test('index.d.ts declares every method the runtime exposes', () => {
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'src', 'index.d.ts'), 'utf8');
  const ff = new FirstFlip(KEY, { fetch: fakeFetch([]) });
  for (const namespace of ['charges', 'paymentLinks', 'subaccounts', 'transfers', 'fx', 'virtualAccounts', 'verifications', 'otps', 'assistant', 'cards']) {
    assert.deepEqual(declaredMethods(source, namespace).sort(), Object.keys(ff[namespace]).sort(), namespace);
  }
});

test('every list type accepts the created window, transfers included', () => {
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'src', 'index.d.ts'), 'utf8');
  for (const name of ['ChargeListParams', 'PaymentLinkListParams', 'SubAccountListParams', 'TransferListParams', 'CardListParams', 'CardTransactionListParams']) {
    const body = interfaceBody(source, name);
    assert.match(body, /created_from\?: string/, name);
    assert.match(body, /created_before\?: string/, name);
  }
});

// The decline codes are the one part of the card surface a caller branches on, and the contract states them twice
// in prose while `index.d.ts` carried its own hand-written copy. Nothing in this suite could see the two disagree —
// so `over_tenant_monthly_limit` was shipped in the spec and the union would have stayed five with a green run.
// Every published list ends with a code in backticks and then a full stop, which is the sentence boundary this reads.
function publishedCodes(marker) {
  const spec = fs.readFileSync(path.join(specRoot(), 'openapi.yaml'), 'utf8');
  const from = spec.indexOf(marker);
  assert.notEqual(from, -1, `openapi.yaml no longer says "${marker}" — re-measure this pin against the spec`);
  const rest = spec.slice(from + marker.length);
  const end = rest.indexOf('`.');
  assert.notEqual(end, -1, `nothing is enumerated after "${marker}"`);
  return [...rest.slice(0, end + 1).matchAll(/`([a-z_]+)`/g)].map((m) => m[1]);
}

function declaredDeclineCodes() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.d.ts'), 'utf8');
  const start = source.indexOf('export type CardDeclineCode =');
  assert.notEqual(start, -1, 'CardDeclineCode is no longer declared');
  return [...source.slice(start, source.indexOf(';', start)).matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
}

test('the spec states the decline list once and identically in both places it appears', () => {
  const order = publishedCodes('decided in this order:');
  const field = publishedCodes('logic should branch on:');
  assert.equal(order.length, 6, `the authorization text enumerates ${order.length} codes, not 6 — re-measure before trusting this pin`);
  assert.deepEqual(field, order, 'the CardTransaction field and the authorization order disagree about which codes exist');
});

test('index.d.ts names every decline code the contract publishes, in the published order', () => {
  assert.deepEqual(declaredDeclineCodes(), publishedCodes('decided in this order:'));
});

const CARD = 'card_test_3a4b5c6d7e8f90122a3b4c5d';

test('cards: the funded lifecycle hits the documented paths and every write is keyed', async () => {
  const f = fakeFetch([
    { status: 201, body: { id: CARD, object: 'card', status: 'active', balance: 0 } },
    { status: 200, body: { id: CARD, balance: 250 } },
    { status: 200, body: { id: CARD, balance: 150 } },
    { status: 200, body: { id: CARD, status: 'closed' } },
  ]);
  const ff = new FirstFlip(KEY, { fetch: f, baseUrl: 'https://example.test/v1' });
  const issued = await ff.cards.create({ customer: { email: 'a@b.co', first_name: 'Ada', last_name: 'L' }, reference: 'customer_8842_usd' });
  assert.equal(issued.id, CARD);
  await ff.cards.fund(CARD, { amount: 250 });
  await ff.cards.withdraw(CARD, { amount: 100 });
  await ff.cards.close(CARD, { reason: 'Customer asked us to' });
  assert.deepEqual(f.calls.map((c) => [c.method, c.url.replace('https://example.test/v1', '')]), [
    ['POST', '/cards'],
    ['POST', `/cards/${CARD}/fund`],
    ['POST', `/cards/${CARD}/withdraw`],
    ['POST', `/cards/${CARD}/close`],
  ]);
  assert.deepEqual(JSON.parse(f.calls[0].body), { customer: { email: 'a@b.co', first_name: 'Ada', last_name: 'L' }, reference: 'customer_8842_usd' });
  assert.deepEqual(JSON.parse(f.calls[1].body), { amount: 250 });
  assert.deepEqual(JSON.parse(f.calls[3].body), { reason: 'Customer asked us to' });
  assert.ok(f.calls.every((c) => c.headers['Idempotency-Key']), 'no unkeyed card write');
});

test('cards.freeze with no reason sends no body — an empty {} would be a different request', async () => {
  const f = fakeFetch([{ body: { id: CARD, status: 'frozen' } }, { body: { id: CARD, status: 'active' } }]);
  const ff = new FirstFlip(KEY, { fetch: f });
  await ff.cards.freeze(CARD);
  await ff.cards.unfreeze(CARD);
  assert.equal(f.calls[0].body, undefined, 'freeze() must not post "{}"');
  assert.equal(f.calls[0].headers['Content-Type'], undefined);
  assert.equal(f.calls[1].body, undefined, 'unfreeze takes no body at all');
  assert.ok(f.calls[0].headers['Idempotency-Key'] && f.calls[1].headers['Idempotency-Key']);
});

test('cards.retrieve, list and listTransactions are reads: no key, filters encoded', async () => {
  const f = fakeFetch([
    { body: { id: CARD } },
    { body: { object: 'list', data: [], has_more: false } },
    { body: { object: 'list', data: [], has_more: false } },
  ]);
  const ff = new FirstFlip(KEY, { fetch: f });
  await ff.cards.retrieve(CARD);
  await ff.cards.list({ limit: 10 });
  await ff.cards.listTransactions(CARD, { type: 'authorization', status: 'declined' });
  assert.deepEqual(f.calls.map((c) => c.url.replace('https://api.firstflip.ng/v1', '')), [
    `/cards/${CARD}`,
    '/cards?limit=10',
    `/cards/${CARD}/transactions?type=authorization&status=declined`,
  ]);
  assert.ok(f.calls.every((c) => c.headers['Idempotency-Key'] === undefined), 'a read must not claim an idempotency key');
});

test('cards.listAll walks every card page with starting_after', async () => {
  const f = fakeFetch([
    { body: { object: 'list', data: [{ id: 'card_test_1' }], has_more: true } },
    { body: { object: 'list', data: [{ id: 'card_test_2' }], has_more: false } },
  ]);
  const seen = [];
  for await (const card of new FirstFlip(KEY, { fetch: f }).cards.listAll({ limit: 1 })) seen.push(card.id);
  assert.deepEqual(seen, ['card_test_1', 'card_test_2']);
  assert.equal(f.calls[1].url.includes('starting_after=card_test_1'), true);
});

test('cards.updateSpendLimits passes null through — null means "no ceiling", omission means "leave it"', async () => {
  const f = fakeFetch([{ body: { id: CARD } }, { body: { id: CARD, status: 'approved' } }]);
  const ff = new FirstFlip(KEY, { fetch: f });
  await ff.cards.updateSpendLimits(CARD, { daily_limit: 500, monthly_limit: null });
  await ff.cards.simulateAuthorization(CARD, { amount: 42.5, merchant: 'BLUE ORIGIN TRAVEL' });
  assert.deepEqual(JSON.parse(f.calls[0].body), { daily_limit: 500, monthly_limit: null });
  assert.equal(f.calls[0].url.endsWith(`/cards/${CARD}/spend_limits`), true);
  assert.deepEqual(JSON.parse(f.calls[1].body), { amount: 42.5, merchant: 'BLUE ORIGIN TRAVEL' });
  assert.equal(f.calls[1].url.endsWith(`/cards/${CARD}/simulate_authorization`), true);
});

// The README points a new developer at this client and names exactly which documented operations the client covers.
// Nothing held that promise: an operation added to the spec could ship with no method, and a method could call a path
// the spec does not publish. This reads the spec (all 57 documented operations, service paths from the shared JSON) and
// compares both directions. One family sits outside the typed client:
//   * the four hosted pay/landing pages — browser endpoints a server SDK has no business fetching.
// Everything else must be callable. That is the whole point of the pin: until this round it carried a second
// exclusion for the 11 virtual-card routes, and because the carve-out was a hard-coded list the card surface could
// (and did) ship and grow with no client method at all, while the suite stayed green. A gap you list is a gap you keep.
const METHODS = ['get', 'post', 'put', 'patch', 'delete'];
const HOSTED = /^\/sandbox\/(?:pay|l)\/\{token\}$/;

function specRoot() {
  let dir = path.join(__dirname, '..');
  for (let i = 0; i < 6; i += 1) {
    if (fs.existsSync(path.join(dir, 'openapi.yaml'))) return dir;
    dir = path.dirname(dir);
  }
  assert.fail('openapi.yaml not found above the SDK — the coverage pin needs the docs repo root');
}

function documentedOperations() {
  const root = specRoot();
  const ops = new Set();
  let inPaths = false;
  let current = null;
  for (const line of fs.readFileSync(path.join(root, 'openapi.yaml'), 'utf8').split('\n')) {
    if (/^paths:/.test(line)) { inPaths = true; continue; }
    if (inPaths && /^\S/.test(line)) break;
    if (!inPaths) continue;
    const pathKey = line.match(/^ {2}(\/\S*):\s*$/);
    if (pathKey) { current = pathKey[1]; continue; }
    const method = line.match(/^ {4}(get|post|put|patch|delete):/);
    if (method && current) ops.add(`${method[1].toUpperCase()} ${current}`);
  }
  // The service operations live in the shared JSON and are `$ref`'d in, so the YAML scan above sees no method for them.
  const services = JSON.parse(fs.readFileSync(path.join(root, 'api', 'services.openapi.json'), 'utf8'));
  for (const [url, item] of Object.entries(services.paths)) {
    for (const method of Object.keys(item)) if (METHODS.includes(method)) ops.add(`${method.toUpperCase()} ${url}`);
  }
  return ops;
}

function sdkOperations() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.js'), 'utf8');
  const ops = new Set();
  for (const m of source.matchAll(/_request\(\s*'(GET|POST|PUT|PATCH|DELETE)',\s*([`'])([^`']+)\2/g)) {
    ops.add(`${m[1]} ${m[3].replace(/\$\{encodeURIComponent\(id\)\}/g, '{id}')}`);
  }
  for (const m of source.matchAll(/_paginate\('([^']+)'/g)) ops.add(`GET ${m[1]}`);
  return ops;
}

test('every documented operation is callable except the four hosted browser pages', () => {
  const documented = documentedOperations();
  const hosted = [...documented].filter((op) => HOSTED.test(op.split(' ')[1])).sort();
  assert.deepEqual(hosted, ['GET /sandbox/l/{token}', 'GET /sandbox/pay/{token}', 'POST /sandbox/l/{token}', 'POST /sandbox/pay/{token}'],
    'the hosted pages are browser endpoints, not client methods');
  const callable = new Set([...documented].filter((op) => !HOSTED.test(op.split(' ')[1])));
  assert.equal(callable.size, 53, 'the walker did not see the documented surface — re-measure before trusting this pin');
  // Named so a future exclusion cannot be silent: these 11 are why the pin exists.
  for (const op of [
    'GET /cards',
    'GET /cards/{id}',
    'GET /cards/{id}/transactions',
    'POST /cards',
    'POST /cards/{id}/close',
    'POST /cards/{id}/freeze',
    'POST /cards/{id}/fund',
    'POST /cards/{id}/simulate_authorization',
    'POST /cards/{id}/spend_limits',
    'POST /cards/{id}/unfreeze',
    'POST /cards/{id}/withdraw',
  ]) assert.ok(callable.has(op), `the card surface changed — ${op} is no longer documented`);
  const sdk = sdkOperations();
  const missing = [...callable].filter((op) => !sdk.has(op)).sort();
  const phantom = [...sdk].filter((op) => !callable.has(op)).sort();
  assert.deepEqual(missing, [], `documented but not callable: ${missing.join(', ')}`);
  assert.deepEqual(phantom, [], `SDK calls one path the spec does not publish: ${phantom.join(', ')}`);
});

// The sentence above the pin is a promise, and a promise prose cannot keep is the reason this test exists: the README
// claimed "the test suite fails if the card surface changes size without this README being updated together", and for
// one release round nothing read the README at all. So the copy is checked against the same measurement the coverage
// pin uses — a stale "42 of the 53" or a leftover "no SDK method yet" now reddens the suite on its own.
const COPY = [
  ['sdks/node README', path.join(__dirname, '..', 'README.md')],
  ['guides/cards.md', path.join(specRoot(), 'guides', 'cards.md')],
  ['guides/quickstart.md', path.join(specRoot(), 'guides', 'quickstart.md')],
  ['guides/agents.md', path.join(specRoot(), 'guides', 'agents.md')],
];
const STALE_CARD_CLAIMS = [
  [/no SDK method/i, 'claims the card routes are missing from the client'],
  [/no card method/i, 'claims the card routes are missing from the client'],
  [/not in the typed SDK/i, 'claims the card routes are missing from the client'],
  [/not in this SDK yet/i, 'claims the card routes are missing from the client'],
  [/does not cover cards/i, 'claims the card routes are missing from the client'],
  [/tools and REST only/i, 'claims the card routes are reachable only outside the client'],
];

test('the published copy states the coverage this pin just measured', () => {
  const callable = [...documentedOperations()].filter((op) => !HOSTED.test(op.split(' ')[1]));
  const total = callable.length;
  for (const [name, file] of COPY) {
    assert.ok(fs.existsSync(file), `${name} is gone — the copy pin lost the file it governs`);
    const source = fs.readFileSync(file, 'utf8');
    for (const claimed of source.matchAll(/(\d+) of the (\d+)(?: API-key)?/g)) {
      assert.equal(Number(claimed[1]), total, `${name} states ${claimed[0]} against a measured surface of ${total}`);
      assert.equal(Number(claimed[2]), total, `${name} states ${claimed[0]} against a measured surface of ${total}`);
    }
    for (const [pattern, why] of STALE_CARD_CLAIMS) {
      assert.ok(!pattern.test(source), `${name} still ${why}`);
    }
  }
  // And the card namespace is documented where a developer would look, not merely callable.
  const readme = fs.readFileSync(COPY[0][1], 'utf8');
  assert.match(readme, /firstflip\.cards\.create\(/, 'the README has no card example even though the client has the methods');
  for (const method of ['fund', 'withdraw', 'freeze', 'unfreeze', 'close', 'updateSpendLimits', 'simulateAuthorization', 'listTransactions']) {
    assert.ok(readme.includes(`firstflip.cards.${method}(`), `the README never documents firstflip.cards.${method}`);
  }
});
