#!/usr/bin/env node
'use strict';

// Every operation the two contracts publish must have a request in the collection a developer actually imports, and
// no request may name a route either contract does not publish. The SDK side of this is already pinned in
// sdks/node/test/client.test.js; the collection was the half guarded only by a byte diff after the builder ran,
// which proves the build is reproducible and says nothing about coverage.
//
// It reads the BUILT file, because that is what a developer downloads. `npm run check` diffs the built artifacts
// against the builder afterwards, so this gate never measures a build nobody committed.
//
// A parse that finds no operations must fail loudly: an empty contract would otherwise satisfy "no operation is
// missing a request" with zero evidence. The same trap is why the size floors are asserted before any comparison.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const COLLECTION = 'postman/FirstFlip-API.postman_collection.json';
const METHODS = ['get', 'post', 'put', 'patch', 'delete'];

// One shape for both sides: drop the base URL and the `/v1` prefix, make every path parameter read `{}`, and lose
// the query string. Contract paths say `{id}`, the builder emits `:id`, and the services fragment uses
// `{{transfer_id}}` — three spellings of one route, and the gate has to see them as one.
const canonical = (raw) =>
  String(raw)
    .replace(/\{\{baseUrl\}\}/, '')
    .split('?')[0]
    .replace(/^\/?v1\//, '/')
    .replace(/\{\{[^{}]+\}\}|\{\w+\}|:[\w-]+/g, '{}')
    .replace(/\/+/g, '/')
    .replace(/^\/|\/$/g, '');

const urlOf = (u) =>
  typeof u === 'string' ? u : Array.isArray(u.path) ? u.path.join('/') : (u.raw || '');

function contractOperations(specText, services) {
  const at = specText.indexOf('\npaths:');
  if (at < 0) throw new Error('openapi.yaml has no paths: block');
  // The next top-level key closes the block. Stopping at `components:` instead would walk into `webhooks:`, whose
  // four-space `post:` lines land on whatever path was current last — a phantom operation, and the reason this
  // check had to re-derive the boundary rather than copy the shape used for guide citations.
  const closer = specText.slice(at + 1, at + 1 + 200_000).match(/\n[a-zA-Z][\w-]*:/);
  if (!closer) throw new Error('openapi.yaml paths: never closes before the next top-level key');
  const block = specText.slice(at, at + 1 + closer.index);

  const ops = new Map();
  let current = null;
  for (const line of block.split('\n')) {
    const key = line.match(/^  (\/[^:]+):/);
    if (key) {
      current = key[1];
      if (!ops.has(current)) ops.set(current, new Set());
      continue;
    }
    const verb = line.match(/^    (get|post|put|patch|delete):/);
    if (verb && current) ops.get(current).add(verb[1]);
  }
  // The fragment is JSON, so it parses exactly — and it is the real source for the transfers and assistant routes.
  for (const [p, definition] of Object.entries(services.paths || {})) {
    if (!ops.has(p)) ops.set(p, new Set());
    for (const verb of Object.keys(definition)) if (METHODS.includes(verb)) ops.get(p).add(verb);
  }
  return ops;
}

function collectionRequests(collection) {
  const found = [];
  const walk = (items) => {
    for (const item of items || []) {
      if (item.item) walk(item.item);
      else if (item.request) {
        found.push({
          name: item.name,
          method: String(item.request.method).toLowerCase(),
          key: `${String(item.request.method).toLowerCase()} ${canonical(urlOf(item.request.url))}`,
        });
      }
    }
  };
  walk(collection.item);
  return found;
}

function evaluate(input) {
  const failures = [];
  const ops = contractOperations(input.spec, input.services);
  const requests = collectionRequests(input.collection);

  const total = [...ops.values()].reduce((n, verbs) => n + verbs.size, 0);
  if (ops.size < 40 || total < 50) {
    failures.push(
      `the contracts resolved to ${ops.size} paths / ${total} operations, below the 40/50 floor — a spec failed to parse, so coverage proves nothing`,
    );
    return { failures, tally: null };
  }
  if (requests.length < 50) {
    failures.push(
      `${COLLECTION} parsed to ${requests.length} requests, below the 50 floor — the collection did not read`,
    );
    return { failures, tally: null };
  }

  const byKey = new Map();
  for (const r of requests) byKey.set(r.key, (byKey.get(r.key) || 0) + 1);

  const missing = [];
  for (const [p, verbs] of ops) {
    for (const verb of verbs) {
      const key = `${verb} ${canonical(p)}`;
      if (!byKey.has(key)) missing.push(`${verb.toUpperCase()} ${p}`);
    }
  }
  failures.push(
    ...missing.map(
      (o) =>
        `${COLLECTION} has no request for ${o} — a developer importing it cannot try a published route, and the SDK test cannot see this side`,
    ),
  );

  const opKeys = new Set();
  for (const [p, verbs] of ops) for (const verb of verbs) opKeys.add(`${verb} ${canonical(p)}`);
  const stray = [...byKey.keys()].filter((k) => k.split(' ')[1] && !opKeys.has(k));
  failures.push(
    ...stray.map(
      (k) =>
        `${COLLECTION} sends ${k.split(' ')[0].toUpperCase()} ${k.split(' ')[1]}, which neither contract publishes — the request answers with a route a developer cannot cite`,
    ),
  );

  const duplicated = [...byKey].filter(([, n]) => n > 1).map(([k, n]) => `${k} (${n})`);
  if (duplicated.length) {
    failures.push(
      `two requests answer one operation, so a developer gets two answers to the same call: ${duplicated.join(', ')}`,
    );
  }

  return {
    failures,
    tally:
      `Postman coverage: ${total} contract operations across ${ops.size} paths, each with exactly one request in ` +
      `${COLLECTION}; ${requests.length} requests, none naming a route the contracts do not publish.`,
  };
}

const read = () => ({
  spec: fs.readFileSync(path.join(root, 'openapi.yaml'), 'utf8'),
  services: JSON.parse(fs.readFileSync(path.join(root, 'api/services.openapi.json'), 'utf8')),
  collection: JSON.parse(fs.readFileSync(path.join(root, COLLECTION), 'utf8')),
});

// Each seed breaks one rule the published tree satisfies. A seed that fails to change its target is a miss, not a
// pass — otherwise the rule reads as green while never having fired. Needles are in canonical form, because the
// collection spells the same route three ways.
// Returns null when the needle matches no request, so an out-of-date needle is reported as a seed that found
// nothing to change rather than passing as a break that was caught.
const dropRequest = (collection, needle) => {
  let dropped = 0;
  const remove = (items) => {
    if (!items) return;
    for (let i = items.length - 1; i >= 0; i -= 1) {
      if (items[i].item) remove(items[i].item);
      else if (
        items[i].request &&
        `${String(items[i].request.method).toLowerCase()} ${canonical(urlOf(items[i].request.url))}` === needle
      ) {
        items.splice(i, 1);
        dropped += 1;
      }
    }
  };
  remove(collection.item);
  return dropped > 0 ? collection : null;
};
// The builder writes three url shapes: a bare string, an object whose segments live in `url.path`, and an object
// with only `url.raw`. A rewrite that misses the middle shape still changes the JSON — by adding a `raw` key nobody
// reads — so the seed would report "changed" while the request kept pointing at the real route. Edit the shape that
// `urlOf` actually reads.
const rewriteRequest = (collection, from, to) => {
  let touched = false;
  const each = (items) => {
    for (const item of items || []) {
      if (item.item) each(item.item);
      else if (item.request && urlOf(item.request.url).includes(from)) {
        const url = item.request.url;
        if (typeof url === 'string') item.request.url = url.replace(from, to);
        else if (Array.isArray(url.path)) url.path = url.path.map((s) => s.replace(from, to));
        else url.raw = url.raw.replace(from, to);
        touched = true;
      }
    }
  };
  each(collection.item);
  return touched ? collection : null;
};

const seeds = [
  [
    'a published route loses its request',
    'collection',
    (c) => dropRequest(c, 'post cards/{}/spend_limits'),
    /no request for POST \/cards\/\{id\}\/spend_limits/,
  ],
  [
    'a request is retargeted at a route nobody publishes',
    'collection',
    (c) => rewriteRequest(c, 'spend_limits', 'spend_ceiling'),
    /neither contract publishes/,
  ],
  [
    'a read turns into a write',
    'collection',
    (c) => {
      const hit = (items) => {
        for (const item of items || []) {
          if (item.item) { if (hit(item.item)) return true; }
          else if (item.request && urlOf(item.request.url).endsWith('cards') && item.request.method === 'GET') {
            item.request.method = 'DELETE';
            return true;
          }
        }
        return false;
      };
      return hit(c.item) ? c : null;
    },
    /no request for GET \/cards/,
  ],
  [
    'the services contract stops parsing',
    'services',
    (s) => ({ ...s, paths: {} }),
    /below the 40\/50 floor/,
  ],
];

function seedBreaks(base) {
  const missed = [];
  for (const [label, where, mutate, expected] of seeds) {
    // Mutating a clone keeps one seed from leaking into the next. The "did the seed change anything" test compares
    // against a snapshot taken before the mutation, not against the object the mutation returned — every collection
    // seed here edits in place, so it returns the same reference it was handed, and comparing the two reports a real
    // break as "the seed did not change".
    const target = where === 'spec' ? base.spec : JSON.parse(JSON.stringify(base[where]));
    const before = JSON.stringify(target);
    const mutated = mutate(target);
    if (mutated === null || mutated === undefined) {
      missed.push(`${label}: the seed found nothing to change in ${where}`);
      continue;
    }
    if (JSON.stringify(mutated) === before) {
      missed.push(`${label}: the seed did not change ${where}`);
      continue;
    }
    const input = { spec: base.spec, services: base.services, collection: base.collection };
    input[where] = mutated;
    const { failures } = evaluate(input);
    if (!failures.length) {
      missed.push(`${label}: nothing caught it`);
      continue;
    }
    if (!failures.some((f) => expected.test(f))) {
      missed.push(`${label}: caught as "${failures[0]}", expected /${expected.source}/`);
    }
  }
  return missed;
}

if (require.main === module) {
  const base = read();
  const { failures, tally } = evaluate(base);
  if (failures.length) {
    console.error(`check-postman-coverage: ${failures.length} problem(s)\n- ${failures.join('\n- ')}`);
    process.exit(1);
  }
  const missed = seedBreaks(base);
  if (missed.length) {
    console.error(`check-postman-coverage: ${missed.length} seeded break(s) not caught:\n- ${missed.join('\n- ')}`);
    process.exit(1);
  }
  console.log(`${tally} ${seeds.length} seeded breaks caught.`);
}

module.exports = { evaluate, read, seeds, seedBreaks, canonical };
