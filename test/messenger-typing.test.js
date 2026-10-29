import test from 'node:test';
import assert from 'node:assert/strict';
import { withTypingDelay } from '../server/messenger-typing.js';

test('mặc định gửi ngay, không gọi thêm sender action', async () => {
  const originalFetch = globalThis.fetch;
  const previousDelay = process.env.MESSENGER_TYPING_DELAY_MS;
  delete process.env.MESSENGER_TYPING_DELAY_MS;
  const events = [];
  globalThis.fetch = async () => { throw new Error('không được gọi Graph API'); };
  const wait = async (ms) => { events.push(ms); };
  try {
    await withTypingDelay('customer', 'xin chào', async () => events.push('send'), { wait });
    assert.deepEqual(events, ['send']);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousDelay === undefined) delete process.env.MESSENGER_TYPING_DELAY_MS;
    else process.env.MESSENGER_TYPING_DELAY_MS = previousDelay;
  }
});

test('có thể bật typing delay và luôn tắt typing kể cả khi gửi lỗi', async () => {
  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn;
  const previousDelay = process.env.MESSENGER_TYPING_DELAY_MS;
  process.env.MESSENGER_TYPING_DELAY_MS = '250';
  const events = [];
  let actionStatus = 200;
  globalThis.fetch = async (_, options) => {
    const payload = JSON.parse(options.body);
    assert.deepEqual(payload.recipient, { id: 'customer' });
    assert.equal(payload.message, undefined);
    events.push(payload.sender_action);
    return new Response('{}', { status: actionStatus });
  };
  console.warn = () => {};
  const wait = async (ms) => { events.push(ms); };
  try {
    await withTypingDelay('customer', 'xin chào', async () => events.push('send'), { wait });
    assert.deepEqual(events, ['typing_on', 250, 'send', 'typing_off']);
    events.length = 0;
    await assert.rejects(withTypingDelay('customer', 'xin chào', async () => {
      events.push('send');
      throw new Error('send failed');
    }, { wait }), /send failed/);
    assert.deepEqual(events, ['typing_on', 250, 'send', 'typing_off']);
    events.length = 0;
    actionStatus = 500;
    await withTypingDelay('customer', 'xin chào', async () => events.push('send'), { wait });
    assert.deepEqual(events, ['typing_on', 250, 'send', 'typing_off']);
  } finally {
    globalThis.fetch = originalFetch;
    console.warn = originalWarn;
    if (previousDelay === undefined) delete process.env.MESSENGER_TYPING_DELAY_MS;
    else process.env.MESSENGER_TYPING_DELAY_MS = previousDelay;
  }
});
