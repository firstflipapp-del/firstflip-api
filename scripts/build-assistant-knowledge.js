// Builds assistant/knowledge.md: the ONLY material the FirstFlip Developer AI assistant answers from
// (served by the API at POST /v1/assistant). Generated from the published guides + openapi.yaml, so the
// assistant can't know more, or other, than the docs say. Copy it to the FirstFlip server whenever it
// changes (npm run build does the generation).
const fs = require('node:fs');
const path = require('node:path');
const YAML = require('yaml');

const root = path.join(__dirname, '..');
// `npm run build:assistant` bundles first, so the $ref'd services paths are inlined here.
const spec = YAML.parse(fs.readFileSync(path.join(root, '.build', 'openapi.yaml'), 'utf8'));

const endpoints = [];
// A $ref names a component, not the wire parameter: printing the component key told the assistant to send
// `CreatedFrom`/`StartingAfter`/`ChargeId`, none of which the API accepts. Resolve to the real `name`.
const paramName = (x) => {
  if (!x.$ref) return x.name;
  const component = (spec.components?.parameters || {})[x.$ref.split('/').pop()];
  return component?.name;
};
for (const [p, ops] of Object.entries(spec.paths || {})) {
  for (const [method, op] of Object.entries(ops)) {
    if (!op || typeof op !== 'object' || !op.summary) continue;
    const params = (op.parameters || []).map(paramName).filter(Boolean);
    endpoints.push(`- ${method.toUpperCase()} /v1${p} — ${op.summary}${params.length ? ` (params: ${params.join(', ')})` : ''}`);
  }
}
const webhooks = Object.keys(spec.webhooks || {}).map((w) => `- ${w}: ${spec.webhooks[w].post?.summary || ''}`);

const order = ['quickstart', 'authentication', 'who-controls-what', 'charges', 'payment-links', 'subaccounts', 'cards', 'payouts', 'fx', 'virtual-accounts', 'verifications', 'one-time-passwords', 'assistant', 'agents', 'webhooks', 'idempotency-and-errors', 'testing', 'going-live'];
// A guide missing from `order` is invisible to the assistant, so the build fails instead of shipping the gap.
const unlisted = fs.readdirSync(path.join(root, 'guides'))
  .map((f) => f.replace(/\.md$/, ''))
  .filter((g) => !order.includes(g));
if (unlisted.length) throw new Error(`guides missing from the assistant knowledge: ${unlisted.join(', ')}`);
const guides = order
  .filter((g) => fs.existsSync(path.join(root, 'guides', `${g}.md`)))
  .map((g) => `\n\n<guide name="${g}">\n${fs.readFileSync(path.join(root, 'guides', `${g}.md`), 'utf8').trim()}\n</guide>`);

const out = `# FirstFlip API knowledge (generated from firstflip-developers; do not edit by hand)

Base URL: https://api.firstflip.ng/v1 — status: beta, test mode only (ffk_test_ keys).

## Endpoints
${endpoints.join('\n')}

## Webhook events
${webhooks.join('\n')}
${guides.join('')}
`;
fs.mkdirSync(path.join(root, 'assistant'), { recursive: true });
fs.writeFileSync(path.join(root, 'assistant', 'knowledge.md'), out);
console.log(`assistant/knowledge.md: ${out.length} chars, ${endpoints.length} endpoints`);
