// Builds postman/FirstFlip-API.postman_collection.json from openapi.yaml (the source of truth), then
// wires it for one-click use: bearer auth from {{secretKey}}, a fresh Idempotency-Key per POST, and
// the created charge's id saved to {{charge_id}} so the follow-up requests just work.
const fs = require('node:fs');
const path = require('node:path');
const Converter = require('openapi-to-postmanv2');


const WALKTHROUGH = `# FirstFlip API — start here

Accept crypto and get paid in your own currency. This collection is the whole API in **test mode**:
nothing here moves real money.

## Five steps to a paid test charge

1. **Pick the environment.** Top right, choose **FirstFlip Sandbox**.
2. **Paste your test key.** Open the collection's **Variables** tab and set \`secretKey\` to your
   \`ffk_test_…\` key (during the beta, FirstFlip issues it on request over a private channel).
   Keep it secret; never share a screenshot of it.
3. **Account → Retrieve the account for this key.** Press **Send**. You should see your business name
   and \`"livemode": false\`.
4. **Charges → Create a charge.** Press **Send**. You get a charge with a crypto amount and a
   \`hosted_url\`. The charge id is saved for you automatically.
5. **Sandbox → Simulate a payment**, then **Charges → Retrieve a charge**: the status is now \`paid\`.
   If FirstFlip registered a webhook endpoint for you, it just received a signed \`charge.paid\` event.

## Payment links

**Payment links → Create a payment link** makes one shareable link; each customer who opens it gets
their own charge. Its id is saved automatically, so **Retrieve** and **Deactivate** work right after.

## Run everything at once

Click the collection → **Run** → **Run FirstFlip API (v1)**. Every request checks its own status,
so you see green or red per step.

## When something fails

Open **Console** (bottom left). Failed requests log the FirstFlip error code, for example
\`amount_too_small\` or \`invalid_api_key\`. Every code is explained in the docs:
guides/idempotency-and-errors.md in the FirstFlip developer docs.

- **401 invalid_api_key**: the key is wrong, revoked, or still \`ffk_test_REPLACE_ME\`.
- **404 not_found on every request**: the Developer API isn't switched on yet.
- **403 live_mode_unavailable**: you used a live key; live mode isn't open yet.

Generated from openapi.yaml; don't edit by hand.`;

const STEP_NOTES = {
  'Retrieve the account for this key': 'Step 3 of the walkthrough. Checks your key works. Expect your business name and `livemode: false`.',
  'Create a charge': 'Step 4. Creates a charge for ₦32,000 paid in USDT. Change `amount`, `currency` or `reference` in **Body**. A fresh Idempotency-Key is sent every time, so pressing Send twice makes two charges; reuse a key to retry safely. The new id is saved to `charge_id`.',
  'List charges': 'Your charges, newest first. Tick the query params to filter by `status` or your own `reference`.',
  'Retrieve a charge': 'Uses the saved `charge_id`. After Simulate a payment, `status` is `paid`.',
  'Cancel a pending charge': 'Only a pending charge can be cancelled. Sends `charge.cancelled` to your webhook.',
  'Simulate a payment (test mode)': 'Step 5. Acts as if the customer paid in full: the charge becomes `paid` and your webhook gets `charge.paid`. Test mode only.',
  'Create a payment link': 'One link, many customers: each one who opens it gets their own charge. The id is saved to `payment_link_id`.',
  'List payment links': 'Your links with how many times each was used.',
  'Retrieve a payment link': 'Uses the saved `payment_link_id`. Open the `url` in a browser to see the customer page.',
  'Ask the FirstFlip API assistant': 'Change `question` in **Body** and press Send. Answers come from the FirstFlip docs only. 30 questions per key per hour.',
  'Deactivate a payment link': 'Stops the link creating new charges. Charges already made are unaffected.',
};

const root = path.join(__dirname, '..');
const spec = fs.readFileSync(path.join(root, 'openapi.yaml'), 'utf8');

// Each request checks the status its operation DECLARES, read out of the specs. Guessing from the name
// (`Create…` means 201) broke the day a resource answered 201 without being called a create: funding,
// withdrawing from and simulating an authorization on a card each write a ledger row and answer 201.
// A request whose name no operation carries falls back to the old guess.
const DECLARED_SUCCESS = (() => {
  const METHODS = ['get', 'post', 'put', 'patch', 'delete'];
  const map = new Map();
  const read = (doc, from) => {
    for (const item of Object.values(doc.paths || {})) {
      for (const method of METHODS) {
        const op = item[method];
        if (!op) continue; // a `$ref` path item: its operations come from the file they live in
        const code = Object.keys(op.responses || {}).find((c) => /^2\d\d$/.test(c));
        const name = op['x-display-name'] || op.summary;
        if (!code || !name) continue;
        if (map.has(name) && map.get(name) !== Number(code)) {
          throw new Error(`build-postman: "${name}" declares two different success statuses`);
        }
        map.set(name, Number(code));
      }
    }
    return from;
  };
  read(require('yaml').parse(spec), 'openapi.yaml');
  read(JSON.parse(fs.readFileSync(path.join(root, 'api', 'services.openapi.json'), 'utf8')), 'api/services.openapi.json');
  return map;
})();

