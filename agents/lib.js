'use strict';
// Shared request layer for the FirstFlip MCP server and CLI. Zero dependencies; Node 18+.
// The contract in tools.json (generated from openapi.yaml) is the only source of paths and schemas.
// The secret key comes from the environment, is sent only as a Bearer header, and is never logged.

const crypto = require('node:crypto');
const path = require('node:path');

const catalog = require(path.join(__dirname, 'tools.json'));
const DEFAULT_BASE_URL = catalog.baseUrl;
const KEY_RE = /^ffk_(test|live)_/;

class UsageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UsageError';
  }
}

function loadTools() {
  return catalog.tools;
}

function getTool(name) {
  const tool = catalog.tools.find((t) => t.name === name);
  if (!tool) throw new UsageError(`Unknown operation "${name}". Run tools/list (MCP) or \`firstflip list\` (CLI) to see the ${catalog.tools.length} published operations.`);
  return tool;
}

function coerce(name, value, schema) {
  if (value === undefined || value === null) return value;
  const type = Array.isArray(schema.type) ? schema.type.find((t) => t !== 'null') : schema.type;
  let v = value;
  if (typeof value === 'string') {
    if (type === 'integer' || type === 'number') {
      v = Number(value);
      if (!Number.isFinite(v)) throw new UsageError(`"${name}" must be a ${type}, got "${value}".`);
      if (type === 'integer' && !Number.isInteger(v)) throw new UsageError(`"${name}" must be an integer, got "${value}".`);
    } else if (type === 'boolean') {
      if (value !== 'true' && value !== 'false') throw new UsageError(`"${name}" must be true or false, got "${value}".`);
      v = value === 'true';
    }
  }
  if (schema.enum && !schema.enum.includes(v)) {
    throw new UsageError(`"${name}" must be one of: ${schema.enum.join(', ')}. Got "${value}".`);
  }
  return v;
}

// Build the HTTP request for one contract operation. Pure: no network, no clock, fully testable.
function buildRequest(tool, args = {}, opts = {}) {
  const secretKey = opts.secretKey;
  if (typeof secretKey !== 'string' || !KEY_RE.test(secretKey)) {
    throw new UsageError('FIRSTFLIP_SECRET_KEY is missing or not a FirstFlip key (ffk_test_… / ffk_live_…). Set it in the environment; never pass a key as an argument.');
  }
  const baseUrl = (opts.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, '');
  const u = new URL(baseUrl);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  if (u.protocol !== 'https:' && !(local && u.protocol === 'http:')) {
    throw new UsageError(`Base URL must be https (http only for localhost): ${baseUrl}`);
  }

  const schema = tool.inputSchema || { properties: {} };
  const props = schema.properties || {};
  for (const name of schema.required || []) {
    if (args[name] === undefined) throw new UsageError(`Missing required argument "${name}" for ${tool.name}.`);
  }
  for (const name of Object.keys(args)) {
    if (!props[name]) throw new UsageError(`Unknown argument "${name}" for ${tool.name}. Allowed: ${Object.keys(props).join(', ') || '(none)'}.`);
  }

  let pathName = tool.path;
  const query = [];
  for (const [name, prop] of Object.entries(props)) {
    const value = coerce(name, args[name], prop);
    if (value === undefined) continue;
    if (pathName.includes(`{${name}}`)) {
      pathName = pathName.replace(`{${name}}`, encodeURIComponent(String(value)));
    } else if (name !== 'body' && name !== 'idempotency_key') {
      query.push([name, String(value)]);
    }
  }
  if (pathName.includes('{')) throw new UsageError(`Missing path parameter for ${tool.name}: ${pathName}`);

  const headers = { Authorization: `Bearer ${secretKey}`, Accept: 'application/json' };
  let body;
  if (args.body !== undefined) {
    if (!props.body) throw new UsageError(`${tool.name} takes no request body.`);
    if (typeof args.body !== 'object' || args.body === null || Array.isArray(args.body)) {
      throw new UsageError('"body" must be a JSON object.');
    }
    body = JSON.stringify(args.body);
    headers['Content-Type'] = 'application/json';
  }
  if (tool.idempotencyRequired) {
    const key = args.idempotency_key !== undefined ? args.idempotency_key
      : opts.idempotencyKey !== undefined ? opts.idempotencyKey : crypto.randomUUID();
    if (typeof key !== 'string' || !key.trim() || key.length > 255) throw new UsageError('idempotency_key must be a nonempty string of at most 255 characters.');
    headers['Idempotency-Key'] = key;
  }
  const qs = query.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
  return { url: `${baseUrl}${pathName}${qs ? `?${qs}` : ''}`, method: tool.method, headers, body };
}

// Execute a built request. Returns a flat, machine-readable result; never throws for HTTP errors.
async function executeRequest(req, opts = {}) {
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const timeoutMs = opts.timeoutMs ?? 30000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(req.url, { method: req.method, headers: req.headers, body: req.body, signal: controller.signal });
    const text = await res.text();
    let body;
    try { body = JSON.parse(text); } catch { body = text; }
    const retryAfter = res.headers.get('retry-after');
    const remaining = res.headers.get('x-ratelimit-remaining');
    return {
      status: res.status,
      ok: res.ok,
      requestId: res.headers.get('request-id') || null,
      body,
      ...(retryAfter !== null ? { retryAfter } : {}),
      ...(remaining !== null ? { rateLimitRemaining: Number(remaining) } : {}),
    };
  } catch (err) {
    const timedOut = err && (err.name === 'AbortError' || err.code === 'ABORT_ERR');
    return {
      status: 0,
      ok: false,
      requestId: null,
      body: { error: { type: 'connection_error', code: timedOut ? 'timeout' : 'connection_error', message: timedOut ? `Request timed out after ${timeoutMs} ms. Retry with the same Idempotency-Key.` : 'Could not reach the FirstFlip API. Check the network, then retry with the same Idempotency-Key.' } },
    };
  } finally {
    clearTimeout(timer);
  }
}

// Defense in depth: the key must never appear in anything an agent or a log can see.
function redact(text, secretKey) {
  if (!secretKey) return text;
  return String(text).split(secretKey).join('[redacted]');
}

module.exports = { loadTools, getTool, buildRequest, executeRequest, redact, UsageError, DEFAULT_BASE_URL, contractVersion: catalog.contractVersion };
