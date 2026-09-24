import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const root = resolve(import.meta.dirname, '..');
const workflow = JSON.parse(readFileSync(resolve(root, 'n8n/workflows/whatsapp-main.json'), 'utf8'));
const products = JSON.parse(readFileSync(resolve(root, 'data/products.example.json'), 'utf8'));
const faq = JSON.parse(readFileSync(resolve(root, 'data/faq.example.json'), 'utf8'));
const baseConfig = JSON.parse(readFileSync(resolve(root, 'data/store-config.example.json'), 'utf8'));
const samplePayload = JSON.parse(readFileSync(resolve(root, 'samples/webhook-payload.json'), 'utf8'));
const require = createRequire(import.meta.url);
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const codeByName = new Map(workflow.nodes.filter((node) => node.type === 'n8n-nodes-base.code').map((node) => [node.name, node.parameters.jsCode]));
const storePath = `/tmp/maro-bot-context-tests-${process.pid}.json`;
const staticData = {};
const env = {
  ORDER_STORE_PATH: storePath,
  ORDER_PHONE_SOURCE: 'customer_provided_preferred',
  CONVERSATION_CONTEXT_TTL_MINUTES: '1440',
  ORDER_DRAFT_TTL_MINUTES: '1440',
  HUMAN_TAKEOVER_MINUTES: '60',
};
rmSync(storePath, { force: true });
rmSync(`${storePath}.lock`, { force: true });

async function runCode(name, json, { nodeData = {}, runEnv = env } = {}) {
  const code = codeByName.get(name);
  assert.ok(code, `missing Code node: ${name}`);
  const input = { json };
  const $input = { first: () => input, all: () => [input] };
  const $ = (nodeName) => ({ first: () => ({ json: nodeData[nodeName] }) });
  const $getWorkflowStaticData = () => staticData;
  const fn = new AsyncFunction('$json', '$input', '$env', '$', '$getWorkflowStaticData', 'require', 'Buffer', code);
  return fn(json, $input, runEnv, $, $getWorkflowStaticData, require, Buffer);
}

let messageSequence = 0;
async function message(phone, text, config = baseConfig) {
  messageSequence += 1;
  const messageId = `context-${phone}-${messageSequence}`;
  const received = {
    phone_number: phone, message_id: messageId, message_text: text, message_type: 'text',
    timestamp: new Date().toISOString(), phone_number_id: '123456789012345',
  };
  const loaded = (await runCode('Load Customer Session and Deduplicate', received))[0].json;
  assert.equal(loaded.should_process, true);
  const stateAware = (await runCode('Order Sales State Machine', { ...loaded, store_config: config, products, faq }))[0].json;
  const routed = stateAware.order_handled
    ? stateAware
    : (await runCode('Deterministic Security and Sales Router', stateAware))[0].json;
  return (await runCode('Save Conversation and Handoff State', routed))[0].json;
}

function store() {
  return JSON.parse(readFileSync(storePath, 'utf8'));
}

function writeStore(value) {
  writeFileSync(storePath, JSON.stringify(value, null, 2) + '\n');
}

