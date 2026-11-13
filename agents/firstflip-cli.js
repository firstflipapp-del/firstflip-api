#!/usr/bin/env node
'use strict';
// firstflip — the FirstFlip API CLI for AI coding agents and shell-first developers.
// Zero dependencies; Node 18+. Every command maps to one published /v1 operation in
// agents/tools.json (generated from openapi.yaml). The key comes only from FIRSTFLIP_SECRET_KEY.
//
//   firstflip list                              every operation: name, method, path, scope
//   firstflip describe createCharge             full schema + a published example body
//   firstflip call createCharge --body '{…}'    execute (bare `firstflip createCharge …` also works)
//   firstflip call getCharge --id ch_…          path/query params are flags
//
// Output: response body JSON on stdout (pipeable); status line + request id on stderr.
// Exit codes: 0 = 2xx, 1 = API/network error, 2 = usage/config error.

const fs = require('node:fs');
const { loadTools, getTool, buildRequest, executeRequest, redact, UsageError, contractVersion } = require('./lib.js');

const HELP = `firstflip — FirstFlip Business API CLI (contract ${contractVersion})

Usage:
  firstflip list                            List every published operation
  firstflip describe <operation>            Show an operation's schema and example body
  firstflip [call] <operation> [flags]      Call an operation (e.g. createCharge, getCharge)

Flags for a call:
  --<param> <value>       Path or query parameter (e.g. --id ch_123, --limit 10)
  --body '<json>'         JSON request body (or --body-file <path>, or - for stdin)
  --idempotency-key <k>   Reuse a key to retry the same logical write safely
  --base-url <url>        Override the API base (https only, except localhost)
  --timeout-ms <n>        Request timeout (default 30000)

Environment:
  FIRSTFLIP_SECRET_KEY    Required. Your business key (ffk_test_… / ffk_live_…). Never a flag.
  FIRSTFLIP_BASE_URL      Optional default for --base-url.

Test keys simulate supported operations. Live keys remain subject to business eligibility,
service gates and key scopes. Approve real spending before calling a live write.
An automatically generated idempotency_key is printed to stderr; save it for safe retries.

Exit codes: 0 success · 1 API/network error · 2 usage/config error.`;

function parseCall(argv) {
  const args = {};
  const opts = {};
  let bodyFile = null;
  let bodyInline = null;
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (!tok.startsWith('--')) throw new UsageError(`Unexpected argument "${tok}". Flags look like --id ch_123.`);
    const name = tok.slice(2);
    const next = argv[i + 1];
    if (next === undefined) throw new UsageError(`Flag --${name} needs a value.`);
    i++;
    if (name === 'body') bodyInline = next;
    else if (name === 'body-file') bodyFile = next;
    else if (name === 'idempotency-key') opts.idempotencyKey = next;
    else if (name === 'base-url') opts.baseUrl = next;
    else if (name === 'timeout-ms') opts.timeoutMs = Number(next);
    else args[name.replace(/-/g, '_')] = next;
  }
  if (bodyInline !== null && bodyFile !== null) throw new UsageError('Use --body or --body-file, not both.');
  if (bodyInline !== null || bodyFile !== null) {
    const raw = bodyInline === '-' || bodyFile === '-' ? fs.readFileSync(0, 'utf8')
      : bodyFile !== null ? fs.readFileSync(bodyFile, 'utf8') : bodyInline;
    try { args.body = JSON.parse(raw); } catch { throw new UsageError('Body is not valid JSON.'); }
  }
  return { args, opts };
}

// run() is the whole CLI minus process.exit — exported so tests drive it with a stubbed fetch.
async function run(argv, ctx = {}) {
  const env = ctx.env || process.env;
  const out = ctx.stdout || ((s) => process.stdout.write(s));
  const err = ctx.stderr || ((s) => process.stderr.write(s));
  const [cmd, ...rest] = argv;
  try {
    if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') { err(HELP + '\n'); return 0; }
    if (cmd === 'list') {
      const rows = loadTools().map((t) => `${t.name.padEnd(30)} ${t.method.padEnd(5)} ${t.path.padEnd(38)} ${t.scope}`);
      out(rows.join('\n') + '\n');
      return 0;
    }
    if (cmd === 'describe') {
      const tool = getTool(rest[0]);
      out(JSON.stringify({ name: tool.name, method: tool.method, path: tool.path, scope: tool.scope, description: tool.description, inputSchema: tool.inputSchema, ...(tool.bodyExample ? { bodyExample: tool.bodyExample } : {}) }, null, 2) + '\n');
      return 0;
    }
    const opName = cmd === 'call' ? rest[0] : cmd;
    const callArgs = cmd === 'call' ? rest.slice(1) : rest;
    if (!opName) throw new UsageError('Which operation? Run `firstflip list`.');
    const tool = getTool(opName);
    const { args, opts } = parseCall(callArgs);
    const req = buildRequest(tool, args, {
      secretKey: env.FIRSTFLIP_SECRET_KEY,
      baseUrl: opts.baseUrl || env.FIRSTFLIP_BASE_URL,
      idempotencyKey: opts.idempotencyKey,
    });
    const result = await executeRequest(req, { fetchImpl: ctx.fetchImpl, timeoutMs: opts.timeoutMs });
    const bits = [`HTTP ${result.status}`];
    if (req.headers['Idempotency-Key']) bits.push(`idempotency_key ${req.headers['Idempotency-Key']}`);
    if (result.requestId) bits.push(`request_id ${result.requestId}`);
    if (result.retryAfter !== undefined) bits.push(`retry_after ${result.retryAfter}`);
    if (result.rateLimitRemaining !== undefined) bits.push(`rate_limit_remaining ${result.rateLimitRemaining}`);
    err(redact(bits.join(' · '), env.FIRSTFLIP_SECRET_KEY) + '\n');
    out(redact(typeof result.body === 'string' ? result.body : JSON.stringify(result.body, null, 2), env.FIRSTFLIP_SECRET_KEY) + '\n');
    return result.ok ? 0 : 1;
  } catch (e) {
    if (e instanceof UsageError) { err(redact(e.message, env.FIRSTFLIP_SECRET_KEY) + '\n'); return 2; }
    throw e;
  }
}

if (require.main === module) {
  run(process.argv.slice(2)).then((code) => process.exit(code)).catch((e) => {
    process.stderr.write(redact(e.message || 'Unexpected error', process.env.FIRSTFLIP_SECRET_KEY) + '\n');
    process.exit(2);
  });
}

module.exports = { run, parseCall, HELP };
