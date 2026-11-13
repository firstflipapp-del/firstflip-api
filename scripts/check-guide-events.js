#!/usr/bin/env node
'use strict';

// A webhook is often the only signal that a sandbox payment landed, so a guide that names the wrong event type
// costs a developer a silent handler: no error, no delivery, just a branch that never runs. Hold the enum the
// contract publishes against what the guides print, in both directions, and hold `Event.data.object` closed
// against it: a published type with no schema in the union is a body a typed client cannot generate, and a
// schema in the union that no type resolves to is a shape no delivery can ever carry.
//
// The rules live in `evaluate`, which takes the texts rather than reading the tree, so every run can feed it the
// seeds in memory and prove each rule actually fires; `--self-test` runs the seeds alone. No dependencies.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

// Each family is pinned to the schema that must carry it. A family missing from this map makes the check fail
// rather than pass quietly, so a new event prefix forces a human to say which schema carries it.
const families = {
  charge: 'Charge',
  'fx.quote': 'FxQuote',
  'fx.trade': 'FxTrade',
  'virtual_account.payment': 'VirtualAccountPayment',
  bvn: 'BvnVerification',
  transfer: 'Transfer',
  card: 'Card',
};
const prefixes = Object.keys(families);
const familyOf = (type) => prefixes.find((f) => type.startsWith(`${f}.`));

// The card family carries two objects and a handler cannot tell which from the prefix alone: lifecycle events
// are about the card, money and authorization events are about the ledger row. Spelled out per type because that
// split is exactly what a generated client would otherwise have to guess.
const cardObjectOf = {
  'card.created': 'Card',
  'card.frozen': 'Card',
  'card.unfrozen': 'Card',
  'card.closed': 'Card',
  'card.limits.updated': 'Card',
  'card.funded': 'CardTransaction',
  'card.withdrawn': 'CardTransaction',
  'card.authorization.approved': 'CardTransaction',
  'card.authorization.declined': 'CardTransaction',
};

const CARD_REF = '                - $ref: "#/components/schemas/CardTransaction"';
const GUIDE_SECTION = '## Events from virtual cards';
const stalePhrases = ['card payload gap', 'No card schema', 'cannot describe'];

