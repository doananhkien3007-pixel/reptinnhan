import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createCloudServer } from '../lab/cloud-server.js';
import { CloudLabService } from '../lab/cloud/service.js';
import { SupabaseLabStore } from '../lab/cloud/store.js';
import { loadProductCatalog, normalizeProductCatalog } from '../lab/cloud/catalog.js';
import { versions } from '../lab/brain.js';
import { validateBrain } from '../lab/schema.js';

const AD_ID = '52590312182503';
const fixtureCatalog = JSON.parse(readFileSync(new URL('../lab/catalog.json', import.meta.url), 'utf8'));
fixtureCatalog.ads = [{ id: AD_ID, product_id: 'LAB-A', name: `Ads ${AD_ID} · Váy hoa tím` }];
const catalogProvider = async () => structuredClone(fixtureCatalog);

class TestStore {
  rows = new Map();
  async list(session) { return [...this.rows.values()].filter(r => r.session === session); }
  async get(session, id) { const r = this.rows.get(id); if (!r || r.session !== session) throw Object.assign(new Error('Not found'), { status: 404 }); return structuredClone(r); }
  async create(session, record) { const r = { ...record, session, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), last_request_id: null }; this.rows.set(r.id, r); return structuredClone(r); }
  async claim(session, id, request, token, revision) {
    const row = await this.get(session, id);
    if (row.last_request_id === request) return { conversation: row, replayed: true };
    if (row.revision !== revision || this.rows.get(id).token) throw Object.assign(new Error('Conflict'), { status: 409 });
    this.rows.get(id).token = token;
    return { conversation: row, replayed: false };
  }
  async commit(session, id, request, token, revision, state) {
    const r = this.rows.get(id);
    assert.equal(r.session, session); assert.equal(r.token, token); assert.equal(r.revision, revision);
    Object.assign(r, { state, revision: revision + 1, last_request_id: request, token: null });
    return structuredClone(r);
  }
  async release(session, id, token) { const r = this.rows.get(id); if (r?.session === session && r.token === token) r.token = null; }
}
const output = () => ({ understanding: 'Khách mua cho mẹ, đang hỏi chọn size.', current_product_id: 'LAB-A', referenced_products: [], new_facts: [], memory_updates: [], concerns: [], purchase_intent: { description: 'Chưa xác nhận mua.', confirmed: false, transactions: [] }, next_best_action: 'Tư vấn đúng người mặc.', missing_information: [], uncertainties: [], human_needed: { needed: false, reason: '' }, media_ids: ['LAB-A-IMG-1','LAB-A-VID-1'], messages: ['Dạ em đã ghi nhận chị mua cho mẹ 60kg ạ.', 'Theo bảng mẫu này, mẹ mình tham khảo size L chị nhé.'] });
const brain = async () => ({ output: output(), actual_model: 'test-model', versions });

test('cloud chat sends full persisted context and assistant config; request retries do not duplicate paid model calls', async () => {
  const store = new TestStore(); const inputs = []; const calls = [];
  const service = new CloudLabService(store, async (input, model, config, options) => { inputs.push(structuredClone(input)); calls.push({ model, options }); return brain(); }, catalogProvider);
  const session = randomUUID(); const c = await service.create(session, { ad_id: AD_ID, assistant_config: { model: 'test-model', custom_instructions: 'Tư vấn theo dịp mặc.' } });
  store.rows.get(c.id).state.catalog.version = 'lab-catalog-1';
  store.rows.get(c.id).state.catalog.products.forEach(product => { product.media = []; });
  const first = { request_id: randomUUID(), revision: 0, message: 'Chị mua cho mẹ 60kg', model: 'test-model' };
  const r = await service.turn(session, c.id, first);
  assert.equal(r.conversation.state.history.length, 3);
  assert.equal(inputs[0].messages.length, 1);
  assert.equal(inputs[0].messages[0].text, first.message);
  assert.deepEqual(r.conversation.state.history.slice(1).map(message => message.text), output().messages);
  assert.equal(inputs[0].catalog.products[0].id, 'LAB-A');
  assert.deepEqual(inputs[0].entry, { product_id: 'LAB-A', ad_id: AD_ID });
  assert.equal(inputs[0].catalog.version, 'lab-catalog-2'); assert.equal(inputs[0].catalog.products[0].media.length, 3);
  assert.deepEqual(c.state.assistant_config, { model: 'test-model', custom_instructions: 'Tư vấn theo dịp mặc.' });
  assert.deepEqual(calls[0], { model: 'test-model', options: { customInstructions: 'Tư vấn theo dịp mặc.' } });
  assert.equal((await service.turn(session, c.id, first)).replayed, true);
  assert.equal(inputs.length, 1);
  await service.turn(session, c.id, { request_id: randomUUID(), revision: 1, message: 'Vậy mẹ mặc size nào?', model: 'test-model' });
  assert.equal(inputs[1].history.length, 3); assert.equal(inputs[1].history[0].text, first.message);
  assert.deepEqual(inputs[1].history[1].media_ids, ['LAB-A-IMG-1','LAB-A-VID-1']);
  assert.deepEqual(inputs[1].history.slice(1).map(message => message.text), output().messages);
  assert.equal((await store.get(session, c.id)).state.history.length, 6);
  await assert.rejects(service.turn(randomUUID(), c.id, first), e => e.status === 404);
});

