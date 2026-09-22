import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve(import.meta.dirname, '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const json = (path) => JSON.parse(read(path));

const jsonFiles = [
  'data/products.example.json', 'data/products.json',
  'data/faq.example.json', 'data/faq.json',
  'data/store-config.example.json', 'data/store-config.json',
  'samples/webhook-payload.json',
  'n8n/workflows/whatsapp-main.json', 'n8n/workflows/error-handler.json',
];
for (const path of jsonFiles) assert.doesNotThrow(() => json(path), `${path} must be valid JSON`);

for (const path of ['data/products.example.json', 'data/products.json']) {
  const products = json(path);
  assert.equal(products.length, 2, `${path} must contain only the two current products`);
  assert.deepEqual(products.map((product) => product.id), ['nike-double-face-jacket', 'cotton-montoni-tracksuit']);
  for (const product of products) {
    for (const key of ['id', 'name', 'category', 'price', 'currency', 'stock', 'sizes', 'aliases']) {
      assert.ok(Object.hasOwn(product, key), `${product.id} is missing ${key}`);
    }
    assert.deepEqual(product.sizes, ['S', 'M', 'L', 'XL']);
    assert.ok(product.aliases.length >= 5, `${product.id} needs data-driven multilingual aliases`);
    assert.equal(product.delivery?.free, true);
    assert.ok(Number.isFinite(product.price) && product.price >= 0);
  }
}

const config = json('data/store-config.example.json');
assert.deepEqual(config.languages, ['darija', 'arabic', 'french', 'english']);
assert.equal(config.delivery.free, true);
assert.equal(config.delivery.price_mad, 0);

const faq = json('data/faq.example.json');
for (const intent of ['delivery', 'payment', 'order', 'availability', 'returns']) {
  assert.ok(faq.some((entry) => entry.intent === intent), `FAQ must cover ${intent}`);
}

const payload = json('samples/webhook-payload.json');
assert.equal(payload.object, 'whatsapp_business_account');
assert.ok(payload.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.id?.startsWith('wamid.'));

const requiredMainNodes = [
  'Meta Verification Webhook', 'WhatsApp Messages Webhook', 'Validate Request',
  'Normalize Message', 'Load Customer Session and Deduplicate', 'Load Store Data',
  'Deterministic Security and Sales Router', 'AI Required?', 'Build Cloudflare AI Request',
  'Cloudflare Configured?', 'Call Cloudflare Workers AI', 'Validate Cloudflare AI Reply',
  'Save Conversation and Handoff State', 'Send WhatsApp Reply', 'Authorize and Clear Handoff',
];

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
function validateWorkflow(path, requiredNodes = []) {
  const workflow = json(path);
  const names = workflow.nodes.map((node) => node.name);
  assert.equal(new Set(names).size, names.length, `${path} node names must be unique`);
  for (const name of requiredNodes) assert.ok(names.includes(name), `${path} missing node ${name}`);
  for (const [source, groups] of Object.entries(workflow.connections)) {
    assert.ok(names.includes(source), `${path} connection source ${source} does not exist`);
    for (const outputs of Object.values(groups)) {
      for (const output of outputs) {
        for (const connection of output || []) assert.ok(names.includes(connection.node), `${path} target ${connection.node} does not exist`);
      }
    }
  }
  for (const codeNode of workflow.nodes.filter((item) => item.type === 'n8n-nodes-base.code')) {
    assert.doesNotThrow(
      () => new AsyncFunction(`return async function () {${codeNode.parameters.jsCode}}`),
      `${path}: embedded code in ${codeNode.name} must parse`,
    );
  }
  return workflow;
}

const main = validateWorkflow('n8n/workflows/whatsapp-main.json', requiredMainNodes);
const errorHandler = validateWorkflow('n8n/workflows/error-handler.json', ['Workflow Error Trigger', 'Create Safe Error Log']);
assert.equal(errorHandler.nodes.filter((item) => item.type === 'n8n-nodes-base.errorTrigger').length, 1);
assert.equal(main.connections['AI Required?'].main[1][0].node, 'Save Conversation and Handoff State');
assert.equal(main.connections['AI Required?'].main[0][0].node, 'Build Cloudflare AI Request');
assert.equal(main.connections['Validate Cloudflare AI Reply'].main[0][0].node, 'Save Conversation and Handoff State');

const aiNode = main.nodes.find((item) => item.name === 'Call Cloudflare Workers AI');
assert.equal(aiNode.parameters.url, '={{ $json.ai_endpoint }}');
assert.equal(aiNode.retryOnFail, true);
assert.equal(aiNode.maxTries, 2);
assert.equal(aiNode.parameters.options.timeout, 20000);
const authorization = aiNode.parameters.headerParameters.parameters.find((header) => header.name === 'Authorization')?.value || '';
assert.match(authorization, /CLOUDFLARE_API_TOKEN/);

const workflowText = read('n8n/workflows/whatsapp-main.json');
assert.doesNotMatch(workflowText, /AI_API_KEY|OPENAI_API_KEY|api\.groq\.com|api\.openai\.com/);
assert.match(workflowText, /response_source/);

const committedText = [read('.env.example'), read('docker-compose.yml'), ...jsonFiles.map(read)].join('\n');
assert.ok(!/\bsk-[A-Za-z0-9_-]{16,}\b/.test(committedText), 'an OpenAI-like secret was committed');
assert.ok(!/\bgsk_[A-Za-z0-9_-]{16,}\b/.test(committedText), 'a Groq-like secret was committed');
assert.ok(!/\bEAA[A-Za-z0-9]{20,}\b/.test(committedText), 'a Meta-like token was committed');
assert.ok(!/\b(?:cfut_|cfat_)[A-Za-z0-9_-]{20,}\b/.test(committedText), 'a Cloudflare token was committed');

const envKeys = new Set(read('.env.example').split(/\r?\n/)
  .filter((line) => /^[A-Z0-9_]+=/.test(line)).map((line) => line.split('=')[0]));
for (const key of [
  'N8N_HOST', 'N8N_PORT', 'N8N_PROTOCOL', 'N8N_ENCRYPTION_KEY',
  'WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_BUSINESS_ACCOUNT_ID',
  'WHATSAPP_VERIFY_TOKEN', 'WHATSAPP_APP_SECRET', 'HANDOFF_ADMIN_TOKEN',
  'CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_AI_MODEL',
  'CLOUDFLARE_AI_MAX_TOKENS', 'DATABASE_URL',
]) assert.ok(envKeys.has(key), `.env.example is missing ${key}`);

const compose = read('docker-compose.yml');
assert.match(compose, /restart:\s+unless-stopped/);
assert.match(compose, /n8n_data:\/home\/node\/\.n8n/);
assert.match(compose, /\.\/data:\/store-data:ro/);
assert.match(compose, /CLOUDFLARE_API_TOKEN/);

console.log('Structure, products, Cloudflare routing, embedded code, and secret checks: OK');
