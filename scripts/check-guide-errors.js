#!/usr/bin/env node
'use strict';

// guides/idempotency-and-errors.md is the page a developer opens when a call fails, so it has to answer for every code
// x-error-codes publishes, with the same status. Read both files and hold them together in three directions: a code
// missing from the table, a code the catalogue does not publish, and a status that disagrees.
//
// Two more directions came from the payouts page. A developer whose `POST /v1/transfers` call answers 409 does not
// open the catalogue first — they open the page for the resource they are calling, and that page carried no table at
// all, so "which of my mistakes is this?" was one click away from giving up. Hence: every family page owes a table
// (rule 6) and the payouts table owes every code its routes can answer (rule 7). The cards page owes the same list
// (rule 8), because the live seam added two codes to what a card route answers on 11 Nov and a page can only go stale
// one way this gate cannot see: a code that is simply never written down. No dependencies.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const CATALOGUE_LINE = /\{ code: ([a-z0-9_]+), type: ([a-z_]+), http_status: (\d+), retryable: (true|false)/g;
// A row is `| 409 | `code` … |`. The status cell is bare in some tables and backticked in others, and one cell may
// name two codes separated by `·`, so the code scan runs over whatever the second cell holds.
const ROW = /^\| `?(\d{3})`? \| (.*?) \|/;
const CODE_IN_CELL = /`([a-z0-9_]+)`/g;

// Pages that document one /v1 resource surface — where a developer lands when that surface refuses them.
const FAMILY_PAGES = [
  'cards.md', 'charges.md', 'fx.md', 'one-time-passwords.md', 'payment-links.md',
  'payouts.md', 'subaccounts.md', 'verifications.md', 'virtual-accounts.md',
];

// Shrink-only ledger: the family pages still carrying no table. Writing one for any of them means deleting its name
// here in the same commit, which is the point — this list is the record of what a developer cannot yet answer from
// the page they are on, and it may never get longer.
const PAGES_WITHOUT_A_TABLE = [
  'charges.md', 'fx.md', 'one-time-passwords.md', 'payment-links.md',
  'subaccounts.md', 'verifications.md', 'virtual-accounts.md',
];

// Every code the six /v1/transfers routes can answer, read off the server on 11 Nov. The radius matters, so it is
// written down by symbol, which is greppable in the server repo: the key-auth middleware (apiKeyAuth), the scope
// guard (requireScope), the per-key read/write limiters, the shared idempotency helper (serviceIdempotency), the v1
// body parsers and their 429/503/413 shapes, v1TransfersController, and the transfers helpers it calls —
// internationalTransfers, serviceCommon, pagination. A code is listed only where that source can actually throw it.
const PAYOUT_CODES = [
  'api_access_paused', 'body_too_large', 'business_inactive', 'duplicate_reference',
  'idempotency_in_progress', 'idempotency_key_required', 'idempotency_key_reused',
  'insufficient_scope', 'internal_error', 'invalid_api_key', 'invalid_json', 'invalid_parameter',
  'ip_not_allowed', 'live_mode_unavailable', 'rate_limited', 'resource_missing',
  'service_unavailable', 'transfer_not_pending',
];

// Every code the eleven /v1/cards routes can answer, read off the server on 11 Nov, the day the live seam landed.
// The radius, by symbol, because a card refusal can now come from four different places: the key-auth middleware
// (apiKeyAuth, including the new `key_expired`), the scope guard (scopes), the per-key limiters and the v1 body
// parsers and their 429/503/413 shapes (routes/v1.js), the shared idempotency helper, v1CardsController itself,
// and the seam (utils/devPlatform/liveCards.js: `live_precondition_unmet`, plus `service_unavailable` when the
// issuer refuses a freeze). `live_mode_unavailable` stays on the list because the simulator still answers it.
// This list is the reason a page can no longer be quietly stale: the seam changed what a live key hears on nine
// of these routes, and nothing in the earlier rules could see a code that was simply never written down.
const CARDS_CODES = [
  'api_access_paused', 'body_too_large', 'business_inactive', 'card_closed', 'card_limit_reached',
  'card_not_active', 'duplicate_reference', 'idempotency_in_progress', 'idempotency_key_required',
  'idempotency_key_reused', 'insufficient_balance', 'insufficient_scope', 'internal_error',
  'invalid_api_key', 'invalid_json', 'invalid_parameter', 'ip_not_allowed', 'key_expired',
  'live_mode_unavailable', 'live_precondition_unmet', 'rate_limited', 'resource_missing',
  'service_unavailable',
];

function readTable(text) {
  const codes = new Map();
  // A Map collapses a code listed in two rows into one entry, so a rule written against it cannot see the
  // duplicate. Every occurrence is recorded here instead: one code, two rows, two answers to print.
  const rows = new Map();
  let rowCount = 0;
  for (const line of text.split('\n')) {
    const row = line.match(ROW);
    if (!row) continue;
    rowCount += 1;
    for (const m of row[2].matchAll(CODE_IN_CELL)) {
      codes.set(m[1], Number(row[1]));
      if (!rows.has(m[1])) rows.set(m[1], []);
      rows.get(m[1]).push(line);
    }
  }
  return { codes, rows, rowCount };
}