function evaluate({ spec, services, guides }) {
  const failures = [];
  const need = (cond, message) => {
    if (cond) return true;
    if (!failures.includes(message)) failures.push(message);
    return false;
  };

  const eventStart = spec.indexOf('\n    Event:');
  if (!need(eventStart >= 0, 'The Event schema is missing from openapi.yaml')) return { failures, tally: null };
  const eventEnd = spec.indexOf('\n    WebhookEndpoint:', eventStart);
  if (!need(eventEnd > eventStart, 'The Event schema is not followed by WebhookEndpoint in openapi.yaml')) {
    return { failures, tally: null };
  }
  const eventBlock = spec.slice(eventStart, eventEnd);

  const enumMatch = eventBlock.match(/enum: \[([^\]]*)\]/);
  if (!need(enumMatch, 'Event.type publishes no enum')) return { failures, tally: null };
  const published = enumMatch[1].split(',').map((type) => type.trim()).filter(Boolean);
  if (!need(published.length > 0, 'Event.type enum is empty')) return { failures, tally: null };

  // The union is what a handler can actually read: a type whose object is absent here has no published body shape.
  const unionRefs = new Set([...eventBlock.matchAll(/- \$ref: ".*#\/components\/schemas\/(\w+)"/g)].map((m) => m[1]));

  Object.entries(cardObjectOf).forEach(([type, schema]) => {
    need(familyOf(type) === 'card', `${type} is mapped as a card event but does not carry the card prefix`);
    need(schema === 'Card' || schema === 'CardTransaction', `${type} maps to ${schema}, which is not a card object`);
  });

  need(
    published.filter((type) => !familyOf(type)).length === 0,
    'An event type belongs to a family this check does not know — add it to `families`',
  );
  need(
    published.filter((type) => familyOf(type) === 'card' && !cardObjectOf[type]).length === 0,
    'A published card event has no entry in `cardObjectOf` — say which object carries it',
  );
  need(
    Object.keys(cardObjectOf).filter((type) => !published.includes(type)).length === 0,
    'cardObjectOf maps an event type the contract no longer publishes',
  );

  const schemaFor = (type) => (type.startsWith('card.') ? cardObjectOf[type] : families[familyOf(type)]);
  const resolvable = published.filter((type) => familyOf(type));

  need(
    resolvable.filter((type) => !unionRefs.has(schemaFor(type))).map((type) => `${type} → ${schemaFor(type)}`).length === 0,
    'An event type resolves to a schema that Event.data.object.oneOf does not admit',
  );
  need(
    [...unionRefs].filter((schema) => !resolvable.some((type) => schemaFor(type) === schema)).length === 0,
    'Event.data.object admits a schema no published event type resolves to',
  );

  // A oneOf is only decidable if each member announces itself, so read the `object` const out of every schema the
  // union names — locally or in the bundled services fragment — and require the set to be distinct.
  const externalSchemas = (services.components && services.components.schemas) || {};
  const objectConstOf = (schema) => {
    const external = externalSchemas[schema];
    if (external) {
      const value = external.properties && external.properties.object && external.properties.object.const;
      need(Boolean(value), `${schema} (api/services.openapi.json) publishes no \`object\` const`);
      return value;
    }
    const start = spec.indexOf(`\n    ${schema}:`);
    if (!need(start >= 0, `${schema} is named by Event.data.object but defined nowhere in openapi.yaml`)) return null;
    const next = spec.slice(start + 1).search(/\n    \w+:/);
    const block = next < 0 ? spec.slice(start) : spec.slice(start, start + 1 + next);
    const found = block.match(/object: \{ type: string, const: (\w+) \}/);
    need(Boolean(found), `${schema} is defined but publishes no \`object\` const in the inline form this union relies on`);
    return found && found[1];
  };
  const consts = [...unionRefs].map((schema) => objectConstOf(schema)).filter(Boolean);
  need(
    consts.filter((value, i) => consts.indexOf(value) !== i).length === 0,
    'Two members of Event.data.object claim the same `object` const, so a delivery cannot be told apart',
  );

  // Every published type must be named by a guide, and no guide may name an event type the contract does not publish.
  const documented = new Set();
  for (const [file, text] of Object.entries(guides)) {
    for (const m of text.matchAll(/`((?:charge|fx|virtual_account|bvn|transfer|card)\.[a-z_][a-z_.]*)`/g)) {
      const name = m[1];
      if (published.includes(name)) documented.add(name);
      else failures.push(`${file} names \`${name}\`, which openapi.yaml does not publish`);
    }
    if (file === 'guides/webhooks.md') {
      // The union is closed now, so this guide has to name both card objects and stop repeating the caveat written
      // while `card` had no schema — the new convention, pinned the day it changed.
      const at = text.indexOf(GUIDE_SECTION);
      if (need(at >= 0, 'The virtual-card events section is missing from guides/webhooks.md')) {
        const cardSection = text.slice(at);
        for (const value of ['`card`', '`card_transaction`']) {
          need(cardSection.includes(value), `guides/webhooks.md no longer names the ${value} object for card events`);
        }
      }
      for (const stale of stalePhrases) {
        need(!text.includes(stale), `guides/webhooks.md still says "${stale}" while the union admits card schemas`);
      }
    }
  }
  need(
    published.filter((type) => !documented.has(type)).length === 0,
    'openapi.yaml publishes an event type no guide names',
  );

  const bySchema = {};
  published.forEach((type) => {
    const key = schemaFor(type);
    bySchema[key] = (bySchema[key] || 0) + 1;
  });
  return {
    failures,
    tally: `Event guide consistent: ${published.length} types across ${prefixes.length} families, each named by a guide and ` +
      `no event named outside the contract among the ${Object.keys(guides).length} pages this check reads, ` +
      `all resolving into an ${unionRefs.size}-member payload union (` +
      `${Object.entries(bySchema).map(([schema, count]) => `${schema} ${count}`).join(', ')}).`,
  };
}

