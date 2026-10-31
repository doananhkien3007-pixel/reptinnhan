import test from 'node:test';
import assert from 'node:assert/strict';
import { REMARKETING_MESSAGE, customerDeclined, customerHasMeasurements } from '../server/remarketing.js';
import { runRemarketingBatch } from '../server/remarketing-runner.js';
import handler from '../api/remarketing.js';

function fakeStore({ dryRun = false, validation = { valid: true }, claims } = {}) {
  const calls = [];
  let claimed = false;
  const cycle = {
    cycle_id: '00000000-0000-4000-8000-000000000001',
    claim_token: '00000000-0000-4000-8000-000000000002',
    customer_psid: 'customer',
    step: 1
  };
  return {
    calls,
    async status() { return { enabled: true, dry_run: dryRun }; },
    async preview() { calls.push(['preview']); return [cycle]; },
    async claim() {
      calls.push(['claim']);
      if (claims) return claims;
      if (claimed) return [];
      claimed = true;
      return [cycle];
    },
    async validate(value) { calls.push(['validate', value.cycle_id]); return validation; },
    async prepareOutbound(value) {
      calls.push(['prepare', value.cycle_id]);
      return { token: '00000000-0000-4000-8000-000000000003', metadata: 'leafchat:00000000-0000-4000-8000-000000000003' };
    },
    async finishOutbound(_registration, outcome) { calls.push(['outbound', outcome.status, outcome.messageId]); },
    async complete(value, messageId) { calls.push(['complete', value.cycle_id, messageId]); },
    async fail(value, kind, code) { calls.push(['fail', value.cycle_id, kind, code]); }
  };
}

test('nội dung remarketing giữ nguyên hai dòng đã duyệt', () => {
  assert.equal(REMARKETING_MESSAGE, 'Chị ưng mẫu nào không ạ ?\nChị gửi em chiều cao + cân nặng, em chọn size vừa đẹp cho mình nha 🥰');
});

test('nhận diện từ chối và số đo để huỷ trước giờ gửi', () => {
  assert.equal(customerDeclined('Thôi em, chị không cần nha'), true);
  assert.equal(customerDeclined('Chị xem thêm đã'), false);
  assert.equal(customerHasMeasurements([], 'chị cao 1m60 nặng 53kg'), true);
  assert.equal(customerHasMeasurements([], 'mẫu này giá bao nhiêu'), false);
});

test('dry-run chỉ đếm job đủ điều kiện, không claim hoặc gửi Messenger', async () => {
  const store = fakeStore({ dryRun: true });
  let fetched = false;
  const result = await runRemarketingBatch({ store, fetchImpl: async () => { fetched = true; }, pageAccessToken: 'page-token' });
  assert.deepEqual(result, { mode: 'dry_run', checked: 1, sent: 0 });
  assert.equal(fetched, false);
  assert.deepEqual(store.calls, [['preview']]);
});

test('claim được kiểm tra lại rồi chỉ gửi một lần với marker bot và RESPONSE', async () => {
  const store = fakeStore();
  const payloads = [];
  const fetchImpl = async (_url, init) => {
    payloads.push(JSON.parse(init.body));
    return Response.json({ message_id: 'mid-remarketing-1' });
  };
  const first = await runRemarketingBatch({ store, fetchImpl, pageAccessToken: 'page-token' });
  const second = await runRemarketingBatch({ store, fetchImpl, pageAccessToken: 'page-token' });
  assert.equal(first.sent, 1);
  assert.equal(second.sent, 0);
  assert.equal(payloads.length, 1);
  assert.equal(payloads[0].message_type, 'RESPONSE');
  assert.equal(payloads[0].message.text, REMARKETING_MESSAGE);
  assert.match(payloads[0].message.metadata, /^leafchat:/);
  assert.ok(store.calls.some(call => call[0] === 'complete' && call[2] === 'mid-remarketing-1'));
});

test('khách reply hoặc bot bị tắt trong preflight thì không gửi', async () => {
  const store = fakeStore({ validation: { valid: false, reason: 'customer_message' } });
  let fetched = false;
  const result = await runRemarketingBatch({
    store,
    fetchImpl: async () => { fetched = true; },
    pageAccessToken: 'page-token'
  });
  assert.equal(result.skipped, 1);
  assert.equal(fetched, false);
  assert.equal(store.calls.some(call => call[0] === 'prepare'), false);
});

test('timeout sau khi bắt đầu gửi được đánh dấu uncertain và không tự retry', async () => {
  const store = fakeStore();
  const fetchImpl = async () => { throw Object.assign(new Error('timeout'), { name: 'AbortError' }); };
  const result = await runRemarketingBatch({ store, fetchImpl, pageAccessToken: 'page-token' });
  assert.equal(result.uncertain, 1);
  assert.ok(store.calls.some(call => call[0] === 'fail' && call[2] === 'uncertain'));
  assert.ok(store.calls.some(call => call[0] === 'outbound' && call[1] === 'uncertain'));
});

test('chỉ lỗi 429 rõ ràng được xếp retryable; lỗi 5xx là uncertain', async () => {
  const rateStore = fakeStore();
  await runRemarketingBatch({
    store: rateStore,
    pageAccessToken: 'page-token',
    fetchImpl: async () => Response.json({ error: { code: 4 } }, { status: 429 })
  });
  assert.ok(rateStore.calls.some(call => call[0] === 'fail' && call[2] === 'retryable'));

  const serverStore = fakeStore();
  await runRemarketingBatch({
    store: serverStore,
    pageAccessToken: 'page-token',
    fetchImpl: async () => Response.json({ error: { code: 2 } }, { status: 500 })
  });
  assert.ok(serverStore.calls.some(call => call[0] === 'fail' && call[2] === 'uncertain'));
});

test('endpoint cron từ chối thiếu secret và không lộ chi tiết', async () => {
  process.env.REMARKETING_CRON_SECRET = 'a'.repeat(32);
  const call = async authorization => {
    const res = {
      setHeader() {},
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; }
    };
    await handler({ method: 'POST', headers: authorization ? { authorization } : {} }, res);
    return res;
  };
  assert.equal((await call()).statusCode, 401);
  assert.equal((await call('Bearer wrong')).statusCode, 401);
});