function seedOrder(phone, status, overrides = {}) {
  const data = store();
  const orderId = overrides.order_id || `ORD-SEED-${phone.slice(-4)}-${status}`;
  const now = new Date().toISOString();
  data.orders[orderId] = {
    order_id: orderId, customer_wa_id: phone, product_id: 'nike-double-face-jacket', quantity: 1,
    items: [{ product_id: 'nike-double-face-jacket', size: 'S', color: 'Black' }],
    customer_name: 'Ayman Old', phone: '+212612345678', city: 'Casablanca', address: 'OLD ADDRESS',
    status, created_at: now, updated_at: now, awaiting_confirmation_prompted: status === 'AWAITING_CONFIRMATION',
    ...overrides,
  };
  data.active_orders_by_customer[phone] = orderId;
  data.conversations[phone] = {
    preferred_language: 'darija', conversation_mode: 'ORDER', active_order_id: orderId, order_status: status,
    last_product_id: 'nike-double-face-jacket', last_product_at: now,
    pending_action: status === 'AWAITING_CONFIRMATION' ? 'CONFIRM_ORDER' : 'COLLECT_ORDER_FIELD',
    pending_field: status === 'AWAITING_CONFIRMATION' ? 'confirmation' : 'customer_name',
    pending_fields: [status === 'AWAITING_CONFIRMATION' ? 'confirmation' : 'customer_name'],
    pending_product_id: 'nike-double-face-jacket', pending_order_id: orderId,
    last_bot_action: status === 'AWAITING_CONFIRMATION' ? 'REQUEST_FINAL_CONFIRMATION' : 'REQUEST_ORDER_FIELDS',
    updated_at: now, last_activity_at: now,
  };
  writeStore(data);
  delete staticData.sessions?.[phone];
  return orderId;
}

function activeOrder(phone) {
  const data = store();
  const id = data.active_orders_by_customer[phone];
  return id ? data.orders[id] : null;
}

const results = [];
async function test(name, fn) {
  await fn();
  results.push(name);
}

await test('multiline normalization preserves useful boundaries', async () => {
  const payload = structuredClone(samplePayload);
  payload.entry[0].changes[0].value.messages[0].text.body = 'Ayman el mannany\nCasablanca\nR2 DRISSIA';
  const normalized = (await runCode('Normalize Message', { body: payload }))[0].json;
  assert.equal(normalized.message_text, 'Ayman el mannany\nCasablanca\nR2 DRISSIA');
});

await test('exact failed conversation is state-first', async () => {
  const phone = '212620000001';
  const greeting = await message(phone, 'Salam');
  assert.equal(greeting.intent, 'GREETING');

  const nikePrice = await message(phone, 'Bghit n3rf taman jacket nike');
  assert.equal(nikePrice.intent, 'PRICE');
  assert.equal(nikePrice.primary_product_id, 'nike-double-face-jacket');
  assert.match(nikePrice.reply, /249/);
  assert.equal(nikePrice.active_order_id, null);
  assert.equal(nikePrice.ai_needed, false);
  assert.doesNotMatch(nikePrice.reply, /كحل ولا بيض|Choose.*colour/i);

  const whiteFaq = await message(phone, 'Byd');
  assert.equal(whiteFaq.intent, 'COLOR');
  assert.equal(whiteFaq.requested_color, 'White');
  assert.equal(whiteFaq.primary_product_id, 'nike-double-face-jacket');
  assert.equal(whiteFaq.active_order_id, null);

  const survettePrice = await message(phone, 'Bghit n3rf taman survette nike');
  assert.equal(survettePrice.intent, 'PRICE');
  assert.equal(survettePrice.primary_product_id, 'cotton-montoni-tracksuit');
  assert.match(survettePrice.reply, /219/);
  assert.equal(survettePrice.active_order_id, null);

  const started = await message(phone, 'B8it w7da');
  assert.equal(started.intent, 'PURCHASE_INTENT');
  assert.equal(started.quantity, 1);
  assert.equal(started.primary_product_id, 'cotton-montoni-tracksuit');
  assert.equal(started.order_status, 'COLLECTING');

  const color = await message(phone, 'Noir');
  assert.equal(activeOrder(phone).items[0].color, 'Black');
  assert.equal(color.active_order_id, started.active_order_id);

  await message(phone, 'Ayman el mannany casablanca Drissia');
  let draft = activeOrder(phone);
  assert.equal(draft.customer_name, 'Ayman el mannany');
  assert.match(draft.city, /casablanca/i);
  assert.equal(draft.address, 'Drissia');
  assert.equal(draft.product_id, 'cotton-montoni-tracksuit');
  assert.equal(draft.quantity, 1);
  assert.equal(draft.items[0].color, 'Black');

  await message(phone, 'Ayman el mannany\nCasablanca\nR2 DRISSIA');
  draft = activeOrder(phone);
  assert.equal(draft.customer_name, 'Ayman el mannany');
  assert.match(draft.city, /casablanca/i);
  assert.equal(draft.address, 'R2 DRISSIA');
  assert.equal(draft.product_id, 'cotton-montoni-tracksuit');
  assert.equal(draft.items[0].color, 'Black');

  const acknowledged = await message(phone, 'Ok');
  assert.equal(acknowledged.intent, 'ACKNOWLEDGEMENT');
  assert.equal(acknowledged.order_status, 'COLLECTING');
  assert.equal(acknowledged.active_order_id, started.active_order_id);

  const eta = await message(phone, 'Ch7al fach twslni');
  assert.equal(eta.intent, 'DELIVERY_TIME');
  assert.equal(eta.resolved_product_id, 'cotton-montoni-tracksuit');
  assert.equal(eta.resolution_source, 'active_order');
  assert.equal(eta.active_order_id, started.active_order_id);
  assert.doesNotMatch(eta.reply, /شنو المنتوج|Which product|Quel produit/i);
});