test('failed model call preserves history and releases lock; concurrent turn is excluded', async () => {
  const store = new TestStore(); let rejectCall;
  const service = new CloudLabService(store, () => new Promise((_, reject) => { rejectCall = reject; }), catalogProvider);
  const session = randomUUID(); const c = await service.create(session, { ad_id: AD_ID, assistant_config: { model: 'test-model', custom_instructions: '' } });
  const request = { request_id: randomUUID(), revision: 0, message: 'Hỏi giá', model: 'test-model' };
  const pending = service.turn(session, c.id, request); await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(service.turn(session, c.id, { ...request, request_id: randomUUID() }), e => e.status === 409);
  rejectCall(new Error('Model unavailable')); await assert.rejects(pending);
  assert.equal((await store.get(session, c.id)).state.history.length, 0);
  service.brain = brain; assert.equal((await service.turn(session, c.id, request)).conversation.revision, 1);
});

test('cloud HTTP scopes history by signed cookie, rejects forged cookies and cross-origin writes', async () => {
  const store = new TestStore(); const server = createCloudServer({ storeFactory: () => store, brain, catalogProvider, sessionSecret: () => 'test-only-signing-secret-at-least-32-characters' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (action, body, cookie = '', origin = base) => fetch(`${base}/api/lab?action=${action}`, { headers: { Cookie: cookie, ...(body ? { Origin: origin, 'Content-Type': 'application/json' } : {}) }, ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}) });
  try {
    const boot = await call('bootstrap'); const cookie = boot.headers.get('set-cookie').split(';')[0];
    assert.equal(boot.status, 200); assert.match(boot.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
    const bootBody = await boot.json(); assert.equal(bootBody.products.length, 4); assert.equal(bootBody.ads[0].id, AD_ID);
    const created = await call('create', { ad_id: AD_ID, customer_name: 'Test', assistant_config: { model: 'test-model', custom_instructions: 'Tư vấn chủ động.' } }, cookie);
    assert.equal(created.status, 201); const c = (await created.json()).conversation;
    assert.deepEqual(c.state.entry, { product_id: 'LAB-A', ad_id: AD_ID });
    assert.equal(c.state.assistant_config.custom_instructions, 'Tư vấn chủ động.');
    const turn = await call('turn', { conversation_id: c.id, request_id: randomUUID(), revision: 0, message: 'Chị mua cho mẹ', model: 'test-model' }, cookie);
    assert.equal(turn.status, 200); assert.equal((await turn.json()).conversation.state.history.length, 3);
    assert.equal((await call('create', { ad_id: AD_ID }, cookie, 'https://other.example')).status, 403);
    assert.equal((await call('create', { ad_id: AD_ID }, cookie.replace(/.$/, 'Z'))).status, 401);
    const other = await call('bootstrap'); const otherCookie = other.headers.get('set-cookie').split(';')[0];
    assert.equal((await fetch(`${base}/api/lab?action=conversation&id=${c.id}`, { headers: { Cookie: otherCookie } })).status, 404);
    assert.equal((await fetch(`${base}/api/lab?action=conversation&id=${c.id}`, { headers: { Cookie: cookie } })).status, 200);
    assert.equal((await fetch(`${base}/api/webhook`)).status, 404);
    assert.equal((await call('create', { ad_id: '999999999' }, cookie)).status, 400);
    assert.equal((await call('create', { product_id: 'LAB-A' }, cookie)).status, 400);
    assert.equal((await call('create', { ad_id: AD_ID, assistant_config: { model: 'bad model', custom_instructions: '' } }, cookie)).status, 400);
    assert.equal((await call('create', { ad_id: AD_ID, assistant_config: { model: 'test-model', custom_instructions: {} } }, cookie)).status, 400);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('Supabase product catalog keeps real facts but exposes media as attachment IDs only', async () => {
  const rows = [{
    id: 17, sku: 'VAY-017', name: 'Váy thật', status: 'active', price: 390000, sale_price: 329000,
    material: 'Lụa', colors: ['Đỏ'], size_guide: 'M 48-55kg', description: 'Dáng suông',
    images: [
      { image_url: 'https://storage.example/private.jpg', facebook_attachment_id: 'att-image-primary', is_primary: true, sort_order: 2 },
      { video_url: 'https://storage.example/private.mp4', storage_path: '17/video.mp4', facebook_attachment_id: 'att-video', media_type: 'video' },
      { image_url: 'https://storage.example/second.jpg', facebook_attachment_id: 'att-image-second', sort_order: 1 },
      { image_url: 'https://storage.example/no-attachment.jpg' }
    ]
  }];
  const mappings = [{ ad_id: AD_ID, product_id: 17 }, { ad_id: '999', product_id: 404 }];
  const catalog = normalizeProductCatalog(rows, mappings);
  assert.equal(catalog.source, 'supabase-products');
  assert.equal(catalog.products[0].id, '17');
  assert.deepEqual(catalog.products[0].media, [
    { id: 'att-image-primary', type: 'image' },
    { id: 'att-image-second', type: 'image' },
    { id: 'att-video', type: 'video' }
  ]);
  assert.deepEqual(catalog.ads, [{ id: AD_ID, product_id: '17', name: `Ads ${AD_ID} · Váy thật` }]);
  assert.doesNotMatch(JSON.stringify(catalog), /storage\.example|image_url|video_url|storage_path/);
  const realInput = { catalog, customer: { id: 'customer', name: 'Chị khách', profile: '' }, entry: { product_id: '17', ad_id: AD_ID }, history: [], memory: [], messages: [{ id: 'message-1', role: 'user', text: 'chị xem mẫu này' }] };
  const realOutput = { ...output(), current_product_id: '17', media_ids: ['att-image-primary'], new_facts: [{ subject: 'product:17', key: 'interested_product', value: 'Váy thật', kind: 'inference', evidence_message_id: 'message-1', evidence: 'mẫu này' }] };
  assert.doesNotThrow(() => validateBrain(realOutput, realInput));

  const productQuery = {
    select(value) { assert.equal(value, '*'); return this; },
    eq(column, value) { assert.deepEqual([column, value], ['status', 'active']); return this; },
    order(column, options) { assert.deepEqual([column, options], ['created_at', { ascending: false }]); return this; },
    async limit(value) { assert.equal(value, 50); return { data: rows, error: null }; }
  };
  const mappingQuery = {
    select(value) { assert.equal(value, 'ad_id, product_id'); return this; },
    order(column, options) { assert.deepEqual([column, options], ['updated_at', { ascending: false }]); return this; },
    async limit(value) { assert.equal(value, 200); return { data: mappings, error: null }; }
  };
  const loaded = await loadProductCatalog({ from(table) { return table === 'products' ? productQuery : table === 'ad_product_mappings' ? mappingQuery : assert.fail(`Unexpected table ${table}`); } });
  assert.deepEqual(loaded.products, catalog.products);
  assert.deepEqual(loaded.ads, catalog.ads);
});

test('cloud deployment keeps server credentials private and translates database conflicts', async () => {
  const store = new SupabaseLabStore({});
  await assert.rejects(store.result(Promise.resolve({ error: { code: '55P03', message: 'secret internal info' } })), e => e.status === 409 && !e.message.includes('secret'));
  await assert.rejects(store.result(Promise.resolve({ error: { code: 'other', message: 'secret-key' } })), e => e.status === 503 && !e.message.includes('secret-key'));
  const ui = readFileSync(new URL('../public/lab/lab.js', import.meta.url), 'utf8');
  assert.doesNotMatch(ui, /SUPABASE_SECRET_KEY|OPENAI_API_KEY\s*[:=]|graph\.facebook/);
  assert.match(ui, /assistant_config/); assert.match(ui, /message-media/); assert.match(ui, /media_ids/);
  assert.match(ui, /api\('turn', request\)/);
  assert.doesNotMatch(ui, /api\.openai\.com|responses\.create|suggested_reply|preview_reply|set_system_prompt|api\/webhook|generateReply|responseTemplates|keywordFlow/);
  const localUi = readFileSync(new URL('../lab/web/lab.js', import.meta.url), 'utf8');
  assert.match(localUi, /Array\.isArray\(output\?\.messages\)/);
  assert.doesNotMatch(localUi, /suggested_reply|generateReply|responseTemplates|keywordFlow/);
  const sql = readFileSync(new URL('../sql/emi_sales_lab.sql', import.meta.url), 'utf8');
  assert.match(sql, /enable row level security/); assert.doesNotMatch(sql, /security definer/i);
  assert.match(sql, /revoke all on function/);
});
