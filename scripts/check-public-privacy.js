#!/usr/bin/env node
'use strict';

// Everything this repository publishes is read by strangers: developers, their agents, and anyone who finds the
// domain. Two things must never ride along. The first is credential material — a live key, token, signing secret or
// password, including one pasted into an example that was meant to be synthetic, because git keeps the value forever
// even after the page is fixed and a revoked key still proves who the owner was. The second is the shape of the
// private monorepo: a source path or a `file.ext:NN` citation points at code strangers
// never see, names internal modules, and turns a copy-pasteable error message into a map of the implementation.
//
// The blunt version of this check is worth less than nothing. Scanning the exported surface for "long random-looking
// token" returns 1,300+ matches — `X-RateLimit-Remaining`, `/components/headers/RequestId`, `FIRSTFLIP_SECRET_KEY`,
// every Postman folder uuid, `openapi-to-postmanv2` — and a gate with 176 findings on a clean tree gets muted inside a
// week, which is how a real leak gets published behind a green build. So three rules only, each chosen because it is
// loud for a leak and quiet for prose:
//
//   1. credential-shaped  a value that is *only* credential-shaped: a vendor secret prefix (`sk_live_`, `AKIA…`,
//      `ghp_`, `AIza…`, `xoxb-`, `ya29.`, and FirstFlip's own two — `ffk_live_`/`ffk_test_` and `whsec_`), a
//      `BEGIN … PRIVATE KEY` marker with material beside it, a JWT (`eyJ…` with two dots), or a scheme URL that
//      carries its password inline (`mongodb://` with `user:password@host` written into it). Also a 32+ character
//      mixed-case-plus-digit run that is not a canonical uuid — that is the base58/base64 key shape.
//      The mixed-case requirement is why the prefix list has to name every family this API issues: both FirstFlip
//      credentials are 48 *lowercase* hex, so no length-or-entropy rule can ever see them and only the prefix can.
//      Counting-hex test fixtures (`0a1b2c3d4e5f…`) are not this shape and are not scored — but a fixture is excused
//      by its own text, never by a prefix's: `ffk_test_REPLACE_ME` and a 48-zero body are templates, `ffk_test_` plus
//      a body with variety is a key.
//   2. secret name + literal  a line that names a secret (`api_key`, `secret`, `token`, `password`, …) AND gives it a
//      literal that passes rule 1's credential test, in any of the shapes a leak arrives in: `KEY: "v"`, `KEY=v`,
//      `"token": "v"`, `--api-key v`, `Authorization: Bearer v`. A placeholder is exempt (<…>, $VAR, process.env.X,
//      {{var}}, your-…, example…, xxxx) because every guide tells developers to write one; so is any env-var NAME,
//      which is the whole point of `FIRSTFLIP_SECRET_KEY` appearing 120 times.
//   3. internal path  a monorepo path (`apps/…`, `packages/…`) or a `file.ext:NN` citation, allow-listed by file and
//      string. Two mentions are allowed, both Postman `description` fields pointing at the monorepo collection the
//      export was built from; a third is a finding rather than an accident.
//
// `--corpus` prints what each rule saw, which is how the allow-list is audited rather than guessed. `--self-test`
// seeds one break per rule and one noisy non-break per rule (a package name, a camelCase identifier, a counting-hex
// fixture, an overwrite-me key template, a content-type value) and fails if a rule catches none of its breaks or trips
// on any of its controls — so a green run means the reader both works and stays quiet, not only that the pages are
// clean. The FirstFlip prefixes are seeded at the length the generators actually issue them at, which is what caught
// this file being blind to its own API's keys: 11 breaks and 12 controls now, where it was 8 and 9.
//
//   node scripts/check-public-privacy.js             gate: exit 0 clean, exit 1 on a leak, a dead rule or a shouty one
//   node scripts/check-public-privacy.js --corpus    inventory only: what is on the surface, never a verdict
//   node scripts/check-public-privacy.js --self-test reader check: seeded breaks caught, seeded noise ignored
//
// This gate is exported, so its own file is scored like everything else — except the regions delimited by
// `>>> shipped literals` / `<<< shipped literals`, whose whole job is to repeat a credential literal or an internal
// path so a rule can be tested or an allow-list stated. A secret written anywhere else in this script is a finding,
// and an unclosed region stops the run rather than widening the exemption.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