async function preparePendingColor(phone) {
  await message(phone, 'taman nike');
  await message(phone, 'bghit w7da');
  const size = await message(phone, 'L');
  assert.equal(size.next_pending_field, 'color');
}

await test('pending color consumes Byd and K7l without fallback', async () => {
  const whitePhone = '212620000002';
  await preparePendingColor(whitePhone);
  const white = await message(whitePhone, 'Byd');
  assert.equal(activeOrder(whitePhone).items[0].color, 'White');
  assert.notEqual(white.route_reason, 'deterministic_scope_prompt');

  const blackPhone = '212620000003';
  await preparePendingColor(blackPhone);
  const black = await message(blackPhone, 'K7l');
  assert.equal(activeOrder(blackPhone).items[0].color, 'Black');
  assert.notEqual(black.route_reason, 'deterministic_scope_prompt');
});

await test('pending size, quantity, phone, address, and noir resolve first', async () => {
  const sizePhone = '212620000004';
  await message(sizePhone, 'taman nike');
  const sizeStart = await message(sizePhone, 'bghit w7da');
  assert.equal(sizeStart.next_pending_field, 'size');
  await message(sizePhone, 'L');
  assert.equal(activeOrder(sizePhone).items[0].size, 'L');

  const quantityPhone = '212620000005';
  const quantityStart = await message(quantityPhone, 'bghit nchri nike');
  assert.equal(quantityStart.next_pending_field, 'quantity');
  await message(quantityPhone, 'joj');
  assert.equal(activeOrder(quantityPhone).quantity, 2);

  const noFallbackPhoneConfig = structuredClone(baseConfig);
  noFallbackPhoneConfig.orders.allow_whatsapp_phone_fallback = false;
  const phonePhone = '212620000006';
  await message(phonePhone, 'bghit w7da nike', noFallbackPhoneConfig);
  await message(phonePhone, 'L', noFallbackPhoneConfig);
  await message(phonePhone, 'noir', noFallbackPhoneConfig);
  const details = await message(phonePhone, 'Ayman Test\nCasablanca\nR2 Drissia', noFallbackPhoneConfig);
  assert.equal(details.next_pending_field, 'phone');
  await message(phonePhone, '0612345678', noFallbackPhoneConfig);
  assert.equal(activeOrder(phonePhone).phone, '+212612345678');

  const addressPhone = '212620000007';
  await message(addressPhone, 'bghit w7da nike');
  await message(addressPhone, 'L');
  await message(addressPhone, 'noir');
  await message(addressPhone, 'Ayman Test');
  const city = await message(addressPhone, 'Casablanca');
  assert.equal(city.next_pending_field, 'address');
  await message(addressPhone, 'R2 Drissia');
  assert.equal(activeOrder(addressPhone).address, 'R2 Drissia');
});

