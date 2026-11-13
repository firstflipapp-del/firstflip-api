#!/usr/bin/env node
'use strict';

// guides/authentication.md is where a business decides what a key may do, so its scope table has to match the
// scopes the spec publishes — a name typed wrong there builds a key the API refuses. Read both files and hold
// them together in both directions. No dependencies.
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.join(__dirname, '..');
const spec = fs.readFileSync(path.join(root, 'openapi.yaml'), 'utf8');
const specSection = spec.slice(spec.indexOf('## Scopes'), spec.indexOf('Send `scopes` when creating a key'));
assert.match(specSection, /\| Scope \| Endpoints \|/, 'The Scopes table is missing from openapi.yaml');
const published = new Set();
for (const line of specSection.split('\n')) {
  if (!/^\s*\| `/.test(line)) continue;
  for (const m of line.matchAll(/`([a-z_]+:[a-z_]+)`/g)) published.add(m[1]);
}

const guide = fs.readFileSync(path.join(root, 'guides/authentication.md'), 'utf8');
const guideSection = guide.slice(guide.indexOf('## Scopes'), guide.indexOf('## Keeping keys safe'));
assert.ok(guideSection.length > 0, 'guides/authentication.md has no Scopes section');
assert.match(guideSection, /\| Scope \| Covers \|/, 'The Scopes table is missing from guides/authentication.md');
const documented = new Set();
for (const line of guideSection.split('\n')) {
  if (!/^\| `/.test(line)) continue;
  for (const m of line.matchAll(/`([a-z_]+:[a-z_]+)`/g)) documented.add(m[1]);
}

assert.deepEqual(
  [...published].filter((scope) => !documented.has(scope)),
  [],
  'openapi.yaml publishes a scope the authentication guide does not',
);
assert.deepEqual(
  [...documented].filter((scope) => !published.has(scope)),
  [],
  'The authentication guide names a scope openapi.yaml does not publish',
);

console.log(`Scope guide consistent: ${documented.size} scopes, each published by the spec.`);