// The exemption this script grants itself is cut by marker line, not by filename: every seed value and both allow-list
// strings are repeated inside a pair on purpose, and anything written outside one is scored like any other page. A
// region is blanked line by line rather than spliced out, so a finding in this file still names a real line number.
const SELF = path.relative(root, __filename).split(path.sep).join('/');
const FIXTURE_START = '// >>> shipped literals';
const FIXTURE_END = '// <<< shipped literals';

const scoreable = (rel, text) => {
  if (rel !== SELF) return text;
  let inside = false;
  const lines = text.split('\n').map((line) => {
    const open = line.startsWith(FIXTURE_START);
    const close = line.startsWith(FIXTURE_END);
    if (open) inside = true;
    const blank = open || close || inside;
    if (close) inside = false;
    return blank ? '' : line;
  });
  if (inside) die(`${rel}: a "shipped literals" region never closes — an allow-list nobody can locate is an allow-list that has grown, so the surface is not scored`);
  return lines.join('\n');
};

const SECRET_NAME =
  /\b(api[_-]?key|apikey|secret[_-]?key|secretkey|access[_-]?key|private[_-]?key|auth[_-]?key|signing[_-]?key|encryption[_-]?key|client[_-]?secret|app[_-]?secret|webhook[_-]?secret|token|secret|password|passwd|passphrase)\b/i;