await test('explicit product switch updates FAQ context', async () => {
  const phone = '212620000008';
  await message(phone, 'taman nike');
  const switched = await message(phone, 'taman survette');
  assert.equal(switched.primary_product_id, 'cotton-montoni-tracksuit');
  const sizes = await message(phone, 'w tailles?');
  assert.equal(sizes.intent, 'SIZE');
  assert.equal(sizes.primary_product_id, 'cotton-montoni-tracksuit');
});

await test('FAQ to ORDER transition requires purchase intent', async () => {
  const phone = '212620000009';
  await message(phone, 'taman nike');
  const faqColor = await message(phone, 'wach kayn noir');
  assert.equal(faqColor.active_order_id, null);
  const order = await message(phone, 'bghit wa7da');
  assert.equal(order.intent, 'PURCHASE_INTENT');
  assert.equal(order.primary_product_id, 'nike-double-face-jacket');
  assert.equal(order.order_status, 'COLLECTING');
});

await test('FAQ and acknowledgement during ORDER preserve draft', async () => {
  const phone = '212620000010';
  await message(phone, 'taman nike');
  const started = await message(phone, 'bghit wa7da');
  const eta = await message(phone, 'ch7al fach twslni?');
  assert.equal(eta.intent, 'DELIVERY_TIME');
  assert.equal(eta.active_order_id, started.active_order_id);
  const ack = await message(phone, 'ok');
  assert.equal(ack.intent, 'ACKNOWLEDGEMENT');
  assert.equal(ack.active_order_id, started.active_order_id);
  assert.equal(activeOrder(phone).status, 'COLLECTING');
});

await test('rapid independent customer fields merge atomically', async () => {
  const phone = '212620000011';
  await message(phone, 'bghit w7da nike');
  await message(phone, 'L');
  await message(phone, 'noir');
  await Promise.all([
    message(phone, 'Ayman'),
    message(phone, 'Casablanca'),
    message(phone, 'R2 Drissia'),
  ]);
  const draft = activeOrder(phone);
  assert.equal(draft.customer_name, 'Ayman');
  assert.match(draft.city, /casablanca/i);
  assert.equal(draft.address, 'R2 Drissia');
  assert.equal(draft.product_id, 'nike-double-face-jacket');
  assert.equal(draft.items[0].size, 'L');
  assert.equal(draft.items[0].color, 'Black');
});

await test('context TTL does not delete an active draft', async () => {
  const phone = '212620000012';
  const started = await message(phone, 'bghit w7da nike');
  const data = store();
  data.conversations[phone].updated_at = '2020-01-01T00:00:00.000Z';
  data.conversations[phone].last_activity_at = '2020-01-01T00:00:00.000Z';
  data.conversations[phone].last_product_at = '2020-01-01T00:00:00.000Z';
  const fs = require('fs');
  fs.writeFileSync(storePath, JSON.stringify(data, null, 2) + '\n');
  delete staticData.sessions[phone];
  const loaded = (await runCode('Load Customer Session and Deduplicate', {
    phone_number: phone, message_id: `context-ttl-${Date.now()}`, message_text: 'L', message_type: 'text', timestamp: new Date().toISOString(),
  }))[0].json;
  assert.equal(loaded.session.last_product_id, null);
  assert.equal(loaded.session.active_order_id, started.active_order_id);
  assert.equal(loaded.session.active_order_product_id, 'nike-double-face-jacket');
  assert.equal(loaded.session.pending_field, 'size');
});

