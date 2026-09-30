import test from 'node:test';
import assert from 'node:assert/strict';

test('bot trả lời bằng AI theo nội dung và lịch sử hội thoại', async (t) => {
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SECRET_KEY = 'test-secret';
  process.env.PAGE_ACCESS_TOKEN = 'test-page-token';
  process.env.OPENAI_API_KEY = 'test-openai-key';

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
  const aiRequests = [];
  let aiResult = { reply: 'Dạ chị cần em tư vấn gì thêm ạ?', media_ids: [] };
  let aiStatus = 200;
  let responseStatus = 'completed';
  let failHistory = false;
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
      await new Promise((resolve) => setTimeout(resolve, 5));
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
  const scenario = async (name, run) => t.test(name, async () => {
    storedMessages.length = 0;
    sentToMessenger.length = 0;
    aiRequests.length = 0;
    errors.length = 0;
    aiResult = { reply: 'Dạ chị cần em tư vấn gì thêm ạ?', media_ids: [] };
    aiStatus = 200;
    responseStatus = 'completed';
    failHistory = false;
    settings.set('auto_reply_enabled', { key: 'auto_reply_enabled', value: { enabled: true } });
    await run();
  });
  try {
    await scenario('tắt bot thì không gọi AI hoặc gửi tin; vẫn lưu Ads ID', async () => {
      assert.equal((await action('GET', 'auto_reply_status')).enabled, true);
      assert.equal((await action('POST', 'toggle_auto_reply')).enabled, false);
      global.autoReplyEnabled = true;
      await deliver({ text: 'Tôi muốn xem mẫu quảng cáo', referral: { source: 'ADS', ad_id: '123456789' } });
      assert.equal(aiRequests.length, 0);
      assert.equal(sentToMessenger.length, 0);
      assert.equal(conversation.ad_id, '123456789');
      storedMessages.push({ sender_id: 'customer', direction: 'inbound', text: 'Tin nhắn cũ', conversation_id: null });
      const messages = await action('GET', 'get_messages');
      assert.equal(messages.find((message) => message.text === 'Tin nhắn cũ').adId, '123456789');
      assert.equal((await action('GET', 'auto_reply_status')).enabled, false);
    });

    await scenario('tin đầu có cân nặng, địa chỉ, số điện thoại được đưa vào AI đúng một lần', async () => {
      const order = '53kg cafe nông vụ Quang Thạnh vĩnh thái vĩnh thịnh vĩnh thạnh bình định cũ 0900000000';
      aiResult = { reply: 'Dạ em đã nhận địa chỉ và số điện thoại; 53kg hợp size M theo bảng ạ. Chị muốn chọn màu nào trong mẫu này ạ?', media_ids: [] };
      await deliver(order);
      assert.equal(aiRequests.length, 1);
      assert.deepEqual(aiRequests[0].input, [{ role: 'user', content: order }]);
      assert.match(aiRequests[0].instructions, /Size M: 50-58kg/);
      assert.match(aiRequests[0].instructions, /không hỏi lại thông tin đã có/);
      assert.match(aiRequests[0].instructions, /Giá: 289000/);
      assert.equal(aiRequests[0].text.format.type, 'json_schema');
      assert.equal(aiRequests[0].store, false);
      assert.deepEqual(sentToMessenger.map((item) => item.message), [{ text: aiResult.reply }]);
      assert.equal(storedMessages.at(-1).direction, 'outbound');
      assert.equal(storedMessages.at(-1).text, aiResult.reply);
    });

    await scenario('khách trả lời tiếp sau kịch bản cũ vẫn gọi AI và giữ lịch sử', async () => {
      settings.set('bot_welcome:customer', { key: 'bot_welcome:customer', value: { status: 'complete' } });
      storedMessages.push(
        { conversation_id: conversation.id, direction: 'inbound', text: 'Chị 53kg' },
        { conversation_id: conversation.id, direction: 'outbound', text: 'Chị cho em xin cân nặng và chiều cao để em chọn size chuẩn cho chị nhé ạ.' },
        { conversation_id: 999, direction: 'inbound', text: 'Khách khác 80kg' }
      );
      aiResult = { reply: 'Dạ em ghi nhận chị chọn màu đen, size M phù hợp với 53kg ạ.', media_ids: [] };
      await deliver('chị lấy màu đen');
      assert.deepEqual(aiRequests[0].input.map((item) => item.role), ['user', 'assistant', 'user']);
      assert.equal(aiRequests[0].input[0].content, 'Chị 53kg');
      assert.equal(aiRequests[0].input.at(-1).content, 'chị lấy màu đen');
      await deliver('cảm ơn em');
      assert.equal(aiRequests.length, 2);
      assert.ok(aiRequests[1].input.some((item) => item.role === 'assistant' && item.content === aiResult.reply));
      assert.equal(sentToMessenger.length, 2);
    });

    await scenario('ảnh/video chỉ gửi theo lựa chọn của AI, không kèm quảng cáo cố định', async () => {
      product.images.push({ media_type: 'video', facebook_attachment_id: 'video-1', sort_order: 0 });
      aiResult = { reply: 'Dạ em gửi chị hai ảnh của mẫu này ạ.', media_ids: ['primary-attachment', 'secondary-attachment'] };
      await deliver('cho chị xem ảnh');
      assert.deepEqual(sentToMessenger.map((item) => item.message.attachment?.payload.attachment_id || item.message.text),
        ['primary-attachment', 'secondary-attachment', aiResult.reply]);
      aiResult = { reply: 'Dạ em gửi chị video mẫu ạ.', media_ids: ['video-1'] };
      await deliver('có video không em');
      assert.equal(sentToMessenger[3].message.attachment.type, 'video');
      assert.ok(aiRequests[1].input.some((item) => item.content.includes('[Ảnh sản phẩm primary-attachment')));
      aiResult = { reply: 'Dạ chị nhé.', media_ids: [] };
      await deliver('ok em');
      assert.equal(sentToMessenger.length, 6);
      product.images.pop();
    });

    await scenario('thiếu ảnh không chặn trả lời bằng chữ', async () => {
      const original = product.images;
      product.images = [{ image_url: 'https://example.com/unregistered.jpg' }];
      try {
        await deliver('vải gì em');
        assert.equal(aiRequests.length, 1);
        assert.match(aiRequests[0].instructions, /ẢNH\/VIDEO CÓ THỂ GỬI:\n\[\]/);
        assert.deepEqual(sentToMessenger.map((item) => item.message), [{ text: aiResult.reply }]);
      } finally { product.images = original; }
    });

    await scenario('nhận tệp vẫn phân tích ngữ cảnh, không tự gửi bộ ảnh', async () => {
      await deliver({ attachments: [{ type: 'image', payload: { url: 'https://example.com/customer.jpg' } }] });
      assert.equal(aiRequests[0].input.at(-1).content, '[Khách gửi ảnh hoặc tệp]');
      assert.equal(sentToMessenger.length, 1);
      assert.equal(sentToMessenger[0].message.attachment, undefined);
    });

    await scenario('OpenAI lỗi thì ghi log, không gửi quảng cáo thay thế', async () => {
      aiStatus = 401;
      await deliver('chị đã gửi địa chỉ rồi');
      assert.equal(aiRequests.length, 1);
      assert.equal(sentToMessenger.length, 0);
      assert.ok(global.taskLogs.some((log) => log.action === 'Auto-reply' && /OpenAI unavailable/.test(log.detail)));
    });

    await scenario('thiếu API key được ghi rõ, không âm thầm chạy kịch bản cũ', async () => {
      delete process.env.OPENAI_API_KEY;
      try {
        await deliver('53kg chị mặc size gì');
        assert.equal(aiRequests.length, 0);
        assert.equal(sentToMessenger.length, 0);
        assert.ok(global.taskLogs.some((log) => /Chưa cấu hình OPENAI_API_KEY/.test(log.detail)));
      } finally { process.env.OPENAI_API_KEY = 'test-openai-key'; }
    });

    await scenario('không gửi kết quả chưa hoàn tất hoặc ID ảnh do AI bịa', async () => {
      responseStatus = 'incomplete';
      await deliver('tư vấn giúp chị');
      assert.equal(sentToMessenger.length, 0);
      responseStatus = 'completed';
      aiResult.media_ids = ['unknown-attachment'];
      await deliver('xem ảnh');
      assert.equal(sentToMessenger.length, 0);
      aiResult = { reply: ' ', media_ids: [] };
      await deliver('giá sao em');
      assert.equal(sentToMessenger.length, 0);
      assert.equal(errors.length, 3);
    });

    await scenario('không trả lời thiếu ngữ cảnh khi không đọc được lịch sử', async () => {
      failHistory = true;
      await deliver('địa chỉ như trên em nhé');
      assert.equal(aiRequests.length, 0);
      assert.equal(sentToMessenger.length, 0);
      assert.ok(global.taskLogs.some((log) => /history unavailable/.test(log.detail)));
      assert.ok(storedMessages.some((message) => message.direction === 'inbound' && message.text === 'địa chỉ như trên em nhé'));
    });

    await scenario('echo không tạo vòng lặp; test kết nối trả về văn bản', async () => {
      await deliver({ text: 'tin shop gửi', is_echo: true });
      assert.equal(aiRequests.length, 0);
      aiResult = { reply: 'OK', media_ids: [] };
      assert.deepEqual(await action('GET', 'test_openai'), { ok: true, reply: 'OK' });
      assert.equal(sentToMessenger.length, 0);
    });
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalError;
  }
});