const PLACEHOLDER =
  /^(?:<|\$\(|\$|%|process\.env|\{\{__|\{\{|yours?[-_]|exampl|sample|placeholder|dummy|fake|redacted|removed|xxx+\*|\*|0a1b2c3d|3a4b5c6d|5b4a)/i;

// A fixture whose own text says so: `<object>_test_<hex>`, `TEST-<ASSET>-<hex>`. Guides carry hundreds of these and
// each is a demonstration of a response shape, not a value anyone could revoke.
const TEST_MARKER = /(?:^|[_-])(?:test|sample|example|dummy)(?:[_-]|$)/i;

// High-entropy and harmless, for a reason the reader can check rather than a length rule it has to trust.
// >>> shipped literals
const NAMED = new Map([
  ['7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU', 'Solana destination address in the payouts example, copied from upstream web3.js docs'],
  ['9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM', 'second Solana destination address in the same SDK example'],
]);
// <<< shipped literals

// A canonical uuid (8-4-4-4-12 hex) is an identifier shape, not a key shape.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// `"integrity": "sha512-<base64>"` is an npm content digest: it is published to prove the tarball, and every lockfile
// on earth is made of them. Scoring them is how a gate gets muted.
const NPM_INTEGRITY = /^sha\d{3}-[A-Za-z0-9+/]{20,}={0,3}$/;

// A `data:...;base64,` URL carries embedded artwork, not a key. The payload is still run through the decoder check
// below, so muting this shape cannot mute a base64 secret that happens to be written as a data URI.
const DATA_URI = /data:[-\w./+]*;base64,([A-Za-z0-9+/=]+)/g;

// base64 that decodes to readable text is embedded content — Redoc inlines SVG icons this way. A key does not decode
// to prose, so a printable ratio above 60% separates the two without naming either. Invalid bytes become the
// replacement character when decoded as utf8, and that is the mark of entropy, so it is a fail, not "printable".
const dataUriText = (v) => {
  if (v.length % 4 || !/^[A-Za-z0-9+/]{24,}={0,2}$/.test(v)) return false;
  let decoded;
  try {
    decoded = Buffer.from(v, 'base64').toString('utf8');
  } catch {
    return false;
  }
  if (!decoded.length || decoded.includes('\uFFFD') || decoded.includes('\u0000')) return false;
  const printable = [...decoded].filter((c) => c === '\n' || c === '\t' || (c >= ' ' && c <= '~')).length;
  return printable / decoded.length > 0.6;
};

// FirstFlip issues two credentials, and both are `prefix + 48 lowercase hex` from `crypto.randomBytes(24)`:
// utils/devPlatform/keys.js mints `ffk_<mode>_<hex>` and utils/devPlatform/webhooks.js mints `whsec_<hex>`. Lowercase
// hex is precisely what HIGH_ENTROPY below cannot see (it demands a capital letter), and neither prefix was in this
// alternation, so until 10 Nov a live key or a signing secret pasted into a guide was invisible to the only gate that
// reads every published page. The `--self-test` rows seed both at their issued length.
const VENDOR_KEY =
  /\b(?:(?:sk|pk|rk|ffsk|ffpk|ffsec|ffk)_(?:live|test|prod|sandbox)_[A-Za-z0-9_-]{8,}|whsec_[A-Za-z0-9_-]{16,}|AKIA[0-9A-Z]{16}|ASIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{35}|xox[bpars]-[A-Za-z0-9-]{20,}|ya29\.[A-Za-z0-9_-]{20,}|glpat-[A-Za-z0-9_-]{20,}|sg-[A-Za-z0-9_-]{20,}|npm_[A-Za-z0-9]{30,}|sh_(?:pp_|pat_|sk_|standard_)[A-Za-z0-9_]{20,})/;

// The body decides whether a prefix carries a key or a template. Guides ship `ffk_test_REPLACE_ME` and a 48-zero
// fixture as the thing a developer overwrites, so a word body or a single repeated character is not scored; anything
// with variety is, because a test-mode key is still a key someone could use.
const PREFIXED = /^(?:(?:sk|pk|rk|ffsk|ffpk|ffsec|ffk)_(?:live|test|prod|sandbox)_|whsec_)([A-Za-z0-9_-]+)$/;
const SYNTH_BODY = /^(?:replace\w*|your[\w-]*|change\w*|changing\w*|placeholder|todo|fixme|x{3,}\**|\*+|(.)\1+)$/i;

/** True when a VENDOR_KEY match is a key rather than an overwrite-me template. Only a body this list can split (a
 *  `prefix_body` shape) is ever excused, so a vendor shape the alternation does not parse keeps scoring as before. */
function isVendorKey(v) {
  const m = PREFIXED.exec(v);
  return m ? !SYNTH_BODY.test(m[1]) : true;
}

const PRIVATE_KEY_BLOCK = /-----BEGIN [A-Z ]*PRIVATE KEY-----(?:.|\n){0,120}?[A-Za-z0-9+/]{40,}/;
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/;
const URL_CREDENTIAL = /\b(?:mongodb(?:\+srv)?|postgres(?:ql)?|mysql|mariadb|redis|amqps?|mssql|sftp|ftps?|smtp|https?)[:\/\/][^\s'"]*?:[^\s@/'"]{4,}@[A-Za-z0-9.-]+/i;
const HIGH_ENTROPY = /\b(?=[A-Za-z0-9]{32,}(?![A-Za-z0-9]))(?=[A-Za-z0-9]{0,32}[a-z])(?=[A-Za-z0-9]{0,32}[A-Z])[A-Za-z0-9]{32,}\b/g;

/** Rule 1: does this string look only like a credential? Returns a reason, or null. */
function credentialShape(v) {
  if (!v || UUID.test(v)) return null;
  // The shapes below are credentials even when the prose around them calls them examples, and a `_test_`/`live_`
  // segment is part of the prefix, not a disclaimer: a test-mode key is still a key someone could use.
  if (VENDOR_KEY.test(v) && isVendorKey(v)) return 'a vendor/FirstFlip secret prefix';
  if (JWT.test(v)) return 'a JWT';
  if (URL_CREDENTIAL.test(v)) return 'a password inside a connection string';
  if (PLACEHOLDER.test(v) || TEST_MARKER.test(v)) return null;
  if (NAMED.has(v)) return null;
  if (dataUriText(v)) return null;
  const mixed = v.match(HIGH_ENTROPY);
  if (mixed) {
    let lower = 0;
    let upper = 0;
    let digit = 0;
    for (const c of mixed[0]) {
      if (/[a-z]/.test(c)) lower++;
      else if (/[A-Z]/.test(c)) upper++;
      else if (/[0-9]/.test(c)) digit++;
    }
    // A credential mixes all three classes; a slug, a package name or a date does not, and neither does a hex id
    // (no capitals at all). Requiring all three plus 32 characters is what keeps this rule quiet.
    if (lower && upper && digit) return 'a 32+ character mixed-case-plus-digit run (base58/base64 key shape)';
  }
  return null;
}

const ruleOne = (line) => {
  // An `integrity` field's base64 body is a content digest, and a lockfile is nothing else; scored out at the line
  // so the rest of the line stays scannable. Data URIs are scored out only when the payload decodes to text.
  const scan = line
    .replace(/"integrity"\s*:\s*"sha\d{3}-[A-Za-z0-9+/=]{20,}"/g, '"integrity": "<digest>"')
    .replace(DATA_URI, (whole, payload) => (dataUriText(payload) ? '"<data-uri>"' : whole));
  const shapes = [];
  for (const re of [VENDOR_KEY, JWT, URL_CREDENTIAL]) {
    const m = scan.match(re);
    if (m) shapes.push(credentialShape(m[0]) ? m[0].slice(0, 48) : null);
  }
  for (const m of scan.matchAll(HIGH_ENTROPY)) {
    if (credentialShape(m[0])) shapes.push(m[0].slice(0, 48));
  }
  return [...new Set(shapes.filter(Boolean))];
};

// Internal-path mentions the published surface is allowed to carry, keyed by file then the string mentioned. Both are
// Postman collection `description` fields pointing at the monorepo collection the export was generated from; a
// developer cannot resolve either, so they are noise rather than a leak — and they are the only two.
// >>> shipped literals
const PATH_ALLOW = new Map([
  ['api/services.postman_collection.json', new Set(['apps/server/docs/api/FirstFlip.postman_collection.json'])],
  ['postman/FirstFlip-API.postman_collection.json', new Set(['apps/server/docs/api/FirstFlip.postman_collection.json'])],
]);
// <<< shipped literals

const PATH_CITE = /\b(?:apps|packages|libs)\/[A-Za-z0-9_.\/-]+|\b[\w./-]+\.(?:js|ts|tsx|jsx|py|rb|go|java|kt|swift|rs)\b:\d+/g;

function inspect(rel, text) {
  const problems = [];
  const lines = text.split('\n');

  // A pasted private key is the one shape that spans lines, so it is read across them: the marker plus 40+ characters
  // of base64 within the next six lines is material, while a BEGIN…PRIVATE KEY marker alone in prose is not.
  lines.forEach((line, i) => {
    const marker = line.match(/-----BEGIN [A-Z ]*PRIVATE KEY-----/);
    if (!marker) return;
    const body = lines.slice(i, i + 7).join('');
    const material = body.replace(/-----[^-]*-----/g, '').replace(/\s+/g, '');
    if (/[A-Za-z0-9+/]{40,}/.test(material)) problems.push(`${rel}:${i + 1}: private key material follows the "${marker[0]}" marker — remove the block; if it was ever deployed, the key pair is exposed`);
  });

  lines.forEach((line, i) => {
    const at = `${rel}:${i + 1}`;

    for (const shape of ruleOne(line)) problems.push(`${at}: credential-shaped value "${shape}" on a public page — remove it, and if it was ever real, rotate it`);

    if (SECRET_NAME.test(line)) {
      const given = line.match(/(?:[:=]|--?[A-Za-z][\w-]*\s)\s*["'`]?([A-Za-z0-9+/=_-]{12,})["'`]?/);
      if (given) {
        const why = credentialShape(given[1]);
        if (why) problems.push(`${at}: a secret name is given a literal ("${given[1].slice(0, 40)}" — ${why}); reference the env var name instead`);
      }
    }

    for (const m of line.matchAll(PATH_CITE)) {
      const allow = PATH_ALLOW.get(rel);
      if (allow && allow.has(m[0])) continue;
      problems.push(`${at}: internal path "${m[0]}" — this points at source that is not published; describe the behaviour instead of citing the file`);
    }
  });
  return problems;
}

// >>> shipped literals
// Each entry is [what it proves, the file it is pretended to live in, page, expectProblems]. The noise rows are as
// load-bearing as the break rows: they are why the gate can be run on every build instead of being muted.
const SEEDS = [
  ['a vendor secret prefix', 'seed.md', "# Guide\n\nUse `" + ['sk', 'live', 'aB'.repeat(12)].join('_') + "` here.\n", true],
  ['a FirstFlip live key', 'seed.md', '# Guide\n\napi_key: "ffsk_live_9x7Kq2ZmR4tP8wN1vB6cD3fA"\n', true],
  // The three shapes this file was blind to until 10 Nov, seeded as the generators actually make them — 48 lowercase
  // hex from `crypto.randomBytes(24)` — not as the mixed-case placeholder shape the rule happened to recognise.
  ['a FirstFlip live key in the shape it is issued', 'seed.md', '# Guide\n\nUse `ffk_live_8c1f4b90a7e25d361c08fb49e5a72d013f6b98ca40e157d2` here.\n', true],
  ['a FirstFlip test key in the shape it is issued', 'seed.md', '# Guide\n\nSet FIRSTFLIP_SECRET_KEY=ffk_test_8c1f4b90a7e25d361c08fb49e5a72d013f6b98ca40e157d2\n', true],
  ['a FirstFlip webhook signing secret', 'seed.md', '# Guide\n\nThe endpoint secret is `whsec_8c1f4b90a7e25d361c08fb49e5a72d013f6b98ca40e157d2`.\n', true],
  ['a private key block', 'seed.md', '# Guide\n\n-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA7xKXtg2CW87d97TXJSDpbD5jBkheTqA83T\n-----END-----\n', true],
  ['a connection-string password', 'seed.md', '# Guide\n\n`mongodb://admin:Tr0ub4dor3xSecurePass@db.internal:27017/app`\n', true],
  ['a JWT', 'seed.md', '# Guide\n\nSend `Authorization: Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryL4tPkPIkGB1aIkcK3m8vtNJ7z2Mu8kT8vl1`.\n', true],
  ['a base58-shaped key under a secret name', 'seed.md', '# Guide\n\nSet webhook_secret = 5UbaJKc4kQvVxhYnP2rWTLBsF8dGmZrQwNcXyHtKp3Rm\n', true],
  ['a monorepo path citation', 'seed.md', '# Guide\n\nSee apps/server/controllers/someController.js for the handler.\n', true],
  ['a file:line citation', 'seed.md', '# Guide\n\nThe gate lives in scripts/check-guide-paths.js:42.\n', true],

  ['a content-type value', 'seed.md', '# Guide\n\nSet `Content-Type: "application/json"` and `Authorization: Bearer <your access key>`.\n', false],
  ['a camelCase identifier', 'seed.md', '# Guide\n\nCall `buildRequest` with `idempotencyKey`, then read `X-RateLimit-Remaining`.\n', false],
  ['a counting-hex test fixture', 'seed.md', '# Guide\n\nThe card id is `card_test_3a4b5c6d7e8f90122a3b4c5d` and the event is `evt_3b1f0c9a8e7d6c5b4a392817`.\n', false],
  ['a package name', 'seed.md', '# Guide\n\nBuilt with `openapi-to-postmanv2`; the sample id is `fund-card-1042-first-tranche`.\n', false],
  ['a canonical uuid', 'seed.md', '# Guide\n\nThe run id was `2708a067-20f4-4da0-70c7-9696acc0f51c`.\n', false],
  ['an env var name', 'seed.md', '# Guide\n\nExport `FIRSTFLIP_SECRET_KEY` and `YOCO_SECRET_KEY`.\n', false],
  // The three templates the tightened prefixes now see on the real surface. Each is a control, not a break: guides
  // tell developers to overwrite the first, and the other two are fixtures that carry no entropy to revoke.
  ['the overwrite-me key template', 'seed.md', '# Guide\n\nSet `FIRSTFLIP_SECRET_KEY=ffk_test_REPLACE_ME` and export it.\n', false],
  ['the all-zero fixture key', 'seed.md', '# Guide\n\nThe CLI tests sign with `ffk_test_000000000000000000000000000000000000000000000000`.\n', false],
  ['a short signing-secret fixture', 'seed.md', '# Guide\n\nThe verifier test uses `whsec_test` and `whsec_other`.\n', false],
  ['an npm integrity digest', 'seed.json', '{\n  "node_modules/ajv": {\n    "version": "6.12.6",\n    "resolved": "https://registry.npmjs.org/ajv/-/ajv-6.12.6.tgz",\n    "integrity": "sha512-j3fVLgvTo527anyYyJOGTYJbG+vnnQYvE0m5mmkc1TK+nxAppkCLMIL0aZ4dblVCNoGShhm+kzE4ZUykBoMg4g==="\n  }\n}\n', false],
  ['a base64 SVG data uri', 'seed.html', '# Guide\n\n<img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PHBhdGggZD0iTTMgM2gxOHYxOEgzeiIvPjwvc3ZnPg==" />\n', false],
  ['the allow-listed internal mention', 'postman/FirstFlip-API.postman_collection.json', 'postman/FirstFlip-API.postman_collection.json\n\nbuilt from apps/server/docs/api/FirstFlip.postman_collection.json\n', false],
];
// <<< shipped literals

// >>> shipped literals
// The exemption is proven rather than asserted: this literal is ignored inside a declared region and caught outside
// one, so a region that quietly grew cannot be mistaken for a clean surface.
const REGIONS = [
  ['inside a declared region', `// Guide\n${FIXTURE_START}\nsk_live_4eC39HqLyjWDarjtT1zdp7dc\n${FIXTURE_END}\n// end\n`, 0],
  ['outside any region', '# Guide\n\nsk_live_4eC39HqLyjWDarjtT1zdp7dc\n', 1],
];
// <<< shipped literals

function selfTest() {
  const problems = [];
  for (const [name, rel, page, shouldFail] of SEEDS) {
    const found = inspect(rel, page).length > 0;
    if (shouldFail && !found) problems.push(`self-test: nothing caught ${name} — that rule is not working`);
    if (!shouldFail && found) {
      problems.push(`self-test: the gate shouted at ${name} — a noisy rule gets muted and the next leak ships`);
    }
  }
  for (const [where, page, want] of REGIONS) {
    const got = inspect(SELF, scoreable(SELF, page)).length;
    if (got !== want) problems.push(`self-test: a credential literal ${where} gave ${got} finding(s), expected ${want} — the self-exemption is not the size its markers claim`);
  }
  return problems;
}

const mode = process.argv.includes('--corpus') ? 'corpus' : process.argv.includes('--self-test') ? 'self-test' : 'gate';

if (mode === 'self-test') {
  const problems = selfTest();
  if (problems.length) {
    console.error(`check-public-privacy self-test: ${problems.length} problem(s)`);
    for (const p of problems) console.error(`  ${p}`);
    process.exit(1);
  }
  const breaks = SEEDS.filter(([, , , f]) => f).length;
  const controls = SEEDS.filter(([, , , f]) => !f).length;
  console.log(`check-public-privacy self-test: ${breaks} seeded leaks caught, ${controls} seeded noise ignored.`);
  process.exit(0);
}

const exported = () => require('./public-files').readPublicFiles(root);

const files = exported();
if (files.length < 10) die(`only ${files.length} exported paths resolved from the public file inventory — the export list changed shape`);

const dead = selfTest();
if (dead.length) {
  console.error('check-public-privacy: the reader itself is broken, so the surface is not scored');
  for (const p of dead) console.error(`  ${p}`);
  process.exit(1);
}

const shapes = new Map();
const paths = new Map();
const found = [];
for (const rel of files) {
  const file = path.join(root, rel);
  if (!fs.existsSync(file)) {
    found.push(`${rel}: exported but missing from the tree`);
    continue;
  }
  const text = scoreable(rel, fs.readFileSync(file, 'utf8'));
  text.split('\n').forEach((line, i) => {
    for (const s of ruleOne(line)) shapes.set(s, `${rel}:${i + 1}`);
    for (const m of line.matchAll(PATH_CITE)) if (!PATH_ALLOW.get(rel)?.has(m[0])) paths.set(m[0], `${rel}:${i + 1}`);
  });
  found.push(...inspect(rel, text));
}

if (mode === 'corpus') {
  console.log(`check-public-privacy corpus: ${files.length} exported files — ${shapes.size} credential-shaped values, ${paths.size} internal-path mentions (allow-list carries ${[...PATH_ALLOW.values()].reduce((n, s) => n + s.size, 0)})`);
  for (const [s, at] of shapes) console.log(`  shape  ${at.padEnd(48)} ${s}`);
  for (const [p, at] of paths) console.log(`  path   ${at.padEnd(48)} ${p}`);
  process.exit(0);
}

const unique = [...new Set(found)];
if (unique.length) {
  console.error(`check-public-privacy: ${unique.length} problem(s)`);
  for (const p of unique) console.error(`  ${p}`);
  process.exit(1);
}
console.log(
  `check-public-privacy: ${files.length} exported files carry 0 credential-shaped values and 0 internal-path mentions beyond the ${[...PATH_ALLOW.values()].reduce((n, s) => n + s.size, 0)} allow-listed ones; ${SEEDS.filter(([, , , f]) => f).length} seeded leaks caught and ${SEEDS.filter(([, , , f]) => !f).length} seeded noise ignored.`,
);

function die(message) {
  console.error(`check-public-privacy: ${message}`);
  process.exit(1);
}