await test('stale screenshot order is abandoned before Slm and price FAQ', async () => {
  const phone = '212620000013';
  const staleAt = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
  const orderId = seedOrder(phone, 'AWAITING_CONFIRMATION', { updated_at: staleAt, created_at: staleAt });
  const greeting = await message(phone, 'Slm', baseConfig);
  assert.equal(greeting.intent, 'GREETING');
  assert.doesNotMatch(greeting.reply, /Ayman Old|OLD ADDRESS|تأكدوه|confirm your order/i);
  let data = store();
  assert.equal(data.orders[orderId].status, 'ABANDONED');
  assert.equal(data.orders[orderId].abandonment_reason, 'draft_ttl_expired');
  assert.equal(data.active_orders_by_customer[phone], undefined);
  assert.equal(data.conversations[phone].active_order_id, null);

  const price = await message(phone, 'Taman jaket nike');
  assert.equal(price.intent, 'PRICE');
  assert.equal(price.primary_product_id, 'nike-double-face-jacket');
  assert.match(price.reply, /249/);
  assert.doesNotMatch(price.reply, /Ayman Old|OLD ADDRESS|confirm your order|تأكدوه/i);
  data = store();
  assert.equal(data.orders[orderId].customer_name, 'Ayman Old');
  assert.equal(data.orders[orderId].address, 'OLD ADDRESS');
});

await test('active draft answers FAQ without mutation or summary', async () => {
  const phone = '212620000014';
  const started = await message(phone, 'bghit w7da nike');
  const before = structuredClone(activeOrder(phone));
  for (const [text, intent] of [['Taman jaket nike', 'PRICE'], ['taille nike', 'SIZE'], ['ch7al fach twslni', 'DELIVERY_TIME']]) {
    const answer = await message(phone, text);
    assert.equal(answer.intent, intent);
    assert.equal(answer.active_order_id, started.active_order_id);
    assert.doesNotMatch(answer.reply, /ها الطلب ديالك|Please confirm your order|Voici votre commande/i);
  }
  const after = activeOrder(phone);
  for (const field of ['product_id', 'quantity', 'customer_name', 'phone', 'city', 'address', 'status']) {
    assert.deepEqual(after[field], before[field]);
  }
  assert.deepEqual(after.items, before.items);
});

await test('pending customer name yields to price FAQ then accepts a plausible name', async () => {
  const phone = '212620000015';
  await message(phone, 'bghit w7da nike');
  await message(phone, 'L');
  const color = await message(phone, 'noir');
  assert.equal(color.next_pending_field, 'customer_name');
  const price = await message(phone, 'Taman jaket nike');
  assert.equal(price.intent, 'PRICE');
  assert.equal(activeOrder(phone).customer_name, null);
  assert.equal(store().conversations[phone].pending_field, 'customer_name');
  await message(phone, 'Ayman El Mannany');
  assert.equal(activeOrder(phone).customer_name, 'Ayman El Mannany');
});

await test('pending address yields to delivery FAQ then accepts address text', async () => {
  const phone = '212620000016';
  await message(phone, 'bghit w7da nike');
  await message(phone, 'L');
  await message(phone, 'noir');
  await message(phone, 'Ayman El Mannany');
  const city = await message(phone, 'Casablanca');
  assert.equal(city.next_pending_field, 'address');
  const eta = await message(phone, 'ch7al fach twslni');
  assert.equal(eta.intent, 'DELIVERY_TIME');
  assert.equal(activeOrder(phone).address, null);
  assert.equal(store().conversations[phone].pending_field, 'address');
  await message(phone, 'R2 Drissia');
  assert.equal(activeOrder(phone).address, 'R2 Drissia');
});

await test('two customers are isolated by wa_id', async () => {
  const phoneA = '212620000017';
  const phoneB = '212620000018';
  await message(phoneA, 'bghit w7da nike');
  await message(phoneA, 'L');
  await message(phoneA, 'noir');
  await message(phoneA, 'Ayman Privacy');
  await message(phoneA, 'Casablanca');
  await message(phoneA, 'R2 DRISSIA');
  const responseB = await message(phoneB, 'Taman jaket nike');
  assert.equal(responseB.intent, 'PRICE');
  assert.match(responseB.reply, /249/);
  assert.doesNotMatch(responseB.reply, /Ayman|DRISSIA|2126/i);
  assert.equal(responseB.active_order_id, null);
  assert.equal(store().active_orders_by_customer[phoneB], undefined);
});

