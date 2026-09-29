import test from 'node:test';
import assert from 'node:assert/strict';

test('bot gửi hai ảnh riêng, lời chào và câu hỏi rồi dừng', async () => {
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
      { image_url: 'https://example.com/secondary.jpg', facebook_attachment_id: 'secondary-attachment', sort_order: 1 },
      { image_url: 'https://example.com/primary.jpg', facebook_attachment_id: 'primary-attachment', is_primary: true, sort_order: 2 }
    ]
  };
  let conversation = null;
  const settings = new Map([['auto_reply_enabled', { key: 'auto_reply_enabled', value: { enabled: true } }]]);
  const storedMessages = [];
  const sentToMessenger = [];
  let failSecondImageOnce = false;
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
      await new Promise((resolve) => setTimeout(resolve, 5));
      if (failSecondImageOnce && payload.message?.attachment?.payload?.attachment_id === 'secondary-attachment') {
        failSecondImageOnce = false;
        return json({ error: 'temporary image error' }, 500);
      }
      sentToMessenger.push(payload);
      return json({ message_id: `mid-${sentToMessenger.length}` });
    }

    const table = url.pathname.split('/').at(-1);
    const single = new Headers(init.headers).get('accept')?.includes('vnd.pgrst.object');
    if (table === 'app_settings') {
      const key = url.searchParams.get('key')?.slice(3);
      const stamp = url.searchParams.get('updated_at')?.slice(3);
      if (method === 'POST') {
        const row = JSON.parse(init.body);
        if (settings.has(row.key) && row.key !== 'auto_reply_enabled') {
          return json({ code: '23505', message: 'duplicate key' }, 409);
        }
        settings.set(row.key, row);
        return json(null, 201);
      }
      if (method === 'PATCH') {
        const current = settings.get(key);
        if (!current || (stamp && current.updated_at !== stamp)) return json(single ? null : []);
        const updated = { ...current, ...JSON.parse(init.body) };
        settings.set(key, updated);
        return json(single ? updated : [updated]);
      }
      if (method === 'DELETE') {
        if (settings.get(key)?.updated_at === stamp) settings.delete(key);
        return json(null);
      }
      const setting = settings.get(key);
      return json(single ? setting || null : setting ? [setting] : []);
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
      if (url.searchParams.get('select') === 'text') {
        return json(storedMessages.filter((message) =>
          message.conversation_id === conversation?.id && message.direction === 'outbound'
        ).map((message) => ({ text: message.text })));
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
  try {
    assert.equal((await action('GET', 'auto_reply_status')).enabled, true);
    assert.equal((await action('POST', 'toggle_auto_reply')).enabled, false);
    global.autoReplyEnabled = true; // Mô phỏng một phiên chạy giữ trạng thái cũ.
    await deliver('Chào shop');
    assert.equal(sentToMessenger.length, 0);
    assert.equal((await action('GET', 'auto_reply_status')).enabled, false);
    assert.equal((await action('POST', 'toggle_auto_reply')).enabled, true);

    const originalError = console.error;
    const sendErrors = [];
    console.error = (...args) => sendErrors.push(args);
    product.images[0].facebook_attachment_id = '';
    try {
      await deliver('Chào shop');
    } finally {
      product.images[0].facebook_attachment_id = 'secondary-attachment';
      console.error = originalError;
    }
    assert.equal(sentToMessenger.length, 0);
    assert.equal(sendErrors.length, 1);
    assert.match(sendErrors[0][1].message, /2 facebook_attachment_id/);

    failSecondImageOnce = true;
    console.error = (...args) => sendErrors.push(args);
    try {
      await Promise.all([deliver('Chào shop'), deliver('Giá bao nhiêu?'), deliver('Chào shop')]);
    } finally {
      console.error = originalError;
    }
    assert.equal(sendErrors.length, 2);
    assert.equal(sentToMessenger.length, 1);
    assert.equal(settings.has('bot_welcome:customer'), false);

    await Promise.all([deliver('Gửi tiếp'), deliver('Tư vấn giúp chị')]);
    assert.equal(sentToMessenger.length, 4);
    assert.equal(settings.get('bot_welcome:customer')?.value?.status, 'complete');
    const firstReplies = sentToMessenger.map((item) => item.message);
    assert.deepEqual(firstReplies[0].attachment.payload, { attachment_id: 'primary-attachment' });
    assert.deepEqual(firstReplies[1].attachment.payload, { attachment_id: 'secondary-attachment' });
    assert.equal(firstReplies[0].attachments, undefined);
    assert.equal(firstReplies[1].attachments, undefined);
    assert.equal(firstReplies[2].text, '🌷 Dạ mẫu này bên em đang giảm giá còn 289K + MIỄN PHÍ SHIP chị nha, ngày mai bên em về lại giá gốc 450K ạ 🥰  Vải cotton lạnh mềm mát, co giãn nhẹ, ít nhăn, mặc thoải mái không bí nóng. Form lên dáng đẹp, dễ mặc lắm chị ạ.');
    assert.match(firstReplies[3].text, /cân nặng và chiều cao/);

    await deliver({ attachments: [{ type: 'image', payload: { url: 'https://example.com/customer.jpg' } }] });
    await deliver('cao 1m60 nặng 55');
    await deliver('Chào shop');
    assert.equal(sentToMessenger.length, 4);

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