// Everything below reads from `input` rather than from disk so the seeds at the foot of this file can feed it a
// tree with exactly one rule broken and check that the rule is what fired.
function evaluate(input) {
  const { spec } = input;
  const guides = input.guides;
  const failures = [];
  const start = spec.indexOf('\nx-error-codes:');
  const block = start < 0 ? '' : spec.slice(start, spec.indexOf('\n# Planned, NOT yet available'));
  if (!block) return { failures: ['x-error-codes was not found in openapi.yaml'], tally: '' };
  const catalogue = new Map([...block.matchAll(CATALOGUE_LINE)].map((m) => [m[1], Number(m[3])]));
  if (catalogue.size < 30) return { failures: ['The x-error-codes catalogue was not read'], tally: '' };

  const table = readTable(guides['idempotency-and-errors.md']);
  if (table.codes.size < 30) {
    return { failures: ['The error table in guides/idempotency-and-errors.md was not read'], tally: '' };
  }
  const rows = table.rows;

  // 1 to 3. The catalogue and the all-errors table answer for each other, in both directions, at one status each.
  const notOnThePage = [...catalogue.keys()].filter((code) => !table.codes.has(code));
  if (notOnThePage.length) failures.push(`x-error-codes lists a code the error guide does not: ${notOnThePage.join(', ')}`);
  const notPublished = [...table.codes.keys()].filter((code) => !catalogue.has(code));
  if (notPublished.length) failures.push(`The error guide names a code x-error-codes does not publish: ${notPublished.join(', ')}`);
  const disagreeing = [...table.codes]
    .filter(([code, status]) => catalogue.get(code) !== status)
    .map(([code, status]) => `${code}: guide says ${status}, catalogue says ${catalogue.get(code)}`);
  if (disagreeing.length) failures.push(`A guide status differs from the catalogue: ${disagreeing.join('; ')}`);

  // 4. A developer branches on `code`, so a code printed in two rows means two answers to the same question —
  // and the checks above cannot catch it, because both rows satisfy the status check and Map keeps only one.
  const duplicated = [...rows].filter(([, list]) => list.length > 1)
    .map(([code, list]) => `${code} is in ${list.length} rows:\n${list.map((l) => `    ${l}`).join('\n')}`);
  if (duplicated.length) failures.push(`An error code appears in more than one row of the guide table:\n${duplicated.join('\n')}`);

  // 5. Every guide also carries a `| HTTP | code |` table, and a code invented there reaches a developer as
  // surely as one invented on this page. Sweep them all against the same catalogue, so a guide cannot publish a
  // code the API does not return or attach it to the wrong status.
  let swept = 0;
  const stray = [];
  const wrongStatus = [];
  for (const [file, text] of Object.entries(guides)) {
    if (file === 'idempotency-and-errors.md') continue;
    text.split('\n').forEach((line, i) => {
      const row = line.match(ROW);
      if (!row) return;
      swept += 1;
      for (const m of row[2].matchAll(CODE_IN_CELL)) {
        if (!catalogue.has(m[1])) stray.push(`${file}:${i + 1} ${m[1]}`);
        else if (catalogue.get(m[1]) !== Number(row[1])) wrongStatus.push(`${file}:${i + 1} ${m[1]} (row ${row[1]}, catalogue ${catalogue.get(m[1])})`);
      }
    });
  }
  if (stray.length) failures.push(`A guide names an HTTP status and an error code the contract does not pair: ${stray.join('; ')}`);
  if (wrongStatus.length) failures.push(`A guide pairs an error code with a status the catalogue does not: ${wrongStatus.join('; ')}`);

  // 6. Existence. Nothing above required a family page to carry a table, which is how eight of nine shipped
  // without one while every row that did exist was checked rigorously.
  const missing = FAMILY_PAGES.filter((file) => readTable(guides[file]).rowCount === 0).sort();
  const newlyMissing = missing.filter((f) => !PAGES_WITHOUT_A_TABLE.includes(f));
  const nowWritten = PAGES_WITHOUT_A_TABLE.filter((f) => !missing.includes(f));
  if (newlyMissing.length) {
    failures.push(`A family page carries no HTTP/code table: ${newlyMissing.join(', ')}. Write one — the ledger in this gate lists ${PAGES_WITHOUT_A_TABLE.length} page(s) still owed and may only shrink.`);
  } else if (nowWritten.length) {
    failures.push(`${nowWritten.join(', ')} now carries a table — delete its name from PAGES_WITHOUT_A_TABLE in this gate so the ledger keeps telling the truth.`);
  }

  // 7. The payouts table owes every code its routes can answer, not a representative sample of them.
  const payout = readTable(guides['payouts.md']);
  const unexplained = PAYOUT_CODES.filter((code) => !payout.codes.has(code));
  if (unexplained.length) failures.push(`guides/payouts.md does not name code(s) the transfers routes can answer: ${unexplained.join(', ')}`);

  // 8. The same debt on the cards page, which is the one surface whose answer to a live key changed on 11 Nov. Rule 5
  // only catches a code that is written down wrongly, so a code that a seam newly made reachable and nobody ever wrote
  // down sailed through every check that existed.
  const cards = readTable(guides['cards.md']);
  const unnamed = CARDS_CODES.filter((code) => !cards.codes.has(code));
  if (unnamed.length) failures.push(`guides/cards.md does not name code(s) the card routes can answer: ${unnamed.join(', ')}`);

  return {
    failures,
    tally: `Error guide consistent: ${table.codes.size} codes, each with the catalogue's status, none listed twice; ${swept} rows in the other guides all match; ${FAMILY_PAGES.length - missing.length}/${FAMILY_PAGES.length} family pages carry a table; payouts names all ${PAYOUT_CODES.length} and cards all ${CARDS_CODES.length} codes their routes answer.`,
  };
}

