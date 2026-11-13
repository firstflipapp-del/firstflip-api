'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { run } = require('../firstflip-cli.js');

const KEY = 'ffk_test_000000000000000000000000000000000000000000000000';
function harness(fetchImpl) {
  const lines = { out: [], err: [] };
  const ctx = {
    env: { FIRSTFLIP_SECRET_KEY: KEY },
    fetchImpl,
    stdout: (s) => lines.out.push(s),
    stderr: (s) => lines.err.push(s),
  };
  return { lines, ctx };
}

test('list prints all 53 operations with scope', async () => {
  const { lines, ctx } = harness();
  assert.equal(await run(['list'], ctx), 0);
  assert.equal(lines.out.join('').trim().split('\n').length, 53);
  assert.ok(lines.out.join('').includes('createCharge'));
  assert.ok(lines.out.join('').includes('charges:write'));
});

test('describe shows schema and the published example', async () => {
  const { lines, ctx } = harness();
  assert.equal(await run(['describe', 'createCharge'], ctx), 0);
  const doc = JSON.parse(lines.out.join(''));
  assert.equal(doc.scope, 'charges:write');
  assert.equal(doc.bodyExample.currency, 'NGN');
});

test('call: body JSON on stdout, status on stderr, exit 0 on 2xx', async () => {
  let seen;
  const fetchImpl = async (url, init) => {
    seen = { url, init };
    return new Response('{"id":"ch_1","status":"pending"}', { status: 201, headers: { 'Request-Id': 'req_7' } });
  };
  const { lines, ctx } = harness(fetchImpl);
  const code = await run(['call', 'createCharge', '--body', '{"amount":25000,"currency":"NGN"}', '--idempotency-key', 'cli-1'], ctx);
  assert.equal(code, 0);
  assert.equal(seen.url, 'https://api.firstflip.ng/v1/charges');
  assert.equal(seen.init.headers['Idempotency-Key'], 'cli-1');
  assert.deepEqual(JSON.parse(lines.out.join('')), { id: 'ch_1', status: 'pending' });
  assert.ok(lines.err.join('').includes('HTTP 201'));
  assert.ok(lines.err.join('').includes('req_7'));
});

test('bare operation name works; path flags map to the URL', async () => {
  let seen;
  const { ctx } = harness(async (url) => { seen = url; return new Response('{"id":"ch_1"}', { status: 200 }); });
  assert.equal(await run(['getCharge', '--id', 'ch_1'], ctx), 0);
  assert.equal(seen, 'https://api.firstflip.ng/v1/charges/ch_1');
});

test('API error exits 1; usage/config errors exit 2', async () => {
  const h1 = harness(async () => new Response('{"error":{"code":"not_found","message":"No such charge."}}', { status: 404 }));
  assert.equal(await run(['getCharge', '--id', 'ch_x'], h1.ctx), 1);
  assert.ok(h1.lines.out.join('').includes('not_found'));
  const h2 = harness();
  assert.equal(await run(['getCharge'], h2.ctx), 2); // missing --id
  const h3 = harness();
  assert.equal(await run(['getCharge', '--id', 'x'], { ...h3.ctx, env: {} }), 2); // no key
  assert.ok(h3.lines.err.join('').includes('FIRSTFLIP_SECRET_KEY'));
  assert.equal(await run(['noSuchOp'], harness().ctx), 2);
});

test('bad JSON body and unknown flags are usage errors', async () => {
  assert.equal(await run(['createCharge', '--body', '{oops'], harness().ctx), 2);
  assert.equal(await run(['listCharges', '--wat', '1'], harness().ctx), 2);
});

test('help exits 0 and never calls the network', async () => {
  const { lines, ctx } = harness(async () => { throw new Error('network must not be touched'); });
  assert.equal(await run(['--help'], ctx), 0);
  assert.ok(lines.err.join('').includes('FIRSTFLIP_SECRET_KEY'));
});