await test('terminal and abandoned historical orders cannot remain active', async () => {
  const statuses = ['CONFIRMED', 'CANCELLED', 'OWNER_NOTIFIED', 'ABANDONED'];
  for (let index = 0; index < statuses.length; index += 1) {
    const phone = `21262000002${index}`;
    const status = statuses[index];
    const orderId = seedOrder(phone, status);
    const response = await message(phone, 'Taman nike');
    assert.equal(response.intent, 'PRICE');
    assert.equal(response.active_order_id, null);
    const data = store();
    assert.equal(data.orders[orderId].status, status);
    assert.equal(data.active_orders_by_customer[phone], undefined);
    assert.equal(data.conversations[phone].active_order_id, null);
  }
});

await test('FAQ after final summary disables implicit ok confirmation', async () => {
  const phone = '212620000024';
  await message(phone, 'bghit w7da nike');
  await message(phone, 'L');
  await message(phone, 'noir');
  const completed = await message(phone, 'Ayman Test\nCasablanca\nR2 Drissia');
  assert.equal(completed.order_status, 'AWAITING_CONFIRMATION');
  const price = await message(phone, 'Taman nike');
  assert.equal(price.intent, 'PRICE');
  assert.equal(activeOrder(phone).status, 'AWAITING_CONFIRMATION');
  assert.equal(store().conversations[phone].last_bot_action, 'ANSWER_PRICE');
  const ack = await message(phone, 'ok');
  assert.equal(ack.intent, 'ACKNOWLEDGEMENT');
  assert.equal(activeOrder(phone).status, 'AWAITING_CONFIRMATION');
});

await test('admin reset abandons only active draft and preserves history', async () => {
  const phone = '212620000025';
  const draftId = seedOrder(phone, 'COLLECTING');
  const data = store();
  const historicalId = 'ORD-SEED-HISTORICAL-CONFIRMED';
  data.orders[historicalId] = { ...data.orders[draftId], order_id: historicalId, status: 'CONFIRMED' };
  writeStore(data);
  staticData.sessions ||= {};
  staticData.sessions[phone] = { active_order_id: draftId };
  const token = '0123456789abcdef0123456789abcdef';
  const reset = (await runCode('Authorize and Reset Conversation', {
    headers: { 'x-handoff-admin-token': token }, body: { phone_number: phone },
  }, { runEnv: { ...env, HANDOFF_ADMIN_TOKEN: token } }))[0].json;
  assert.equal(reset.status_code, 200);
  const response = JSON.parse(reset.response_body);
  assert.equal(response.active_draft_status, 'ABANDONED');
  const after = store();
  assert.equal(after.orders[draftId].status, 'ABANDONED');
  assert.equal(after.orders[historicalId].status, 'CONFIRMED');
  assert.equal(after.conversations[phone], undefined);
  assert.equal(after.active_orders_by_customer[phone], undefined);
  assert.equal(staticData.sessions[phone], undefined);
});

await test('all configured greeting aliases stay deterministic', async () => {
  const aliases = ['salam', 'slm', 'salam alikom', 'salam 3likom', 'salam alaikom', 'السلام عليكم', 'سلام', 'bonjour', 'bjr', 'hello', 'hi', 'hey'];
  for (let index = 0; index < aliases.length; index += 1) {
    const response = await message(`2126200001${String(index).padStart(2, '0')}`, aliases[index]);
    assert.equal(response.intent, 'GREETING', aliases[index]);
    assert.equal(response.ai_needed, false, aliases[index]);
  }
});

for (const [index, name] of results.entries()) console.log(`CONTEXT TEST ${index + 1}: PASS - ${name}`);
rmSync(storePath, { force: true });
rmSync(`${storePath}.lock`, { force: true });
