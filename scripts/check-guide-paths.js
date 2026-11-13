#!/usr/bin/env node
'use strict';

// Every path a guide prints is a path a developer will call. Two specs publish them (the core contract and the
// services contract, both under the same `/v1` base), and a citation that is not in either one is a page telling
// someone to call an endpoint that does not exist — or the `/cards` shorthand for `/v1/cards`, which reads as a
// different API. Scope is `guides/` plus README.md: the assistant bundle is generated from those pages, and the
// SDK README cites client methods rather than HTTP paths. No dependencies.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const METHODS = ['get', 'post', 'put', 'patch', 'delete'];

const core = fs.readFileSync(path.join(root, 'openapi.yaml'), 'utf8');
const pathsBlock = core.slice(core.indexOf('\npaths:'), core.indexOf('\ncomponents:'));
if (pathsBlock.length === 0) die('openapi.yaml has no paths block between `paths:` and `components:`');

const contract = new Map();
let current = null;
for (const line of pathsBlock.split('\n')) {
  const key = line.match(/^  (\/[^:]*):/);
  if (key) {
    current = key[1];
    if (!contract.has(current)) contract.set(current, new Set());
    continue;
  }
  const verb = line.match(/^    (get|post|put|patch|delete):/);
  if (verb && current) contract.get(current).add(verb[1]);
}

// The services contract is JSON, so it parses exactly.
const services = require(path.join(root, 'api/services.openapi.json'));
for (const [p, ops] of Object.entries(services.paths)) {
  if (!contract.has(p)) contract.set(p, new Set());
  for (const verb of Object.keys(ops)) if (METHODS.includes(verb)) contract.get(p).add(verb);
}
if (contract.size < 40) die(`only ${contract.size} paths resolved from the two contracts — a spec failed to parse`);

const templates = [...contract.keys()];
const segmentsOf = (target) => target.split('?')[0].split('/').filter(Boolean);
const matches = (segments, template) => {
  const wanted = segmentsOf(template);
  return wanted.length === segments.length && wanted.every((seg, i) => seg.startsWith('{') || seg === segments[i]);
};
const publishMethod = (method, target) =>
  templates.some((template) => matches(segmentsOf(target), template) && contract.get(template).has(method));

const exported = require('./public-files').readPublicFiles(root);

const problems = [];
const seen = new Set();
const consider = (file, method, raw) => {
  const target = raw.split('?')[0];
  // `POST …/simulate` is a family placeholder, not a citation: it names no endpoint, so there is nothing to
  // verify and a real path in its place would be a different sentence.
  if (target.includes('…') || target.includes('...')) return;
  if (!target.startsWith('/')) {
    problems.push(`${file}: "${method.toUpperCase()} ${raw}" is not a path`);
    return;
  }
  if (!target.startsWith('/v1/')) {
    problems.push(
      `${file}: "${method.toUpperCase()} ${raw}" omits the base every other citation uses — the published path is /v1${target}`,
    );
    return;
  }
  const underBase = target.slice(3); // drop `/v1`, because contract paths are relative to the base
  seen.add(`${method} ${underBase}`);
  if (publishMethod(method, underBase)) return;
  const template = templates.find((t) => matches(segmentsOf(underBase), t));
  problems.push(
    template
      ? `${file}: "${method.toUpperCase()} ${raw}" — ${template} publishes ${[...contract.get(template)].join(', ')} only`
      : `${file}: "${method.toUpperCase()} ${raw}" matches no path in openapi.yaml or api/services.openapi.json`,
  );
};

// A bash fence is one command per blank-line-separated block. curl's default verb is GET, but a block carrying a
// body is a POST whatever the flag says, so `-d`/`--data`/`-F` count as `-X POST` — otherwise every hand-written
// POST example in the guides reads as a phantom list endpoint.
const fences = (text, lang) => [...text.matchAll(new RegExp('^```' + lang + '\\n([\\s\\S]*?)^```$', 'gm'))].map((m) => m[1]);
const bodyFlag = /(?:^|\s)(?:-[dF]|--data(?:-binary|-raw|-urlencode)?|--json)(?:\s|=)/;
// Diagram labels carry citations too, and a flow a developer copies is read as often as the prose beside it.
// Mermaid cannot hold backticks inside a label, so these are matched bare: `METHOD /path` up to the first
// character that cannot belong to a path in a quoted label.
const diagramCitations = (body) =>
  [...body.matchAll(/\b(GET|POST|PUT|PATCH|DELETE) (\/[^\s"'<>|.,;]+)/g)].map((m) => [m[1].toLowerCase(), m[2]]);
let diagramBlocks = 0;
let diagramHits = 0;
const pages = exported.filter((p) => p.startsWith('guides/') || p === 'README.md');
for (const rel of pages) {
  if (!fs.existsSync(path.join(root, rel))) continue;
  const text = fs.readFileSync(path.join(root, rel), 'utf8');
  for (const m of text.matchAll(/`(GET|POST|PUT|PATCH|DELETE) ([^`\s]+)`/g)) consider(rel, m[1].toLowerCase(), m[2]);
  for (const fence of fences(text, 'bash')) {
    for (const block of fence.split(/\n\s*\n/)) {
      if (!block.includes('curl ')) continue;
      const url = (block.match(/https:\/\/api\.firstflip\.ng(\/[^\s"'\\]*)/) || [])[1];
      if (!url) continue;
      const explicit = (block.match(/-X\s+([A-Z]+)/) || [])[1];
      consider(rel, (explicit || (bodyFlag.test(block) ? 'POST' : 'GET')).toLowerCase(), url);
    }
  }
  for (const diagram of fences(text, 'mermaid')) {
    diagramBlocks += 1;
    const hits = diagramCitations(diagram);
    diagramHits += hits.length;
    for (const [method, raw] of hits) consider(rel, method, raw);
  }
}

if (seen.size < 40) die(`only ${seen.size} distinct citations were checked — the reader is broken, not the docs`);
// A diagram sweep that finds nothing is a broken sweep, not an empty surface: it would read as green while
// checking no citation at all. Every diagram that names an endpoint would have to stop naming one, or the
// reader would have to break, for this to trip.
if (diagramBlocks > 0 && diagramHits === 0)
  die(`${diagramBlocks} mermaid blocks parsed and none carried an endpoint citation — the diagram reader is broken`);

const unique = [...new Set(problems)];
if (unique.length) {
  console.error(`check-guide-paths: ${unique.length} problem(s)`);
  for (const p of unique) console.error(`  ${p}`);
  process.exit(1);
}

console.log(
  `check-guide-paths: ${seen.size} endpoints cited across ${pages.length} guide pages (${diagramHits} of them inside ${diagramBlocks} diagrams), each one published by the contract with that method.`,
);

function die(message) {
  console.error(`check-guide-paths: ${message}`);
  process.exit(1);
}
