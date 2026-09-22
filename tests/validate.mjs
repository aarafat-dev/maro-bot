import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve(import.meta.dirname, '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const json = (path) => JSON.parse(read(path));

const jsonFiles = [
  'data/products.example.json',
  'data/faq.example.json',
  'data/store-config.example.json',
  'samples/webhook-payload.json',
  'n8n/workflows/whatsapp-main.json',
  'n8n/workflows/error-handler.json',
];
for (const path of jsonFiles) assert.doesNotThrow(() => json(path), `${path} must be valid JSON`);

const products = json('data/products.example.json');
assert.ok(Array.isArray(products) && products.length >= 1, 'catalogue must contain products');
for (const product of products) {
  for (const key of ['id', 'name', 'category', 'price', 'currency', 'stock']) {
    assert.ok(Object.hasOwn(product, key), `product is missing ${key}`);
  }
  assert.ok(Number.isFinite(product.price) && product.price >= 0, 'price must be a non-negative number');
  assert.ok(
    product.stock === null || (Number.isFinite(product.stock) && product.stock >= 0),
    'stock must be null (unknown) or a non-negative number',
  );
}

const config = json('data/store-config.example.json');
assert.deepEqual(config.languages, ['darija', 'french', 'english']);
assert.equal(typeof config.cod_enabled, 'boolean');
assert.ok(Array.isArray(config.delivery?.areas));
assert.equal(config.delivery.price_mad, 29);
assert.equal(config.pricing.single_price_mad, 90);
assert.equal(config.pricing.bundle_price_mad, 150);

const faq = json('data/faq.example.json');
for (const intent of ['cod', 'delivery', 'faq', 'product_availability', 'order']) {
  assert.ok(faq.some((entry) => entry.intent === intent), `FAQ must cover ${intent}`);
}

const payload = json('samples/webhook-payload.json');
assert.equal(payload.object, 'whatsapp_business_account');
assert.ok(payload.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.id?.startsWith('wamid.'));

const requiredMainNodes = [
  'Meta Verification Webhook',
  'WhatsApp Messages Webhook',
  'Validate Request',
  'Normalize Message',
  'Load Customer Session and Deduplicate',
  'Classify Language and Intent',
  'Switch by Intent',
  'FAQ and Store Lookup',
  'Modular Product Search',
  'Generate Grounded AI Reply',
  'Validate Grounded Output',
  'Save Conversation and Handoff State',
  'Send WhatsApp Reply',
  'Authorize and Clear Handoff',
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
        for (const connection of output || []) {
          assert.ok(names.includes(connection.node), `${path} connection target ${connection.node} does not exist`);
        }
      }
    }
  }
  for (const codeNode of workflow.nodes.filter((node) => node.type === 'n8n-nodes-base.code')) {
    assert.doesNotThrow(
      () => new AsyncFunction(`return async function () {${codeNode.parameters.jsCode}}`),
      `${path}: embedded code in ${codeNode.name} must parse`,
    );
  }
  return workflow;
}

const main = validateWorkflow('n8n/workflows/whatsapp-main.json', requiredMainNodes);
const errorHandler = validateWorkflow('n8n/workflows/error-handler.json', ['Workflow Error Trigger', 'Create Safe Error Log']);
assert.equal(errorHandler.nodes.filter((node) => node.type === 'n8n-nodes-base.errorTrigger').length, 1);
assert.equal(main.connections['Switch by Intent'].main.length, 5, 'intent switch must have four rules plus fallback');
assert.equal(
  main.connections['Validate Grounded Output'].main[0][0].node,
  'Save Conversation and Handoff State',
  'validated replies must be saved before sending',
);

for (const nodeName of ['Classify Language and Intent', 'Generate Grounded AI Reply']) {
  const aiNode = main.nodes.find((node) => node.name === nodeName);
  assert.equal(aiNode.parameters.url, '={{ $json.ai_endpoint }}', `${nodeName} must use the configured AI endpoint`);
  const authorization = aiNode.parameters.headerParameters.parameters
    .find((header) => header.name === 'Authorization')?.value || '';
  assert.match(authorization, /AI_API_KEY/, `${nodeName} must support the provider-neutral AI key`);
  assert.match(authorization, /OPENAI_API_KEY/, `${nodeName} must preserve legacy OpenAI key support`);
}

const committedText = [read('.env.example'), read('docker-compose.yml'), ...jsonFiles.map(read)].join('\n');
assert.ok(!/\bsk-[A-Za-z0-9_-]{16,}\b/.test(committedText), 'an OpenAI-like secret was committed');
assert.ok(!/\bgsk_[A-Za-z0-9_-]{16,}\b/.test(committedText), 'a Groq-like secret was committed');
assert.ok(!/\bEAA[A-Za-z0-9]{20,}\b/.test(committedText), 'a Meta-like token was committed');

const envKeys = new Set(
  read('.env.example')
    .split(/\r?\n/)
    .filter((line) => /^[A-Z0-9_]+=/.test(line))
    .map((line) => line.split('=')[0]),
);
for (const key of [
  'N8N_HOST', 'N8N_PORT', 'N8N_PROTOCOL', 'N8N_ENCRYPTION_KEY',
  'WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_BUSINESS_ACCOUNT_ID',
  'WHATSAPP_VERIFY_TOKEN', 'WHATSAPP_APP_SECRET', 'AI_API_KEY', 'AI_BASE_URL', 'AI_MODEL',
  'OPENAI_API_KEY', 'DATABASE_URL',
]) {
  assert.ok(envKeys.has(key), `.env.example is missing ${key}`);
}

const compose = read('docker-compose.yml');
assert.match(compose, /restart:\s+unless-stopped/);
assert.match(compose, /n8n_data:\/home\/node\/\.n8n/);
assert.match(compose, /\.\/data:\/store-data:ro/);

console.log('Structure, data, workflows, embedded code, and secret checks: OK');
