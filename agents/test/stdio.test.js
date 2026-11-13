'use strict';
// The real stdio loop: spawn the server, speak newline-delimited JSON-RPC, get answers.
// No network: initialize / tools/list / ping only.
const { test } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const path = require('node:path');

test('stdio transport: initialize -> tools/list -> ping over the real process', async () => {
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'mcp-server.js')], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, FIRSTFLIP_SECRET_KEY: '' },
  });
  const responses = new Map();
  let buffer = '';
  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    let idx;
    while ((idx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      const msg = JSON.parse(line);
      responses.set(msg.id, msg);
    }
  });
  const send = (obj) => child.stdin.write(JSON.stringify(obj) + '\n');
  const waitFor = (id, timeoutMs = 5000) => new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      if (responses.has(id)) return resolve(responses.get(id));
      if (Date.now() - started > timeoutMs) return reject(new Error(`timeout waiting for response ${id}`));
      setTimeout(tick, 10);
    };
    tick();
  });
  try {
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } });
    const init = await waitFor(1);
    assert.equal(init.result.serverInfo.name, 'firstflip');
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const list = await waitFor(2);
    assert.equal(list.result.tools.length, 53);
    send({ jsonrpc: '2.0', id: 3, method: 'ping' });
    assert.deepEqual((await waitFor(3)).result, {});
  } finally {
    child.kill();
  }
});