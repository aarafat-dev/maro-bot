import { existsSync, readFileSync } from 'node:fs';
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
  assert.equal(products.length, 4, `${path} must contain the store's four catalog identities`);
  assert.deepEqual(products.map((product) => product.id), [
    'nike-double-face-jacket',
    'cotton-montoni-tracksuit',
    'nike-black-tracksuit',
    'black-quarter-zip-tracksuit',
  ]);
  const imagePaths = new Set();
  for (const product of products) {
    for (const key of ['id', 'name', 'category', 'price', 'currency', 'catalogued', 'stock_status', 'stock', 'sizes', 'colors', 'features', 'image_path', 'media', 'aliases']) {
      assert.ok(Object.hasOwn(product, key), `${product.id} is missing ${key}`);
    }
    assert.equal(product.catalogued, true);
    assert.equal(product.stock_status, 'unknown');
    assert.equal(product.stock, null);
    assert.deepEqual(product.media, { images: [] });
    assert.ok(product.aliases.length >= 3, `${product.id} needs data-driven aliases`);
    assert.match(product.image_path, /^data\/products-images\/[A-Za-z0-9._-]+\.jpg$/);
    assert.ok(existsSync(resolve(root, product.image_path)), `${product.id} image_path does not exist`);
    assert.ok(!imagePaths.has(product.image_path), `${product.id} reuses another product image`);
    imagePaths.add(product.image_path);
    assert.deepEqual(product.sizes, ['S', 'M', 'L', 'XL']);
    if (['nike-double-face-jacket', 'cotton-montoni-tracksuit'].includes(product.id)) {
      assert.deepEqual(product.colors, ['Black', 'White']);
      assert.equal(product.delivery?.free, true);
      assert.ok(Number.isFinite(product.price) && product.price >= 0);
    } else {
      assert.equal(product.price, 219);
      assert.deepEqual(product.colors, ['Black']);
      assert.equal(product.material, null);
      assert.equal(product.delivery, null);
      assert.equal(product.payment, null);
    }
  }
}
const normalizedProducts = json('data/products.example.json');
const nike = normalizedProducts.find((product) => product.id === 'nike-double-face-jacket');
const montoni = normalizedProducts.find((product) => product.id === 'cotton-montoni-tracksuit');
assert.equal(nike.price, 249);
for (const product of normalizedProducts.filter((item) => item.id !== 'nike-double-face-jacket')) assert.equal(product.price, 219);
for (const alias of ['nike', 'jaket nike', 'jacket nike', 'veste nike', 'nike jacket', 'nike double face', 'double face', 'jacket double face', 'جاكيط نايك', 'جاكيت نايك', 'نايك']) {
  assert.ok(nike.aliases.includes(alias), `Nike is missing alias: ${alias}`);
}
for (const alias of ['survette', 'survet', 'survêtement', 'survetement', 'survette noir', 'survette blanc', 'survet noir', 'survet blanc', 'ensemble', 'ensemble noir', 'ensemble blanc', 'tracksuit', 'jogging', 'coton', 'montoni', 'top coton', 'توب قطن', 'مونطوني', 'سورفيت', 'سورفيت نوار']) {
  assert.ok(montoni.aliases.includes(alias), `Montoni is missing alias: ${alias}`);
}

const config = json('data/store-config.example.json');
assert.deepEqual(config.languages, ['darija', 'arabic', 'french', 'english']);
assert.equal(config.delivery.free, true);
assert.equal(config.delivery.price_mad, 0);
assert.equal(config.delivery.estimated_time, null);
assert.deepEqual(config.orders.required_fields, ['product', 'quantity', 'sizes', 'colors', 'customer_name', 'phone', 'city', 'address']);

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
  'Order Sales State Machine', 'Order Handled?',
  'Deterministic Security and Sales Router', 'AI Required?', 'Build Cloudflare AI Request',
  'Cloudflare Configured?', 'Call Cloudflare Workers AI', 'Validate Cloudflare AI Reply',
  'Save Conversation and Handoff State', 'Send WhatsApp Reply', 'Continue After Customer Reply', 'Authorize and Clear Handoff',
  'Authorize and Start Handoff', 'Authorize and Inspect Orders', 'Authorize Notification Retry',
  'Owner Notification Required?', 'Reserve Owner Notification', 'Owner Notification Reserved?',
  'Build Owner Notification', 'Send Owner WhatsApp Notification', 'Mark Owner Notification Result',
  'Configured Product Media?', 'Build Product Media Requests', 'Send Configured Product Photo',
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
assert.equal(main.connections['Load Store Data'].main[0][0].node, 'Order Sales State Machine');
assert.equal(main.connections['Order Handled?'].main[0][0].node, 'Save Conversation and Handoff State');
assert.equal(main.connections['Order Handled?'].main[1][0].node, 'Deterministic Security and Sales Router');
assert.equal(main.connections['Save Conversation and Handoff State'].main[0].length, 1);
assert.equal(main.connections['Save Conversation and Handoff State'].main[0][0].node, 'Build WhatsApp Request');
assert.equal(main.connections['Send WhatsApp Reply'].main[0][0].node, 'Continue After Customer Reply');
assert.deepEqual(
  main.connections['Continue After Customer Reply'].main[0].map((entry) => entry.node),
  ['Owner Notification Required?', 'Configured Product Media?'],
);
assert.equal(main.connections['Owner Notification Reserved?'].main[0][0].node, 'Build Owner Notification');
assert.equal(main.connections['Configured Product Media?'].main[0][0].node, 'Build Product Media Requests');

