'use strict';
// The generated catalog must stay the contract: 53 API-key operations, clean JSON Schemas,
// no unresolved refs, no OpenAPI-only keywords, no browser-only hosted pages.
const { test } = require('node:test');
const assert = require('node:assert');
const { loadTools, getTool, DEFAULT_BASE_URL } = require('../lib.js');

const tools = loadTools();

test('53 unique tools, one per API-key operation', () => {
  assert.equal(tools.length, 53);
  assert.equal(new Set(tools.map((t) => t.name)).size, 53);
  assert.equal(DEFAULT_BASE_URL, 'https://api.firstflip.ng/v1');
});

test('every tool carries the contract metadata an agent needs', () => {
  for (const t of tools) {
    assert.match(t.name, /^[a-zA-Z][a-zA-Z0-9]*$/, t.name);
    assert.ok(t.description.length > 20, `${t.name} description`);
    assert.ok(t.description.includes(t.scope), `${t.name} names its scope`);
    assert.ok(t.description.includes('live execution depends on business eligibility and enabled service gates'), `${t.name} does not promise live eligibility`);
    assert.equal(t.inputSchema.type, 'object');
    assert.equal(t.inputSchema.additionalProperties, false);
    assert.ok(['GET', 'POST'].includes(t.method), t.method);
    assert.ok(t.path.startsWith('/'), t.path);
    assert.ok(t.scope, t.name);
    // The contract requires Idempotency-Key on every write except askAssistant (documented exception:
    // the assistant answers a question, it creates nothing, so there is nothing to replay).
    assert.equal(t.idempotencyRequired, t.method === 'POST' && t.name !== 'askAssistant', `${t.name} idempotency`);
  }
});

test('hosted HTML pages are excluded (browser endpoints, not agent tools)', () => {
  assert.ok(!tools.some((t) => t.path.startsWith('/sandbox/')));
  assert.ok(!tools.some((t) => t.name === 'showHostedPayPage'));
});

test('schemas are fully resolved JSON Schema: no $ref, no x- keys, no OpenAPI-only keywords', () => {
  const banned = new Set(['$ref', 'example', 'externalDocs', 'discriminator', 'xml', 'readOnly', 'writeOnly', 'nullable']);
  const walk = (node, trail) => {
    if (Array.isArray(node)) return node.forEach((n, i) => walk(n, `${trail}[${i}]`));
    if (!node || typeof node !== 'object') return;
    for (const [k, v] of Object.entries(node)) {
      assert.ok(!banned.has(k) && !k.startsWith('x-'), `${trail}.${k} is not agent-safe JSON Schema`);
      walk(v, `${trail}.${k}`);
    }
  };
  for (const t of tools) walk(t.inputSchema, t.name);
});

test('createCharge: required body, currency enum, published example', () => {
  const t = getTool('createCharge');
  assert.deepEqual(t.inputSchema.required, ['body']);
  const body = t.inputSchema.properties.body;
  assert.deepEqual(body.required, ['amount', 'currency']);
  assert.deepEqual(body.properties.currency.enum, ['NGN', 'USD']);
  assert.equal(body.properties.pay_asset.default, 'USDT');
  assert.equal(t.bodyExample.amount, 25000);
  assert.equal(t.successStatus, 201);
});

test('path and query params are top-level arguments', () => {
  const t = getTool('getCharge');
  assert.ok(t.inputSchema.properties.id);
  assert.deepEqual(t.inputSchema.required, ['id']);
  const list = getTool('listCharges');
  assert.ok(list.inputSchema.properties.limit);
  assert.ok(list.inputSchema.properties.starting_after);
  assert.ok(!list.inputSchema.required.includes('limit'));
});

test('writes expose an optional idempotency_key; reads do not', () => {
  assert.ok(getTool('createCharge').inputSchema.properties.idempotency_key);
  assert.ok(!getTool('createCharge').inputSchema.required.includes('idempotency_key'));
  assert.ok(!getTool('listCharges').inputSchema.properties.idempotency_key);
});
