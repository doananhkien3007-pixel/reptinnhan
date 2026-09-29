import test from 'node:test';
import assert from 'node:assert/strict';

test('tin nhắn đầu tự gửi album và tư vấn sản phẩm duy nhất, tin sau tư vấn size', async () => {
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SECRET_KEY = 'test-secret';
  process.env.PAGE_ACCESS_TOKEN = 'test-page-token';

  const product = {
    id: 7,
    sku: 'VAY-7',
    name: 'Váy cotton lạnh',
    status: 'active',
    price: 289000,
    material: 'Cotton lạnh',
    size_guide: 'Size M: 50-58kg',
    colors: ['Đen'],
    images: [
      { image_url: 'https://example.com/secondary.jpg', sort_order: 1 },
      { image_url: 'https://example.com/primary.jpg', is_primary: true, sort_order: 2 }
    ]
  };
  let conversation = null;
  let savedAutoReplyEnabled = true;
  const storedMessages = [];
  const sentToMessenger = [];
  const originalFetch = globalThis.fetch;
  const json = (data, status = 200) => new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' }
  });

  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    const method = init.method || 'GET';
    if (url.hostname === 'graph.facebook.com') {
      const payload = JSON.parse(init.body);
      sentToMessenger.push(payload);
      return json({ message_id: `mid-${sentToMessenger.length}` });
    }

    const table = url.pathname.split('/').at(-1);
    const single = new Headers(init.headers).get('accept')?.includes('vnd.pgrst.object');
    if (table === 'app_settings') {
      if (method === 'POST') {
        savedAutoReplyEnabled = JSON.parse(init.body).value.enabled;
        return json(null, 201);
      }
      const setting = { value: { enabled: savedAutoReplyEnabled } };
      return json(single ? setting : [setting]);
    }
    if (table === 'system_prompts') return json(single ? null : []);
    if (table === 'conversations') {
      if (method === 'GET') return json(single ? conversation : conversation ? [conversation] : []);
      if (method === 'POST') conversation = { id: 11, channel: 'facebook', external_user_id: 'customer', current_product_id: null };
      if (method === 'PATCH') conversation = { ...conversation, ...JSON.parse(init.body) };
      return json(single ? conversation : [conversation], method === 'POST' ? 201 : 200);
    }
    if (table === 'ad_product_mappings') return json(single ? null : []);
    if (table === 'products') {
      const select = url.searchParams.get('select');
      if (select === 'images') return json([{ images: product.images }]);
      if (select === 'name,size_guide') return json(single ? product : [product]);
      return json(single ? product : [product]);
    }
    if (table === 'messenger_messages') {
      if (method === 'POST') {
        storedMessages.push(JSON.parse(init.body));
        return json(null, 201);
      }
      if (url.searchParams.get('select') === 'sender_id,direction,text,message_time,conversation_id') {
        return json(storedMessages.map((message) => ({
          ...message,
          message_time: '2026-09-29T00:00:00Z'
        })));
      }
      const textFilter = url.searchParams.get('text');
      const matches = storedMessages.filter((message) =>
        message.conversation_id === conversation?.id && message.direction === 'outbound' &&
        (!textFilter || message.text === textFilter.slice(3)));
      return json(matches.map((message, index) => ({ id: index + 1, ...message })));
    }
    if (table === 'task_logs') return json(null, 201);
    throw new Error(`Unexpected request: ${method} ${url}`);
  };

  const { default: handler } = await import('../api/webhook.js');
  const action = async (method, name) => {
    const res = {
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; }
    };
    await handler({ method, query: { action: name }, body: {} }, res);
    assert.equal(res.statusCode, 200);
    return res.body;
  };
  const deliver = async (message) => {
    const req = {
      method: 'POST',
      query: {},
      body: { object: 'page', entry: [{ messaging: [{ sender: { id: 'customer' }, message: typeof message === 'string' ? { text: message } : message }] }] }
    };
    const res = {
      status(code) { this.statusCode = code; return this; },
      send(body) { this.body = body; return this; }
    };
    await handler(req, res);
    assert.equal(res.statusCode, 200);
  };
  const waitFor = async (predicate) => {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`Timed out; sent ${JSON.stringify(sentToMessenger)}`);
  };

  try {
    assert.equal((await action('GET', 'auto_reply_status')).enabled, true);
    assert.equal((await action('POST', 'toggle_auto_reply')).enabled, false);
    global.autoReplyEnabled = true; // Mô phỏng một phiên chạy giữ trạng thái cũ.
    await deliver('Chào shop');
    assert.equal(sentToMessenger.length, 0);
    assert.equal((await action('GET', 'auto_reply_status')).enabled, false);
    assert.equal((await action('POST', 'toggle_auto_reply')).enabled, true);

    await deliver('Chào shop');
    await waitFor(() => sentToMessenger.filter((item) => item.message).length === 4);
    const firstReplies = sentToMessenger.filter((item) => item.message).map((item) => item.message);
    assert.deepEqual(firstReplies[0].attachments.map((item) => item.payload.url), [
      'https://example.com/primary.jpg', 'https://example.com/secondary.jpg'
    ]);
    assert.match(firstReplies[1].text, /289K \+ freeship/);
    assert.match(firstReplies[2].text, /cotton lạnh/);
    assert.match(firstReplies[3].text, /chiều cao \+ cân nặng/);

    await deliver({ attachments: [{ type: 'image', payload: { url: 'https://example.com/customer.jpg' } }] });
    await waitFor(() => sentToMessenger.filter((item) => item.message).length === 5);
    assert.match(sentToMessenger.filter((item) => item.message).at(-1).message.text, /chiều cao \+ cân nặng/);

    await deliver('cao 1m60 nặng 55');
    await waitFor(() => sentToMessenger.filter((item) => item.message).length === 6);
    const followup = sentToMessenger.filter((item) => item.message).at(-1).message;
    assert.match(followup.text, /size M/);
    assert.equal(sentToMessenger.filter((item) => item.message?.attachments).length, 1);

    assert.equal((await action('POST', 'toggle_auto_reply')).enabled, false);
    await deliver({ text: 'Tôi muốn xem mẫu quảng cáo', referral: { source: 'ADS', ad_id: '123456789' } });
    assert.equal(conversation.ad_id, '123456789');
    storedMessages.push({ sender_id: 'customer', direction: 'inbound', text: 'Tin nhắn cũ', conversation_id: null });
    const messages = await action('GET', 'get_messages');
    assert.equal(messages.find((message) => message.text === 'Tôi muốn xem mẫu quảng cáo').adId, '123456789');
    assert.equal(messages.find((message) => message.text === 'Tin nhắn cũ').adId, '123456789');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
