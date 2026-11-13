'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { getTool, buildRequest, executeRequest, redact, UsageError } = require('../lib.js');

const KEY = 'ffk_test_000000000000000000000000000000000000000000000000';

test('buildRequest: path substitution, encoding, bearer header', () => {
  const req = buildRequest(getTool('getCharge'), { id: 'ch_a/b c' }, { secretKey: KEY });
  assert.equal(req.url, 'https://api.firstflip.ng/v1/charges/ch_a%2Fb%20c');
  assert.equal(req.method, 'GET');
  assert.equal(req.headers.Authorization, `Bearer ${KEY}`);
  assert.equal(req.headers['Idempotency-Key'], undefined);
});

test('buildRequest: query params coerce and append', () => {
  const req = buildRequest(getTool('listCharges'), { limit: '10', status: 'paid' }, { secretKey: KEY });
  const u = new URL(req.url);
  assert.equal(u.searchParams.get('limit'), '10');
  assert.equal(u.searchParams.get('status'), 'paid');
});

test('buildRequest: auto Idempotency-Key on writes, explicit key honored', () => {
  const auto = buildRequest(getTool('createCharge'), { body: { amount: 25000, currency: 'NGN' } }, { secretKey: KEY });
  assert.match(auto.headers['Idempotency-Key'], /^[0-9a-f-]{36}$/);
  const explicit = buildRequest(getTool('createCharge'), { body: { amount: 1, currency: 'NGN' }, idempotency_key: 'retry-1' }, { secretKey: KEY });
  assert.equal(explicit.headers['Idempotency-Key'], 'retry-1');
  assert.equal(explicit.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(explicit.body), { amount: 1, currency: 'NGN' });
});

test('buildRequest: missing key, missing required arg, unknown arg, bad enum all fail clearly', () => {
  assert.throws(() => buildRequest(getTool('getCharge'), { id: 'x' }, {}), UsageError);
  assert.throws(() => buildRequest(getTool('getCharge'), {}, { secretKey: KEY }), /Missing required argument "id"/);
  assert.throws(() => buildRequest(getTool('getCharge'), { id: 'x', nope: 1 }, { secretKey: KEY }), /Unknown argument "nope"/);
  assert.throws(() => buildRequest(getTool('listCharges'), { status: 'bogus' }, { secretKey: KEY }), /must be one of/);
  assert.throws(() => buildRequest(getTool('listCharges'), { limit: 'abc' }, { secretKey: KEY }), /must be a integer|must be a number/);
});

test('buildRequest: body rejected on bodyless operations; base URL override guarded', () => {
  assert.throws(() => buildRequest(getTool('getCharge'), { id: 'x', body: {} }, { secretKey: KEY }), /Unknown argument "body"/);
  assert.throws(() => buildRequest(getTool('getCharge'), { id: 'x' }, { secretKey: KEY, baseUrl: 'http://evil.example' }), /https/);
  const local = buildRequest(getTool('getCharge'), { id: 'x' }, { secretKey: KEY, baseUrl: 'http://localhost:3000/v1' });
  assert.equal(local.url, 'http://localhost:3000/v1/charges/x');
});

test('executeRequest: parses JSON, captures request id and rate headers', async () => {
  const fetchImpl = async () => new Response(JSON.stringify({ id: 'ch_1', status: 'pending' }), {
    status: 201, headers: { 'Request-Id': 'req_9', 'X-RateLimit-Remaining': '59', 'Content-Type': 'application/json' },
  });
  const r = await executeRequest({ url: 'https://api.firstflip.ng/v1/charges', method: 'POST', headers: {}, body: '{}' }, { fetchImpl });
  assert.equal(r.status, 201);
  assert.equal(r.ok, true);
  assert.equal(r.requestId, 'req_9');
  assert.equal(r.rateLimitRemaining, 59);
  assert.equal(r.body.id, 'ch_1');
});

test('executeRequest: 429 carries retry_after; network failure is a connection_error, not a throw', async () => {
  const limited = await executeRequest({ url: 'https://x', method: 'GET', headers: {} }, {
    fetchImpl: async () => new Response('{"error":{"code":"rate_limited"}}', { status: 429, headers: { 'Retry-After': '2' } }),
  });
  assert.equal(limited.ok, false);
  assert.equal(limited.retryAfter, '2');
  const down = await executeRequest({ url: 'https://x', method: 'GET', headers: {} }, {
    fetchImpl: async () => { throw new Error('ECONNREFUSED'); },
  });
  assert.equal(down.status, 0);
  assert.equal(down.body.error.code, 'connection_error');
});

test('redact removes the key everywhere it appears', () => {
  assert.equal(redact(`key=${KEY} and again ${KEY}`, KEY), 'key=[redacted] and again [redacted]');
});

test('an explicitly empty idempotency key is refused rather than replaced', () => {
  for (const value of ['', ' ', null]) {
    assert.throws(() => buildRequest(getTool('createCharge'), { body: { amount: 1, currency: 'NGN' }, idempotency_key: value }, { secretKey: KEY }), /nonempty string/);
  }
});
