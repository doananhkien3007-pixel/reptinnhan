import test from 'node:test';
import assert from 'node:assert/strict';
import { withTypingDelay } from '../server/messenger-typing.js';

test('typing có chờ trước tin nhắn và luôn tắt kể cả khi gửi lỗi', async () => {
  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn;
  const previousDelay = process.env.MESSENGER_TYPING_DELAY_MS;
  delete process.env.MESSENGER_TYPING_DELAY_MS;
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
    assert.deepEqual(events, ['typing_on', 1000, 'send', 'typing_off']);
    events.length = 0;
    await assert.rejects(withTypingDelay('customer', 'a'.repeat(300), async () => {
      events.push('send');
      throw new Error('send failed');
    }, { wait }), /send failed/);
    assert.deepEqual(events, ['typing_on', 3000, 'send', 'typing_off']);
    events.length = 0;
    actionStatus = 500;
    await withTypingDelay('customer', 'xin chào', async () => events.push('send'), { wait });
    assert.deepEqual(events, ['typing_on', 1000, 'send', 'typing_off']);
  } finally {
    globalThis.fetch = originalFetch;
    console.warn = originalWarn;
    if (previousDelay === undefined) delete process.env.MESSENGER_TYPING_DELAY_MS;
    else process.env.MESSENGER_TYPING_DELAY_MS = previousDelay;
  }
});