Converter.convert({ type: 'string', data: spec }, {
  folderStrategy: 'Tags', requestParametersResolution: 'Example', exampleParametersResolution: 'Example',
  includeAuthInfoInExample: false, enableOptionalParameters: false,
}, (err, result) => {
  if (err || !result.result) throw err || new Error(result.reason);
  const col = result.output[0].data;

  col.info.name = 'FirstFlip API (v1)';
  col.info.description = WALKTHROUGH;
  // A fixed id, so re-importing a newer build offers "Replace" instead of making a second copy.
  col.info._postman_id = '6f1c2b1e-4a7d-4f0e-9a51-f1f1e0a1c0de';
  col.auth = { type: 'bearer', bearer: [{ key: 'token', value: '{{secretKey}}', type: 'string' }] };
  col.variable = [
    { key: 'baseUrl', value: 'https://api.firstflip.ng/v1', type: 'string' },
    { key: 'secretKey', value: 'ffk_test_REPLACE_ME', type: 'string' },
    { key: 'charge_id', value: '', type: 'string' },
    { key: 'payment_link_id', value: '', type: 'string' },
    { key: 'subaccount_id', value: '', type: 'string' },
    { key: 'card_id', value: '', type: 'string' },
    ...['otp_id', 'fx_quote_id', 'fx_trade_id', 'virtual_account_id', 'virtual_account_batch_id', 'bvn_verification_id', 'transfer_id', 'transfer_batch_id']
      .map((key) => ({ key, value: '', type: 'string' })),
  ];

  const walk = (items, folder = '') => items.forEach((it) => {
    if (it.item) return walk(it.item, it.name);
    const req = it.request;
    delete req.auth; // inherit collection auth
    delete it.response; // generated examples are noise; the spec holds the real ones
    req.header = (req.header || []).map((h) => (h.key === 'Idempotency-Key' ? { ...h, value: '{{$guid}}' } : h));
    // Path ids come from what the earlier requests saved, per resource; other folders keep the spec example.
    const idVar = { Charges: '{{charge_id}}', 'Payment links': '{{payment_link_id}}', 'Sub-accounts': '{{subaccount_id}}', Cards: '{{card_id}}' }[folder];
    (req.url.variable || []).forEach((v) => { if (v.key === 'id' && idVar) v.value = idVar; });
    const guide = STEP_NOTES[it.name];
    if (guide) req.description = guide;
    // Every request checks its own status, so "Run collection" shows green/red per step. The status is
    // the one its operation declares in the spec, not one guessed from the request's name: fund,
    // withdraw and simulate-authorization on a card each create a ledger row and answer 201.
    const expect = DECLARED_SUCCESS.has(it.name) ? DECLARED_SUCCESS.get(it.name) : (it.name.startsWith('Create') ? 201 : 200);
    // Keep any id-saving the services source already declares; the status check goes first.
    const keepExec = (it.event || []).filter((e) => e.listen === 'test').flatMap((e) => e.script?.exec || []);
    it.event = [{ listen: 'test', script: { type: 'text/javascript', exec: [
      `pm.test('${it.name}: HTTP ${expect}', () => pm.response.to.have.status(${expect}));`,
      "if (pm.response.code >= 400) { const e = pm.response.json().error || {}; console.log(`FirstFlip error ${e.code}: ${e.message}`); }",
      ...keepExec,
    ] } }];
    if (req.url.query) req.url.query.forEach((q) => { q.disabled = true; });
    // Save the new object's id so the next steps run without copy-pasting.
    const saveAs = { 'Create a charge': 'charge_id', 'Create a payment link': 'payment_link_id', 'Create a sub-account': 'subaccount_id', 'Create a card': 'card_id' }[it.name];
    if (saveAs) it.event[0].script.exec.push(`const b = pm.response.json(); if (b.id) pm.collectionVariables.set('${saveAs}', b.id);`);

  });
  // The /services paths are $refs into api/services.openapi.json, which the converter does not follow.
  // Their requests come from the server-side collection that check-service-contract keeps in lockstep
  // with that spec; re-generating them here would also inject random faker values and break `check`.
  const services = JSON.parse(fs.readFileSync(path.join(root, 'api', 'services.postman_collection.json'), 'utf8'));
  // A request URL is a string or an object; both carry the sandbox base-url placeholder.
  services.item.forEach((it) => {
    const u = it.request.url;
    if (typeof u === 'string') it.request.url = u.replace('{{base_url}}', '{{baseUrl}}');
    else {
      u.raw = u.raw.replace('{{base_url}}', '{{baseUrl}}');
      u.host = (u.host || []).map((h) => h.replace('{{base_url}}', '{{baseUrl}}'));
    }
  });
  col.item.push(services);

  walk(col.item);
  // The converter stamps random uuids on every run; derive stable ones so a rebuild is byte-identical
  // (npm run check compares the committed file with a fresh build).
  const crypto = require('node:crypto');
  const stableIds = (items, trail) => items.forEach((it) => {
    const h = crypto.createHash('sha1').update(`${trail}/${it.name}`).digest('hex');
    it.id = `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
    if (it.item) stableIds(it.item, `${trail}/${it.name}`);
  });
  stableIds(col.item, '');
  col.item = col.item.filter((f) => !f.item || f.item.length); // webhooks are inbound, not requests

  fs.writeFileSync(path.join(root, 'postman', 'FirstFlip-API.postman_collection.json'), JSON.stringify(col, null, 2) + '\n');
  fs.writeFileSync(path.join(root, 'postman', 'FirstFlip-Sandbox.postman_environment.json'), JSON.stringify({
    name: 'FirstFlip Sandbox',
    values: [
      { key: 'baseUrl', value: 'https://api.firstflip.ng/v1', type: 'default', enabled: true },
      { key: 'secretKey', value: '', type: 'secret', enabled: true },
    ],
  }, null, 2) + '\n');
  console.log('postman collection + environment written');
});