function read() {
  const guides = {};
  for (const file of fs.readdirSync(path.join(root, 'guides')).sort()) {
    if (file.endsWith('.md')) guides[file] = fs.readFileSync(path.join(root, 'guides', file), 'utf8');
  }
  return { spec: fs.readFileSync(path.join(root, 'openapi.yaml'), 'utf8'), guides };
}

// Each seed breaks exactly one rule the published tree satisfies, and they run on every invocation rather than behind
// a flag nobody passes — a rule whose proof is optional rots alongside the rule it protects. A seed that fails to
// edit its target, or that edits something no rule cares about, is reported as a miss, not a pass.
const dropRow = (text, needle) => text.split('\n').filter((l) => !l.includes(needle)).join('\n');
const dropTable = (text) => text.split('\n').filter((l) => !ROW.test(l)).join('\n');
const duplicateFirstRow = (text) => `${text}\n${text.split('\n').find((l) => ROW.test(l))}\n`;

const seeds = [
  ['a payouts code disappears from the table', 'payouts.md',
    (t) => dropRow(t, '`transfer_not_pending`'), /does not name code/],
  ['a cards code disappears from the table', 'cards.md',
    (t) => dropRow(t, '| 409 | `card_limit_reached`'), /card routes can answer/],
  ['a family page loses its whole table', 'cards.md',
    (t) => dropTable(t), /carries no HTTP\/code table/],
  ['a payouts code is paired with the wrong status', 'payouts.md',
    (t) => t.replace('| 404 | `resource_missing`', '| 500 | `resource_missing`'), /a status the catalogue does not/],
  ['one code printed in two rows of the main table', 'idempotency-and-errors.md',
    duplicateFirstRow, /more than one row/],
  ['a code the contract never publishes', 'payouts.md',
    (t) => t.replace('`transfer_not_pending`', '`transfer_no_such_code`'), /does not pair/],
];

function seedBreaks(base) {
  const misses = [];
  for (const [label, file, mutate, expected] of seeds) {
    const original = base.guides[file];
    const mutated = mutate(original);
    if (mutated === original) {
      misses.push(`${label}: the seed did not change ${file}`);
      continue;
    }
    const { failures } = evaluate({ spec: base.spec, guides: { ...base.guides, [file]: mutated } });
    if (!failures.length) {
      misses.push(`${label}: nothing caught it`);
      continue;
    }
    if (!failures.some((f) => expected.test(f))) {
      misses.push(`${label}: caught as "${failures[0]}", expected /${expected.source}/`);
    }
  }
  return misses;
}

// A seed proves its rule by making it fire. On a tree that already fails that rule, the mutation is not what made
// the message appear — so refuse to claim the proof until the published tree is clean.
function seedReport(base) {
  if (evaluate(base).failures.length) return { line: 'seeded breaks not run: the published tree is already failing', bad: false };
  const misses = seedBreaks(base);
  if (misses.length) return { line: `SEEDED BREAKS NOT CAUGHT (${misses.length}/${seeds.length} missed): ${misses.join(' | ')}`, bad: true };
  return { line: `${seeds.length} seeded breaks caught.`, bad: false };
}

if (require.main === module) {
  const base = read();
  const { failures, tally } = evaluate(base);
  const seedsResult = seedReport(base);

  if (process.argv.includes('--self-test')) {
    if (failures.length) {
      console.error(`Self-test cannot start: the published tree already fails.\n- ${failures.join('\n- ')}`);
      process.exit(1);
    }
    const misses = seedBreaks(base);
    if (misses.length) {
      console.error(`check-guide-errors self-test FAILED, ${misses.length} seeded break(s) not caught:\n- ${misses.join('\n- ')}`);
      process.exit(1);
    }
    console.log(`check-guide-errors: ${seeds.length} seeded breaks caught, one per rule; the published tree passes clean.`);
  } else if (failures.length || seedsResult.bad) {
    console.error(`check-guide-errors: ${failures.length + (seedsResult.bad ? 1 : 0)} problem(s)`);
    for (const f of failures) console.error(`- ${f}`);
    if (seedsResult.bad) console.error(`- ${seedsResult.line}`);
    process.exit(1);
  } else {
    console.log(`${tally} ${seedsResult.line}`);
  }
}

module.exports = { evaluate, read, seeds, seedBreaks };