const orderCode = main.nodes.find((item) => item.name === 'Order Sales State Machine').parameters.jsCode;
for (const status of ['NONE', 'COLLECTING', 'AWAITING_CONFIRMATION', 'CONFIRMED', 'OWNER_NOTIFIED', 'CANCELLED', 'HANDOFF']) {
  assert.match(orderCode, new RegExp(status), `order state machine must support ${status}`);
}
for (const intent of ['PURCHASE_INTENT', 'QUANTITY', 'ORDER_SIZE', 'ORDER_COLOR', 'CUSTOMER_NAME', 'CUSTOMER_PHONE', 'CUSTOMER_CITY', 'CUSTOMER_ADDRESS', 'ORDER_CHANGE', 'ORDER_CANCEL', 'ORDER_CONFIRM', 'ORDER_STATUS', 'DELIVERY_TIME', 'PRODUCT_PHOTOS', 'HUMAN_REQUEST']) {
  assert.match(orderCode, new RegExp(intent), `order state machine must support ${intent}`);
}
assert.match(orderCode, /writeFileSync/);
assert.match(orderCode, /renameSync/);
assert.match(orderCode, /order_store_lock_timeout/);
assert.match(orderCode, /required_fields/);
assert.doesNotMatch(orderCode, /ai_interpretation/);

const routerCode = main.nodes.find((item) => item.name === 'Deterministic Security and Sales Router').parameters.jsCode;
for (const intent of ['GREETING', 'ACKNOWLEDGEMENT', 'PRICE', 'SIZE', 'COLOR', 'DELIVERY', 'DELIVERY_TIME', 'PAYMENT', 'AVAILABILITY', 'PRODUCT_INFO', 'QUALITY', 'MATERIAL', 'ORDER', 'PRODUCT_COMPARISON', 'HUMAN_HANDOFF', 'UNKNOWN_STORE_QUERY', 'OUT_OF_SCOPE']) {
  assert.match(routerCode, new RegExp(`['\"]${intent}['\"]`), `router must support ${intent}`);
}
for (const field of ['routing_outcome', 'requested_color', 'preferred_language', 'response_source']) {
  assert.match(routerCode, new RegExp(field), `router must emit ${field}`);
}
const loadSessionCode = main.nodes.find((item) => item.name === 'Load Customer Session and Deduplicate').parameters.jsCode;
const saveSessionCode = main.nodes.find((item) => item.name === 'Save Conversation and Handoff State').parameters.jsCode;
for (const field of ['conversation_mode', 'pending_action', 'pending_field', 'pending_product_id', 'pending_order_id', 'last_bot_action', 'last_bot_question', 'last_product_id', 'last_intent', 'last_requested_color', 'preferred_language', 'active_order_id', 'order_status', 'automation_enabled', 'handoff_status', 'handoff_until', 'last_activity_at', 'last_event_at']) {
  assert.match(loadSessionCode + saveSessionCode, new RegExp(field), `session state must include ${field}`);
}

const aiNode = main.nodes.find((item) => item.name === 'Call Cloudflare Workers AI');
assert.equal(aiNode.parameters.url, '={{ $json.ai_endpoint }}');
assert.equal(aiNode.retryOnFail, true);
assert.equal(aiNode.maxTries, 2);
assert.ok(aiNode.maxTries <= 2, 'Cloudflare calls must have a finite, tightly bounded retry count');
assert.equal(aiNode.parameters.options.timeout, 20000);
const authorization = aiNode.parameters.headerParameters.parameters.find((header) => header.name === 'Authorization')?.value || '';
assert.match(authorization, /CLOUDFLARE_API_TOKEN/);

const ownerNode = main.nodes.find((item) => item.name === 'Send Owner WhatsApp Notification');
assert.equal(ownerNode.retryOnFail, false);
assert.equal(ownerNode.maxTries, 1);
assert.equal(ownerNode.parameters.options.timeout, 20000);
assert.match(ownerNode.parameters.url, /owner_send_url/);

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
  'WHATSAPP_BUSINESS_PHONE', 'STORE_OWNER_WHATSAPP', 'HUMAN_TAKEOVER_MINUTES',
  'CONVERSATION_CONTEXT_TTL_MINUTES', 'ORDER_DRAFT_TTL_MINUTES', 'ORDER_PHONE_SOURCE', 'ORDER_STORE_PATH',
  'WHATSAPP_VERIFY_TOKEN', 'WHATSAPP_APP_SECRET', 'HANDOFF_ADMIN_TOKEN',
  'CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_AI_MODEL',
  'CLOUDFLARE_AI_MAX_TOKENS', 'DATABASE_URL',
]) assert.ok(envKeys.has(key), `.env.example is missing ${key}`);

const compose = read('docker-compose.yml');
assert.match(compose, /restart:\s+unless-stopped/);
assert.match(compose, /n8n_data:\/home\/node\/\.n8n/);
assert.match(compose, /\.\/data:\/store-data:ro/);
assert.match(compose, /CLOUDFLARE_API_TOKEN/);
assert.match(compose, /STORE_OWNER_WHATSAPP/);
assert.match(compose, /ORDER_STORE_PATH/);
assert.match(compose, /WHATSAPP_BUSINESS_PHONE/);
assert.match(compose, /CONVERSATION_CONTEXT_TTL_MINUTES/);
assert.match(compose, /ORDER_DRAFT_TTL_MINUTES/);
assert.match(compose, /VERIFY_META_SIGNATURE:\s*\$\{VERIFY_META_SIGNATURE:-true\}/);
assert.match(read('.env.example'), /^VERIFY_META_SIGNATURE=true$/m);
assert.match(workflowText, /Reset Conversation Admin Webhook/);
assert.match(workflowText, /ABANDONED/);

console.log('Structure, products, Cloudflare routing, embedded code, and secret checks: OK');
