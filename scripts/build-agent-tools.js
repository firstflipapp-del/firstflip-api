// Builds agents/tools.json from openapi.yaml + api/services.openapi.json (the source of truth).
// The MCP server (agents/mcp-server.js) and the CLI (agents/firstflip-cli.js) read this file, so
// every tool's name, schema, scope and path is the published contract — never hand-maintained.
// The four /sandbox hosted pages are browser endpoints (HTML, not JSON) and are excluded, the same
// rule the Node SDK follows: 53 API-key operations in, 53 tools out.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('yaml');

const root = path.join(__dirname, '..');
const main = yaml.parse(fs.readFileSync(path.join(root, 'openapi.yaml'), 'utf8'));
const services = JSON.parse(fs.readFileSync(path.join(root, 'api', 'services.openapi.json'), 'utf8'));
const DOCS = { main, services };
const METHODS = ['get', 'post', 'put', 'patch', 'delete'];
const STRIP = new Set(['example', 'examples', 'externalDocs', 'discriminator', 'xml', 'readOnly', 'writeOnly', 'deprecated']);

// Resolve a $ref to {node, doc}. Internal refs stay in the owning document; the two cross-file
// forms are the main spec's path-item refs into services and any services ref back into main.
function resolve(ref, doc) {
  let target = doc;
  let pointer = ref;
  if (!ref.startsWith('#/')) {
    const [file, frag] = ref.split('#');
    target = /services\.openapi\.json$/.test(file) ? services : main;
    pointer = `#${frag || ''}`;
  }
  const parts = pointer.slice(2).split('/').map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'));
  let node = target;
  for (const part of parts) {
    if (part === '') continue;
    node = node?.[part];
    if (node === undefined) throw new Error(`build-agent-tools: unresolvable $ref ${ref}`);
  }
  return { node, doc: target };
}

// Inline every $ref and keep only JSON-Schema keywords an MCP client can validate against.
// Fails loudly on a cycle instead of emitting a wrong schema.
function cleanSchema(node, doc, trail = []) {
  if (node && typeof node === 'object' && node.$ref) {
    if (trail.includes(node.$ref)) throw new Error(`build-agent-tools: $ref cycle ${trail.join(' -> ')} -> ${node.$ref}`);
    const r = resolve(node.$ref, doc);
    return cleanSchema(r.node, r.doc, [...trail, node.$ref]);
  }
  if (Array.isArray(node)) return node.map((n) => cleanSchema(n, doc, trail));
  if (!node || typeof node !== 'object') return node;
  const out = {};
  for (const [key, value] of Object.entries(node)) {
    if (key.startsWith('x-') || STRIP.has(key) || key === 'nullable') continue;
    if (key === 'properties') {
      out.properties = {};
      for (const [name, sub] of Object.entries(value)) {
        if (sub && sub.readOnly) continue; // request schemas never carry server-set fields
        out.properties[name] = cleanSchema(sub, doc, trail);
      }
    } else if (key === 'additionalProperties' && typeof value === 'object') {
      out.additionalProperties = cleanSchema(value, doc, trail);
    } else {
      out[key] = cleanSchema(value, doc, trail);
    }
  }
  // OpenAPI 3.0 nullable form; 3.1 type arrays pass through untouched above.
  if (node.nullable === true && typeof out.type === 'string') out.type = [out.type, 'null'];
  if (node.example !== undefined && out.examples === undefined) out.examples = [node.example];
  return out;
}

function paramSchema(param, doc) {
  const s = cleanSchema(param.schema || {}, doc);
  if (param.description) s.description = param.description;
  if (param.example !== undefined) s.examples = [param.example];
  return s;
}

const tools = [];
for (const [pathName, rawItem] of Object.entries(main.paths)) {
  if (pathName.startsWith('/sandbox/')) continue; // hosted HTML pages: browser/curl only
  const { node: item, doc } = rawItem.$ref ? resolve(rawItem.$ref, main) : { node: rawItem, doc: main };
  for (const method of METHODS) {
    const op = item[method];
    if (!op) continue;
    const params = [...(item.parameters || []), ...(op.parameters || [])]
      .map((p) => (p.$ref ? resolve(p.$ref, doc).node : p));
    const idempotencyRequired = params.some((p) => p.in === 'header' && p.name.toLowerCase() === 'idempotency-key');

    const properties = {};
    const required = [];
    for (const p of params) {
      if (p.in === 'header') continue; // Idempotency-Key is supplied by the server/CLI, not the model
      properties[p.name] = paramSchema(p, doc);
      if (p.required) required.push(p.name);
    }
    let bodyExample;
    const rb = op.requestBody && (op.requestBody.$ref ? resolve(op.requestBody.$ref, doc).node : op.requestBody);
    if (rb) {
      const media = rb.content?.['application/json'];
      if (!media) throw new Error(`build-agent-tools: ${op.operationId} has a non-JSON request body`);
      const body = cleanSchema(media.schema || {}, doc);
      body.description = ['JSON request body.', body.description].filter(Boolean).join(' ');
      properties.body = body;
      if (rb.required) required.push('body');
      if (media.example !== undefined) bodyExample = media.example;
      else if (media.examples) {
        const first = Object.values(media.examples)[0];
        const ex = first?.$ref ? resolve(first.$ref, doc).node : first;
        bodyExample = ex?.value;
      }
    }
    if (idempotencyRequired) {
      properties.idempotency_key = {
        type: 'string', maxLength: 255,
        description: 'Required by MCP writes. One stable key per logical operation; reuse it with identical arguments after a timeout. The CLI generates and prints a key when omitted.',
      };
    }
    const scope = op['x-required-scope'];
    const description = [
      op.summary ? `${op.summary}.` : '',
      op.description || '',
      `Requires scope \`${scope}\` on the business key. Test keys simulate supported operations; live execution depends on business eligibility and enabled service gates.`,
      idempotencyRequired ? 'MCP requires an explicit idempotency_key. Reuse it with identical arguments to retry the same logical request.' : '',
    ].filter(Boolean).join('\n\n');
    const success = Object.keys(op.responses || {}).find((c) => /^2\d\d$/.test(c)) || '200';
    tools.push({
      name: op.operationId,
      description,
      inputSchema: { type: 'object', properties, required, additionalProperties: false },
      method: method.toUpperCase(),
      path: pathName,
      scope,
      tag: (op.tags || [])[0] || '',
      idempotencyRequired,
      successStatus: Number(success),
      readOnly: method === 'get',
      ...(bodyExample !== undefined ? { bodyExample } : {}),
    });
  }
}

tools.sort((a, b) => a.name.localeCompare(b.name));
const names = new Set(tools.map((t) => t.name));
if (names.size !== tools.length) throw new Error('build-agent-tools: duplicate operationId');
if (tools.length !== 53) throw new Error(`build-agent-tools: expected 53 API-key operations, got ${tools.length}`);

const out = {
  generatedFrom: ['openapi.yaml', 'api/services.openapi.json'],
  contractVersion: main.info.version,
  baseUrl: main.servers[0].url,
  tools,
};
fs.mkdirSync(path.join(root, 'agents'), { recursive: true });
fs.writeFileSync(path.join(root, 'agents', 'tools.json'), JSON.stringify(out, null, 2) + '\n');
console.log(`agents/tools.json written: ${tools.length} tools (contract ${main.info.version})`);
