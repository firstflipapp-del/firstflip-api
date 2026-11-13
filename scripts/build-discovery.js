#!/usr/bin/env node
'use strict';
// Build the public discovery files and a self-contained integration skill from the same contract.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const write = (name, data) => {
  const target = path.join(root, name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, data);
};
const { readPublicFiles, serializePublicFiles } = require('./public-files');
write('public-files.json', serializePublicFiles(readPublicFiles(root)));
const tools = JSON.parse(read('agents/tools.json'));
const pkg = JSON.parse(read('agents/package.json'));
const guideNames = fs.readdirSync(path.join(root, 'guides')).filter((name) => name.endsWith('.md')).sort();
const guides = guideNames.map((name) => {
  const title = read(`guides/${name}`).match(/^# (.+)$/m)?.[1];
  if (!title) throw new Error(`Missing guide title: ${name}`);
  return `- [${title}](guides/${name})`;
});
write('llms.txt', `# FirstFlip API\n\n> FirstFlip business API integration documentation, OpenAPI contracts, scoped-key MCP tools and a portable integration skill.\n\nPublic documentation does not grant API access. Business keys, scopes, verification and per-service controls govern requests. Test keys simulate supported operations; consult each operation's guide for live prerequisites. Fulfil payments from verified events or API status, never from a browser redirect.\n\n## Start here\n\n- [API overview](README.md)\n- [OpenAPI contract](openapi.yaml)\n- [Services contract](api/services.openapi.json)\n- [Agent capability manifest](.well-known/firstflip-integration.json)\n- [Generated tool catalog](agents/tools.json)\n- [Portable integration skill](skills/firstflip-integration/SKILL.md)\n- [Complete guide context](llms-full.txt)\n\n## Guides\n\n${guides.join('\n')}\n`);
// The source bundle contains guide-relative links. At the site root they must resolve from /guides.
const guideBundle = read('assistant/knowledge.md');
const fullContext = guideBundle.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (all, label, target) => {
  if (/^(https?:|mailto:|#)/.test(target)) return all;
  return `[${label}](${path.posix.normalize(path.posix.join('guides', target))})`;
});
write('llms-full.txt', fullContext);
const manifest = {
  name: 'FirstFlip API',
  version: pkg.version,
  contract_version: tools.contractVersion,
  api_base: tools.baseUrl,
  documentation: { index: '../llms.txt', full: '../llms-full.txt', openapi: '../openapi.yaml' },
  mcp: { transport: 'stdio', package: pkg.name, version: pkg.version, command: 'firstflip-mcp', secret_environment_variable: 'FIRSTFLIP_SECRET_KEY', registry_manifest: '../agents/server.json' },
  skill: '../skills/firstflip-integration/SKILL.md',
  access: { public_discovery: true, calls_require_business_api_key: true, scopes_enforced_by_api: true, live_eligibility_and_service_gates_enforced_by_api: true },
  operations: tools.tools.map(({ name, method, path: operationPath, scope, idempotencyRequired, readOnly }) => ({ name, method, path: operationPath, scope, read_only: readOnly, explicit_idempotency_key_for_mcp: idempotencyRequired })),
};
write('.well-known/firstflip-integration.json', JSON.stringify(manifest, null, 2) + '\n');
const registry = {
  $schema: 'https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json',
  name: pkg.mcpName,
  title: 'FirstFlip',
  description: 'Scoped business API tools for FirstFlip payments, payment links and supported services.',
  version: pkg.version,
  packages: [{ registryType: 'npm', identifier: pkg.name, version: pkg.version, runtimeHint: 'npx',
    transport: { type: 'stdio' },
    environmentVariables: [{ name: 'FIRSTFLIP_SECRET_KEY', description: 'Your scoped FirstFlip business secret key; keep it in the local MCP process environment.', isRequired: true, isSecret: true, format: 'string' }],
  }],
};
write('agents/server.json', JSON.stringify(registry, null, 2) + '\n');
const skill = 'skills/firstflip-integration';
const sources = {
  'references/openapi.yaml': 'openapi.yaml',
  'references/api/services.openapi.json': 'api/services.openapi.json',
  'references/tools.json': 'agents/tools.json',
  'references/knowledge.md': 'assistant/knowledge.md',
  LICENSE: 'LICENSE',
};
const hashes = {};
for (const [dest, source] of Object.entries(sources)) {
  const body = read(source);
  let bundled = body;
  if (dest === 'references/knowledge.md') {
    // Resolve guide cross-references inside one portable file instead of shipping broken relative links.
    bundled = body.replace(/<guide name="([^"]+)">/g, '<a id="guide-$1"></a>\n<guide name="$1">')
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (all, label, target) => {
        if (/^(https?:|mailto:|#)/.test(target)) return all;
        const filename = path.posix.basename(target.split('#')[0]);
        if (guideNames.includes(filename)) return `[${label}](#guide-${filename.replace(/\.md$/, '')})`;
        if (filename === 'openapi.yaml') return `[${label}](openapi.yaml)`;
        if (filename === 'SKILL.md') return `[${label}](../SKILL.md)`;
        if (filename === 'llms.txt' || filename === 'llms-full.txt') return `[${label}](knowledge.md)`;
        return label;
      });
  }
  write(`${skill}/${dest}`, bundled);
  hashes[source] = crypto.createHash('sha256').update(body).digest('hex');
}
write(`${skill}/references/sources.json`, JSON.stringify({ contract_version: tools.contractVersion, package_version: pkg.version, sha256: hashes }, null, 2) + '\n');
// npm consumers receive the identical skill; no private repository files enter the package.
fs.cpSync(path.join(root, skill), path.join(root, 'agents', skill), { recursive: true });
console.log(`Discovery built: ${tools.tools.length} operations, ${guideNames.length} guides, complete integration skill.`);
