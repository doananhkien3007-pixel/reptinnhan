import test from 'node:test';
import assert from 'node:assert/strict';
import { PROMOTION_MESSAGE, SIZE_QUESTION } from '../api/services/product-introduction.js';

test('bot hoàn tất tư vấn sản phẩm chính rồi dừng', async (t) => {
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SECRET_KEY = 'test-secret';
  process.env.PAGE_ACCESS_TOKEN = 'test-page-token';
  process.env.OPENAI_API_KEY = 'test-openai-key';
  process.env.MESSENGER_TYPING_DELAY_MS = '0';

  const product = {
    id: 7,
    sku: 'VAY-7',
    name: 'Váy hoa thiết kế',
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
  const aiRequests = [];
  let aiResult = { reply: 'Dạ chị cần em tư vấn gì thêm ạ?', media_ids: [] };
  let aiStatus = 200;
  let responseStatus = 'completed';
  let failHistory = false;
  let missingMainProduct = false;
  let failAttachmentOnce = null;
  const originalFetch = globalThis.fetch;
  const json = (data, status = 200) => new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' }
  });

  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    const method = init.method || 'GET';
    if (url.hostname === 'api.openai.com') {
      const payload = JSON.parse(init.body);
      aiRequests.push(payload);
      return json(aiStatus === 200 ? {
        id: 'resp_test', object: 'response', status: responseStatus,
        output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: JSON.stringify(aiResult), annotations: [] }] }]
      } : { error: { message: 'OpenAI unavailable', type: 'api_error' } }, aiStatus);
    }
    if (url.hostname === 'graph.facebook.com') {
      const payload = JSON.parse(init.body);
      if (payload.sender_action) return json({ recipient_id: 'customer' });
      await new Promise((resolve) => setTimeout(resolve, 5));
      if (failAttachmentOnce && payload.message?.attachment?.payload?.attachment_id === failAttachmentOnce) {
        failAttachmentOnce = null;
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
      return json(single ? product : missingMainProduct ? [{ ...product, name: 'Váy khác' }] : [product]);
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
        if (failHistory) return json({ message: 'history unavailable' }, 500);
        const offset = Number(url.searchParams.get('offset') || 0);
        const limit = Number(url.searchParams.get('limit') || 500);
        return json(storedMessages.filter((message) => message.sender_id === 'customer' && message.direction === 'outbound')
          .slice(offset, offset + limit).map((message) => ({ text: message.text })));
      }
      if (url.searchParams.get('select') === 'direction,text,created_at') {
        if (failHistory) return json({ message: 'history unavailable' }, 500);
        return json(storedMessages.filter((message) => message.conversation_id === conversation?.id)
          .slice(-Number(url.searchParams.get('limit'))).reverse());
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
  const originalError = console.error;
  const errors = [];
  console.error = (...args) => errors.push(args);
  const seed = (text) => storedMessages.push({ sender_id: 'customer', conversation_id: 11, direction: 'outbound', text });
  const scenario = async (name, run) => t.test(name, async () => {
    storedMessages.length = 0;
    sentToMessenger.length = 0;
    aiRequests.length = 0;
    errors.length = 0;
    settings.clear();
    conversation = { id: 11, channel: 'facebook', external_user_id: 'customer', current_product_id: 7 };
    failHistory = false;
    missingMainProduct = false;
    failAttachmentOnce = null;
    settings.set('auto_reply_enabled', { key: 'auto_reply_enabled', value: { enabled: true } });
    await run();
  });
  try {
    await scenario('khách mới nhận ảnh, thông tin, câu hỏi size rồi im lặng dù khách nhắn tiếp', async () => {
      delete process.env.OPENAI_API_KEY;
      try {
        await deliver('Chào shop');
        assert.deepEqual(sentToMessenger.map((item) => item.message.attachment?.payload.attachment_id || 'text'),
          ['primary-attachment', 'secondary-attachment', 'text', 'text']);
        assert.equal(sentToMessenger[2].message.text, PROMOTION_MESSAGE);
        assert.match(sentToMessenger[3].message.text, /cân nặng và chiều cao/);
        await deliver('chị 53kg cao 1m60');
        await deliver('giá bao nhiêu');
        assert.equal(sentToMessenger.length, 4);
        assert.equal(aiRequests.length, 0);
      } finally { process.env.OPENAI_API_KEY = 'test-openai-key'; }
    });
    await scenario('khóa chào cũ complete nhưng chưa hỏi size vẫn bổ sung đúng câu hỏi', async () => {
      settings.set('bot_welcome:customer', { key: 'bot_welcome:customer', value: { status: 'complete' } });
      seed('[Ảnh sản phẩm 1]');
      seed('[Ảnh sản phẩm 2]');
      seed('Mẫu này đang ưu đãi 289K + MIỄN PHÍ SHIP, vải cotton lạnh mềm mát.');
      await deliver('chị muốn mua');
      assert.equal(sentToMessenger.length, 1);
      assert.match(sentToMessenger[0].message.text, /cân nặng và chiều cao/);
      await deliver('53kg');
      assert.equal(sentToMessenger.length, 1);
    });
    await scenario('đã tư vấn đầy đủ trong lịch sử cũ thì không gửi thêm', async () => {
      seed('[Ảnh sản phẩm 1]'); seed('[Ảnh sản phẩm 2]');
      seed('Giá 289.000đ miễn phí ship, chất vải Cotton lạnh');
      seed('Chị cho em xin cân nặng và chiều cao nhé');
      await deliver('cảm ơn');
      assert.equal(sentToMessenger.length, 0);
      assert.equal(aiRequests.length, 0);
    });
    await scenario('thiếu nội dung thì gửi đúng mẫu ưu đãi và câu hỏi đã được yêu cầu', async () => {
      seed('[Ảnh sản phẩm 1]'); seed('[Ảnh sản phẩm 2]');
      seed('289000đ freeship. Chị cho em xin cân nặng');
      await deliver('53kg');
      assert.equal(sentToMessenger.length, 2);
      assert.equal(sentToMessenger[0].message.text, PROMOTION_MESSAGE);
      assert.equal(sentToMessenger[1].message.text, SIZE_QUESTION);
    });
    await scenario('không dùng mẫu cũ hay lịch sử mẫu cũ thay cho váy hoa thiết kế', async () => {
      conversation.current_product_id = 99;
      seed('[Ảnh sản phẩm 1]'); seed('[Ảnh sản phẩm 2]');
      seed('289K freeship cotton lạnh, cho xin cân nặng chiều cao');
      await deliver('Chào shop');
      assert.equal(sentToMessenger.length, 4);
      assert.equal(conversation.current_product_id, 7);
      assert.ok(storedMessages.some((message) => message.text === '[Ảnh sản phẩm 7:primary-attachment]'));
    });
    await scenario('gửi lỗi giữa chừng thì lần sau chỉ gửi phần thiếu', async () => {
      failAttachmentOnce = 'secondary-attachment';
      await deliver('Chào shop');
      assert.equal(sentToMessenger.length, 1);
      assert.equal(settings.get('bot_intro_v2:7:customer').value.status, 'retry');
      await deliver('gửi tiếp');
      assert.equal(sentToMessenger.length, 4);
      await deliver('chị 53kg');
      assert.equal(sentToMessenger.length, 4);
    });
    await scenario('webhook đồng thời không gửi trùng bộ tư vấn', async () => {
      await Promise.all([deliver('Chào shop'), deliver('giá sao'), deliver('xin thông tin')]);
      assert.equal(sentToMessenger.length, 4);
      assert.equal(aiRequests.length, 0);
    });
    await scenario('kiểm tra lịch sử đầy đủ vượt 500 tin, không chỉ 40 tin gần nhất', async () => {
      seed('[Ảnh sản phẩm 1]'); seed('[Ảnh sản phẩm 2]');
      for (let i = 0; i < 501; i++) seed('Tin shop cũ');
      seed('289K freeship cotton lạnh. Chị cho em cân nặng và chiều cao');
      await deliver('Chào shop');
      assert.equal(sentToMessenger.length, 0);
    });
    await scenario('không coi nội dung khách tự nhắn là đã được shop tư vấn', async () => {
      await deliver('289K freeship cotton lạnh cân nặng chiều cao');
      assert.equal(sentToMessenger.length, 4);
    });
    await scenario('không tìm thấy sản phẩm chính hoặc lỗi lịch sử thì không đoán', async () => {
      missingMainProduct = true;
      await deliver('Chào shop');
      assert.equal(sentToMessenger.length, 0);
      assert.match(errors.at(-1)[1].message, /Váy hoa thiết kế/);
      missingMainProduct = false;
      failHistory = true;
      await deliver('Chào shop');
      assert.equal(sentToMessenger.length, 0);
      assert.match(errors.at(-1)[1].message, /history unavailable/);
    });
    await scenario('đã gửi hình nhưng khóa complete sai vẫn gửi hai tin còn thiếu', async () => {
      seed('[Ảnh sản phẩm 7:primary-attachment]'); seed('[Ảnh sản phẩm 7:secondary-attachment]');
      settings.set('bot_intro_v2:7:customer', { key: 'bot_intro_v2:7:customer', value: { status: 'complete' }, updated_at: '2026-10-01T00:00:00Z' });
      await deliver('Tư vấn giúp chị');
      assert.deepEqual(sentToMessenger.map((item) => item.message), [{ text: PROMOTION_MESSAGE }, { text: SIZE_QUESTION }]);
      await deliver('chị 53kg');
      assert.equal(sentToMessenger.length, 2);
    });
    await scenario('tắt bot và echo không gửi tư vấn', async () => {
      await deliver({ text: 'tin shop', is_echo: true });
      assert.equal(sentToMessenger.length, 0);
      await action('POST', 'toggle_auto_reply');
      await deliver('Chào shop');
      assert.equal(sentToMessenger.length, 0);
      assert.equal(aiRequests.length, 0);
    });
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalError;
  }
});
