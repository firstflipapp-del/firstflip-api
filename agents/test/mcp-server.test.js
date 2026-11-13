'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { handleRequest, toolListing, PROTOCOL_VERSION, SUPPORTED_PROTOCOL_VERSIONS } = require('../mcp-server.js');

const KEY = 'ffk_test_000000000000000000000000000000000000000000000000';
const ctx = (fetchImpl) => ({ env: { FIRSTFLIP_SECRET_KEY: KEY }, fetchImpl });
const call = (method, params, id = 1) => ({ jsonrpc: '2.0', id, method, params });

test('initialize answers protocol, tools capability and server info', async () => {
  const res = await handleRequest(call('initialize', { protocolVersion: '2024-11-05' }), ctx());
  assert.equal(res.result.capabilities.tools !== undefined, true);
  assert.equal(res.result.serverInfo.name, 'firstflip');
  assert.ok(res.result.instructions.includes('TEST MODE'));
});

test('tools/list returns 53 tools with honest annotations', async () => {
  const res = await handleRequest(call('tools/list'), ctx());
  assert.equal(res.result.tools.length, 53);
  const create = res.result.tools.find((t) => t.name === 'createCharge');
  assert.equal(create.annotations.readOnlyHint, false);
  assert.equal(create.annotations.idempotentHint, true);
  assert.equal(create.annotations.destructiveHint, true);
  assert.ok(create.inputSchema.required.includes('idempotency_key'));
  const get = res.result.tools.find((t) => t.name === 'getCharge');
  assert.equal(get.annotations.readOnlyHint, true);
  assert.equal(toolListing().length, 53);
});

test('tools/call createCharge: right URL, headers, body; result is structured text', async () => {
  let seen;
  const fetchImpl = async (url, init) => {
    seen = { url, init };
    return new Response(JSON.stringify({ id: 'ch_1', status: 'pending', hosted_url: 'https://api.firstflip.ng/v1/sandbox/pay/tok' }), {
      status: 201, headers: { 'Request-Id': 'req_1' },
    });
  };
  const res = await handleRequest(call('tools/call', { name: 'createCharge', arguments: { body: { amount: 25000, currency: 'NGN' }, idempotency_key: 'agent-retry-1' } }), ctx(fetchImpl));
  assert.equal(seen.url, 'https://api.firstflip.ng/v1/charges');
  assert.equal(seen.init.method, 'POST');
  assert.equal(seen.init.headers.Authorization, `Bearer ${KEY}`);
  assert.equal(seen.init.headers['Idempotency-Key'], 'agent-retry-1');
  assert.deepEqual(JSON.parse(seen.init.body), { amount: 25000, currency: 'NGN' });
  assert.equal(res.result.isError, false);
  const payload = JSON.parse(res.result.content[0].text);
  assert.equal(payload.status, 201);
  assert.equal(payload.request_id, 'req_1');
  assert.equal(payload.body.id, 'ch_1');
  assert.ok(!res.result.content[0].text.includes(KEY), 'key never appears in tool output');
});

test('tools/call surfaces API errors as isError with the canonical code', async () => {
  const fetchImpl = async () => new Response(JSON.stringify({ error: { type: 'invalid_request_error', code: 'amount_too_small', message: 'Amount is below the minimum charge.', param: 'amount' } }), { status: 422 });
  const res = await handleRequest(call('tools/call', { name: 'createCharge', arguments: { body: { amount: 1, currency: 'NGN' }, idempotency_key: 'rejected-amount-1' } }), ctx(fetchImpl));
  assert.equal(res.result.isError, true);
  const payload = JSON.parse(res.result.content[0].text);
  assert.equal(payload.status, 422);
  assert.equal(payload.body.error.code, 'amount_too_small');
});

test('protocol negotiation never claims an unsupported version', async () => {
  for (const version of SUPPORTED_PROTOCOL_VERSIONS) {
    assert.equal((await handleRequest(call('initialize', { protocolVersion: version }), ctx())).result.protocolVersion, version);
  }
  assert.equal((await handleRequest(call('initialize', { protocolVersion: '9999-01-01' }), ctx())).result.protocolVersion, PROTOCOL_VERSION);
});

test('live initialization is explicit; tool notifications and missing retry keys perform zero requests', async () => {
  let requests = 0;
  const live = { env: { FIRSTFLIP_SECRET_KEY: 'ffk_live_000000000000000000000000000000000000000000000000' }, fetchImpl: async () => { requests++; throw new Error('must not call'); } };
  const init = await handleRequest(call('initialize', {}), live);
  assert.match(init.result.instructions, /LIVE KEY/);
  assert.doesNotMatch(init.result.instructions, /TEST MODE/);
  const params = { name: 'createPaymentLink', arguments: { body: { amount: 25000, currency: 'NGN' } } };
  const noKey = await handleRequest(call('tools/call', params), live);
  assert.equal(noKey.result.isError, true);
  assert.match(noKey.result.content[0].text, /idempotency_key is required/);
  assert.equal(await handleRequest({ jsonrpc: '2.0', method: 'tools/call', params: { ...params, arguments: { ...params.arguments, idempotency_key: 'no-notification-spend' } } }, live), null);
  assert.equal(requests, 0);
});

test('ambiguous network outcomes return the same retry key on every attempt', async () => {
  const seen = [];
  const down = ctx(async (_url, init) => { seen.push(init.headers['Idempotency-Key']); throw new Error('network interrupted'); });
  const params = { name: 'createCharge', arguments: { body: { amount: 25000, currency: 'NGN' }, idempotency_key: 'purchase-order-42' } };
  for (let i = 0; i < 2; i++) {
    const res = await handleRequest(call('tools/call', params), down);
    const payload = JSON.parse(res.result.content[0].text);
    assert.equal(payload.idempotency_key, 'purchase-order-42');
    assert.equal(payload.status, 0);
    assert.equal(res.result.isError, true);
  }
  assert.deepEqual(seen, ['purchase-order-42', 'purchase-order-42']);
});

test('usage problems are readable tool errors; protocol problems are JSON-RPC errors', async () => {
  const noKey = await handleRequest(call('tools/call', { name: 'getCharge', arguments: { id: 'x' } }), { env: {} });
  assert.equal(noKey.result.isError, true);
  assert.ok(noKey.result.content[0].text.includes('FIRSTFLIP_SECRET_KEY'));
  const badArg = await handleRequest(call('tools/call', { name: 'getCharge', arguments: {} }), ctx());
  assert.equal(badArg.result.isError, true);
  assert.ok(badArg.result.content[0].text.includes('Missing required argument'));
  const unknown = await handleRequest(call('nope'), ctx());
  assert.equal(unknown.error.code, -32601);
  const unknownTool = await handleRequest(call('tools/call', { name: 'dropDatabase', arguments: {} }), ctx());
  assert.equal(unknownTool.result.isError, true);
  assert.ok(unknownTool.result.content[0].text.includes('Unknown operation'));
});

test('notifications get no response; ping answers empty', async () => {
  assert.equal(await handleRequest({ jsonrpc: '2.0', method: 'notifications/initialized' }, ctx()), null);
  const pong = await handleRequest(call('ping'), ctx());
  assert.deepEqual(pong.result, {});
});
