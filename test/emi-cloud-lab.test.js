import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createCloudServer } from '../lab/cloud-server.js';
import { CloudLabService } from '../lab/cloud/service.js';
import { SupabaseLabStore } from '../lab/cloud/store.js';
import { versions } from '../lab/brain.js';

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
const output = () => ({ understanding: 'Khách mua cho mẹ, đang hỏi chọn size.', current_product_id: 'LAB-A', referenced_products: [], new_facts: [], memory_updates: [], concerns: [], purchase_intent: { description: 'Chưa xác nhận mua.', confirmed: false, transactions: [] }, next_best_action: 'Tư vấn đúng người mặc.', missing_information: [], uncertainties: [], human_needed: { needed: false, reason: '' }, suggested_reply: 'Dạ chị mua cho mẹ thì em đối chiếu số đo của mẹ với bảng size ạ.' });
const brain = async () => ({ output: output(), actual_model: 'test-model', versions });

test('cloud chat sends full persisted context; request retries do not duplicate paid model calls', async () => {
  const store = new TestStore(); const inputs = [];
  const service = new CloudLabService(store, async input => { inputs.push(structuredClone(input)); return brain(); });
  const session = randomUUID(); const c = await service.create(session, { product_id: 'LAB-A' });
  const first = { request_id: randomUUID(), revision: 0, message: 'Chị mua cho mẹ 60kg', model: 'test-model' };
  const r = await service.turn(session, c.id, first);
  assert.equal(r.conversation.state.history.length, 2);
  assert.equal(inputs[0].catalog.products[0].id, 'LAB-A');
  assert.equal((await service.turn(session, c.id, first)).replayed, true);
  assert.equal(inputs.length, 1);
  await service.turn(session, c.id, { request_id: randomUUID(), revision: 1, message: 'Vậy mẹ mặc size nào?', model: 'test-model' });
  assert.equal(inputs[1].history.length, 2); assert.equal(inputs[1].history[0].text, first.message);
  assert.equal((await store.get(session, c.id)).state.history.length, 4);
  await assert.rejects(service.turn(randomUUID(), c.id, first), e => e.status === 404);
});

test('failed model call preserves history and releases lock; concurrent turn is excluded', async () => {
  const store = new TestStore(); let rejectCall;
  const service = new CloudLabService(store, () => new Promise((_, reject) => { rejectCall = reject; }));
  const session = randomUUID(); const c = await service.create(session, { product_id: 'LAB-A' });
  const request = { request_id: randomUUID(), revision: 0, message: 'Hỏi giá', model: 'test-model' };
  const pending = service.turn(session, c.id, request); await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(service.turn(session, c.id, { ...request, request_id: randomUUID() }), e => e.status === 409);
  rejectCall(new Error('Model unavailable')); await assert.rejects(pending);
  assert.equal((await store.get(session, c.id)).state.history.length, 0);
  service.brain = brain; assert.equal((await service.turn(session, c.id, request)).conversation.revision, 1);
});

test('cloud HTTP scopes history by signed cookie, rejects forged cookies and cross-origin writes', async () => {
  const store = new TestStore(); const server = createCloudServer({ storeFactory: () => store, brain, sessionSecret: () => 'test-only-signing-secret-at-least-32-characters' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (action, body, cookie = '', origin = base) => fetch(`${base}/api/lab?action=${action}`, { headers: { Cookie: cookie, ...(body ? { Origin: origin, 'Content-Type': 'application/json' } : {}) }, ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}) });
  try {
    const boot = await call('bootstrap'); const cookie = boot.headers.get('set-cookie').split(';')[0];
    assert.equal(boot.status, 200); assert.match(boot.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
    assert.equal((await boot.json()).products.length, 4);
    const created = await call('create', { product_id: 'LAB-A', customer_name: 'Test' }, cookie);
    assert.equal(created.status, 201); const c = (await created.json()).conversation;
    const turn = await call('turn', { conversation_id: c.id, request_id: randomUUID(), revision: 0, message: 'Chị mua cho mẹ', model: 'test-model' }, cookie);
    assert.equal(turn.status, 200); assert.equal((await turn.json()).conversation.state.history.length, 2);
    assert.equal((await call('create', { product_id: 'LAB-A' }, cookie, 'https://other.example')).status, 403);
    assert.equal((await call('create', { product_id: 'LAB-A' }, cookie.replace(/.$/, 'Z'))).status, 401);
    const other = await call('bootstrap'); const otherCookie = other.headers.get('set-cookie').split(';')[0];
    assert.equal((await fetch(`${base}/api/lab?action=conversation&id=${c.id}`, { headers: { Cookie: otherCookie } })).status, 404);
    assert.equal((await fetch(`${base}/api/lab?action=conversation&id=${c.id}`, { headers: { Cookie: cookie } })).status, 200);
    assert.equal((await fetch(`${base}/api/webhook`)).status, 404);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('cloud deployment keeps server credentials private and translates database conflicts', async () => {
  const store = new SupabaseLabStore({});
  await assert.rejects(store.result(Promise.resolve({ error: { code: '55P03', message: 'secret internal info' } })), e => e.status === 409 && !e.message.includes('secret'));
  await assert.rejects(store.result(Promise.resolve({ error: { code: 'other', message: 'secret-key' } })), e => e.status === 503 && !e.message.includes('secret-key'));
  const ui = readFileSync(new URL('../public/lab/lab.js', import.meta.url), 'utf8');
  assert.doesNotMatch(ui, /SUPABASE_SECRET_KEY|OPENAI_API_KEY\s*[:=]|graph\.facebook/);
  const sql = readFileSync(new URL('../sql/emi_sales_lab.sql', import.meta.url), 'utf8');
  assert.match(sql, /enable row level security/); assert.doesNotMatch(sql, /security definer/i);
  assert.match(sql, /revoke all on function/);
});
