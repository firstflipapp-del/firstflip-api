'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const catalog = JSON.parse(read('agents/tools.json'));

test('public discovery lists exactly the executable contract and requires business keys', () => {
  const manifest = JSON.parse(read('.well-known/firstflip-integration.json'));
  assert.deepEqual(manifest.operations.map((op) => op.name), catalog.tools.map((op) => op.name));
  for (const op of manifest.operations) {
    const source = catalog.tools.find((tool) => tool.name === op.name);
    assert.equal(op.path, source.path);
    assert.equal(op.scope, source.scope);
  }
  assert.equal(manifest.access.calls_require_business_api_key, true);
  assert.equal(manifest.access.public_discovery, true);
  assert.equal(manifest.mcp.transport, 'stdio');
  assert.equal(manifest.mcp.secret_environment_variable, 'FIRSTFLIP_SECRET_KEY');
});

test('every LLM discovery link resolves inside the exported public documentation', () => {
  const exported = new Set(require('../scripts/public-files').readPublicFiles(root));
  for (const file of ['llms.txt','llms-full.txt']) for (const match of read(file).matchAll(/\]\(([^)]+)\)/g)) {
    if (/^(https?:|mailto:|#)/.test(match[1])) continue;
    const target = match[1].split('#')[0];
    assert(exported.has(target) || (target.endsWith('/') && [...exported].some((p)=>p.startsWith(target))), target + ' must be exported');
    assert(fs.existsSync(path.join(root, target)), target + ' must exist');
  }
  for (const name of ['charges','payment-links','cards','webhooks','testing','going-live']) assert(read('llms-full.txt').includes(`<guide name="${name}">`));
});

test('downloadable skill is self-contained and fingerprints the exact public source bundle', () => {
  const skill = 'skills/firstflip-integration';
  const sources = JSON.parse(read(skill + '/references/sources.json'));
  for (const [source, hash] of Object.entries(sources.sha256)) {
    assert.equal(crypto.createHash('sha256').update(read(source)).digest('hex'), hash, source);
  }
  for (const match of read(skill + '/SKILL.md').matchAll(/\]\(([^)]+)\)/g)) {
    assert(fs.existsSync(path.join(root, skill, match[1])), match[1]);
  }
  for (const p of ['SKILL.md','LICENSE','references/openapi.yaml','references/api/services.openapi.json','references/tools.json','references/knowledge.md','references/sources.json']) {
    assert.equal(read(skill+'/'+p), read('agents/'+skill+'/'+p), 'npm skill copy differs: '+p);
  }
});

test('registry identity and default npm executable point to the shipped stdio server', () => {
  const pkg = JSON.parse(read('agents/package.json'));
  const registry = JSON.parse(read('agents/server.json'));
  assert.equal(registry.name, pkg.mcpName);
  assert.equal(registry.version, pkg.version);
  assert.equal(registry.packages[0].identifier, pkg.name);
  assert.equal(registry.packages[0].version, pkg.version);
  assert.equal(registry.packages[0].transport.type, 'stdio');
  assert.equal(pkg.bin.agents, 'mcp-server.js');
  assert.equal(registry.packages[0].environmentVariables[0].isSecret, true);
  assert.equal(registry.remotes, undefined, 'a nonexistent public HTTP endpoint must not be advertised');
});
