#!/usr/bin/env node
'use strict';
// firstflip-mcp — the FirstFlip API as MCP tools for AI coding agents.
// Zero dependencies; Node 18+. Speaks JSON-RPC 2.0 over stdio (newline-delimited), the MCP
// stdio transport. Every tool is one published /v1 operation from agents/tools.json, which is
// generated from openapi.yaml — the server cannot call a path the contract does not publish.
//
// Config (environment):
//   FIRSTFLIP_SECRET_KEY   required to call a tool; ffk_test_… (test) — never logged, never an argument
//   FIRSTFLIP_BASE_URL     optional; defaults to the published sandbox base
//   FIRSTFLIP_TIMEOUT_MS   optional; default 30000
//
// The API enforces key mode, business eligibility, scopes and service gates. MCP writes require
// an explicit Idempotency-Key so retrying identical tool arguments preserves the same operation.

const readline = require('node:readline');
const { loadTools, getTool, buildRequest, executeRequest, redact, UsageError, contractVersion } = require('./lib.js');

const SUPPORTED_PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const PROTOCOL_VERSION = SUPPORTED_PROTOCOL_VERSIONS[0];
const SERVER_INFO = { name: 'firstflip', version: require('./package.json').version };

function modeDescription(env = {}) {
  if (env.FIRSTFLIP_SECRET_KEY?.startsWith('ffk_test_')) return 'TEST MODE: test keys simulate supported operations.';
  if (env.FIRSTFLIP_SECRET_KEY?.startsWith('ffk_live_')) return 'LIVE KEY: operations may affect real funds or data when their live service gates are enabled. Obtain the user\'s approval before a write.';
  return 'No API key configured. Tool discovery is public; tool calls require your business API key.';
}

function toolListing() {
  return loadTools().map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.idempotencyRequired ? {
      ...t.inputSchema,
      required: [...(t.inputSchema.required || []), 'idempotency_key'],
    } : t.inputSchema,
    annotations: {
      title: `${t.method} ${t.path}`,
      readOnlyHint: t.readOnly,
      destructiveHint: !t.readOnly, // conservative across test and live keys; writes can alter business data
      idempotentHint: t.idempotencyRequired || t.readOnly,
      openWorldHint: true,
    },
  }));
}

async function callTool(params, ctx) {
  const tool = getTool(params?.name);
  const args = params?.arguments || {};
  if (tool.idempotencyRequired && (typeof args.idempotency_key !== 'string' || !args.idempotency_key.trim())) {
    throw new UsageError('idempotency_key is required for this write. Choose one key per logical operation and reuse it with the same arguments after a timeout or retry.');
  }
  const secretKey = ctx.env.FIRSTFLIP_SECRET_KEY;
  const req = buildRequest(tool, args, {
    secretKey,
    baseUrl: ctx.env.FIRSTFLIP_BASE_URL,
    timeoutMs: Number(ctx.env.FIRSTFLIP_TIMEOUT_MS) || undefined,
  });
  const result = await executeRequest(req, {
    fetchImpl: ctx.fetchImpl,
    timeoutMs: Number(ctx.env.FIRSTFLIP_TIMEOUT_MS) || undefined,
  });
  const payload = {
    status: result.status,
    request_id: result.requestId,
    ...(req.headers['Idempotency-Key'] ? { idempotency_key: req.headers['Idempotency-Key'] } : {}),
    ...(result.retryAfter !== undefined ? { retry_after: result.retryAfter } : {}),
    ...(result.rateLimitRemaining !== undefined ? { rate_limit_remaining: result.rateLimitRemaining } : {}),
    body: result.body,
  };
  return {
    content: [{ type: 'text', text: redact(JSON.stringify(payload, null, 2), secretKey) }],
    isError: !result.ok,
  };
}

// One JSON-RPC message in, one response out (null for notifications). Exported for tests.
async function handleRequest(msg, ctx = { env: process.env }) {
  if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
    return { jsonrpc: '2.0', id: msg?.id ?? null, error: { code: -32600, message: 'Invalid Request' } };
  }
  if (msg.id === null || (msg.id !== undefined && typeof msg.id !== 'string' && !Number.isInteger(msg.id))) {
    return { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } };
  }
  const isNotification = msg.id === undefined;
  // A tool call is a request, never a notification. Do not perform unanswerable work.
  if (isNotification) return null;
  const reply = (result) => (isNotification ? null : { jsonrpc: '2.0', id: msg.id, result });
  const fail = (code, message) => (isNotification ? null : { jsonrpc: '2.0', id: msg.id, error: { code, message } });

  try {
    switch (msg.method) {
      case 'initialize':
        return reply({
          protocolVersion: SUPPORTED_PROTOCOL_VERSIONS.includes(msg.params?.protocolVersion) ? msg.params.protocolVersion : PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
          instructions: `FirstFlip Business API (contract ${contractVersion}). ${modeDescription(ctx.env)} ${loadTools().length} tools, one per published /v1 operation. Keep FIRSTFLIP_SECRET_KEY in the server environment. Each financial/data write requires an explicit idempotency_key; reuse it with identical arguments after ambiguity. Scopes, KYC/KYB and enabled service controls are enforced by the API. Never fulfil from a redirect; verify the signed event or retrieve the payment status. On 429/503 honor retry_after.`,
        });
      case 'ping':
        return reply({});
      case 'tools/list':
        return reply({ tools: toolListing() });
      case 'tools/call':
        return reply(await callTool(msg.params, ctx));
      default:
        if (msg.method.startsWith('notifications/')) return null;
        return fail(-32601, `Method not found: ${msg.method}`);
    }
  } catch (err) {
    if (err instanceof UsageError) {
      // A usage/config problem is a tool result the agent can read and act on, not a protocol error.
      if (msg.method === 'tools/call') {
        return reply({ content: [{ type: 'text', text: redact(err.message, ctx.env.FIRSTFLIP_SECRET_KEY) }], isError: true });
      }
      return fail(-32602, err.message);
    }
    return fail(-32603, redact(err.message || 'Internal error', ctx.env.FIRSTFLIP_SECRET_KEY));
  }
}

function serve(ctx = { env: process.env }) {
  const rl = readline.createInterface({ input: process.stdin, terminal: false });
  const send = (obj) => { if (obj) process.stdout.write(JSON.stringify(obj) + '\n'); };
  process.stderr.write(`firstflip-mcp ${SERVER_INFO.version}: ${loadTools().length} tools, contract ${contractVersion}. ${modeDescription(ctx.env)}\n`);
  rl.on('line', (line) => {
    line = line.trim();
    if (!line) return;
    let msg;
    try { msg = JSON.parse(line); } catch {
      return send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
    }
    Promise.resolve(handleRequest(msg, ctx)).then(send).catch((err) => {
      send({ jsonrpc: '2.0', id: msg?.id ?? null, error: { code: -32603, message: redact(err.message, ctx.env.FIRSTFLIP_SECRET_KEY) } });
    });
  });
  return rl;
}

if (require.main === module) serve();

module.exports = { handleRequest, serve, toolListing, PROTOCOL_VERSION, SUPPORTED_PROTOCOL_VERSIONS, SERVER_INFO };