const read = () => ({
  spec: fs.readFileSync(path.join(root, 'openapi.yaml'), 'utf8'),
  services: JSON.parse(fs.readFileSync(path.join(root, 'api/services.openapi.json'), 'utf8')),
  // Every guide page, not the two that happen to talk about webhooks. The naming rule is bidirectional, so reading
  // two pages let it claim "all named by a guide" while nine other pages could name a type the contract never
  // published and stay unseen — the same blindness the error-code gate just closed for tables.
  guides: Object.fromEntries(
    fs.readdirSync(path.join(root, 'guides'))
      .filter((file) => file.endsWith('.md'))
      .sort()
      .map((file) => [`guides/${file}`, fs.readFileSync(path.join(root, 'guides', file), 'utf8')]),
  ),
});

// Each seed breaks exactly one rule the published tree satisfies, so a rule that fires on nothing is visible in the
// everyday run rather than somewhere down the road. A seed that fails to edit its target is a miss, not a pass.
const GUIDE = 'guides/webhooks.md';
const seeds = [
  ['a card schema drops out of Event.data.object', 'spec', (t) => t.replace(`${CARD_REF}\n`, ''), /does not admit/],
  ['the union gains a schema no event resolves to', 'spec', (t) => t.replace(CARD_REF, `${CARD_REF}\n                - $ref: "#/components/schemas/CardList"`), /no published event type resolves to/],
  ['a new card event with no object mapped', 'spec', (t) => t.replace('card.closed,', 'card.closed, card.retried,'), /no entry in `cardObjectOf`/],
  ['an event the map still claims after the enum dropped it', 'spec', (t) => t.replace('card.closed, card.limits.updated', 'card.limits.updated'), /no longer publishes/],
  ['two union members claiming one object const', 'spec', (t) => t.replace('{ type: string, const: card }', '{ type: string, const: charge }'), /same `object` const/],
  ['the retired payload caveat back in the guide', GUIDE, (t) => t.replace('### What a card event carries', '### The card payload gap'), /still says "card payload gap"/],
  // The payout page is outside the two this check used to read, so this seed is the proof that the sweep really
  // widened: an invented `transfer.*` type on a family page must be caught, not just on the webhooks page.
  ['a family page names an event the contract never published', 'guides/payouts.md', (t) => t.replace('`transfer.pending`', '`transfer.completed`'), /does not publish/],
];

function seedBreaks(base) {
  const missed = [];
  for (const [label, where, mutate, expected] of seeds) {
    const input = { spec: base.spec, services: base.services, guides: { ...base.guides } };
    const original = where === 'spec' ? input.spec : input.guides[where];
    if (original === undefined) {
      missed.push(`${label}: this check does not read ${where}`);
      continue;
    }
    const mutated = mutate(original);
    if (mutated === original) {
      missed.push(`${label}: the seed did not change ${where}`);
      continue;
    }
    if (where === 'spec') input.spec = mutated;
    else input.guides[where] = mutated;
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

if (process.argv.includes('--self-test')) {
  const base = read();
  const clean = evaluate(base);
  if (clean.failures.length) {
    console.error(`Self-test cannot start: the published tree already fails.\n- ${clean.failures.join('\n- ')}`);
    process.exit(1);
  }
  const missed = seedBreaks(base);
  if (missed.length) {
    console.error(`check-guide-events self-test FAILED, ${missed.length} seeded break(s) not caught:\n- ${missed.join('\n- ')}`);
    process.exit(1);
  }
  console.log(`check-guide-events: ${seeds.length} seeded breaks caught, one per rule; the published tree passes clean.`);
} else {
  const base = read();
  const { failures, tally } = evaluate(base);
  if (failures.length) {
    console.error(`check-guide-events: ${failures.length} problem(s)\n- ${failures.join('\n- ')}`);
    process.exit(1);
  }
  const missed = seedBreaks(base);
  if (missed.length) {
    console.error(`check-guide-events: ${missed.length} seeded break(s) not caught:\n- ${missed.join('\n- ')}`);
    process.exit(1);
  }
  console.log(`${tally} ${seeds.length} seeded breaks caught.`);
}
