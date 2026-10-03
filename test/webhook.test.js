import test from 'node:test';
import assert from 'node:assert/strict';
import { PROMOTION_MESSAGE, SIZE_QUESTION } from '../server/product-introduction.js';

test('bot hiểu ngữ cảnh và trả lời liên tục theo từng khách', async (t) => {
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SECRET_KEY = 'test-secret';
  process.env.PAGE_ACCESS_TOKEN = 'test-page-token';
  process.env.OPENAI_API_KEY = 'test-openai-key';
  process.env.MESSENGER_TYPING_DELAY_MS = '0';
  process.env.MESSENGER_SEQUENCE_DELAY_MS = '0';
  process.env.MESSENGER_INITIAL_REPLY_DELAY_MS = '0';

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
      { image_url: 'https://example.com/primary.jpg', facebook_attachment_id: 'primary-attachment', is_primary: true, sort_order: 2 },
      { media_type: 'video', facebook_attachment_id: 'video-attachment', sort_order: 3 }
    ]
  };
  let conversation = null;
  const settings = new Map([['auto_reply_enabled', { key: 'auto_reply_enabled', value: { enabled: true } }]]);
  const storedMessages = [];
  const sentToMessenger = [];
  const aiRequests = [];
  let aiResult = { intent: 'other', reply: 'Dạ chị cần em tư vấn gì thêm ạ?', media_ids: [] };
  let aiStatus = 200;
  let responseStatus = 'completed';
  let failHistory = false;
  let multipleProducts = false;
  let failTextOnce = false;
  let eventCounter = 0;
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
      if (failTextOnce && payload.message?.text) { failTextOnce = false; return json({ error: 'temporary send error' }, 500); }
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
        if (settings.has(row.key) && !new Headers(init.headers).get('prefer')?.includes('resolution=merge-duplicates')) {
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
      return json(single ? product : multipleProducts ? [product, { ...product, id: 8, sku: 'VAY-8', name: 'Váy lụa', price: 399000 }] : [product]);
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
  const action = async (method, name, body = {}, expectedStatus = 200) => {
    const res = {
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; }
    };
    await handler({ method, query: { action: name }, body }, res);
    assert.equal(res.statusCode, expectedStatus);
    return res.body;
  };
  const deliver = async (message, event = {}, expectedStatus = 200) => {
    const req = {
      method: 'POST',
      query: {},
      body: { object: 'page', entry: [{ messaging: [{ sender: { id: 'customer' }, message: typeof message === 'string' ? { text: message, mid: `event-${++eventCounter}` } : { mid: `event-${++eventCounter}`, ...message }, ...event }] }] }
    };
    const res = {
      status(code) { this.statusCode = code; return this; },
      send(body) { this.body = body; return this; }
    };
    await handler(req, res);
    assert.equal(res.statusCode, expectedStatus);
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
    multipleProducts = false;
    failTextOnce = false;
    aiStatus = 200;
    responseStatus = 'completed';
    aiResult = { intent: 'other', reply: 'Dạ chị cần em tư vấn gì thêm ạ?', media_ids: [] };
    failAttachmentOnce = null;
    settings.set('auto_reply_enabled', { key: 'auto_reply_enabled', value: { enabled: true } });
    await run();
  });
  try {
    await scenario('khách mới được AI trả lời đúng câu hỏi, không chạy bộ chào cố định', async () => {
      aiResult = { intent: 'price', reply: 'Dạ mẫu váy hoa có giá 289.000đ chị nhé.', media_ids: [] };
      await deliver('mẫu này giá bn');
      assert.equal(sentToMessenger.length, 1);
      assert.equal(sentToMessenger[0].message.text, aiResult.reply);
      assert.equal(aiRequests.length, 1);
      assert.match(aiRequests[0].instructions, /289000/);
      assert.match(aiRequests[0].instructions, /Cotton lạnh/);
      assert.equal(aiRequests[0].input.filter(item => item.content === 'mẫu này giá bn').length, 1);
    });
    await scenario('khách đã nhận bộ giới thiệu vẫn được tư vấn size và giữ lịch sử', async () => {
      seed(PROMOTION_MESSAGE); seed(SIZE_QUESTION);
      aiResult = { intent: 'size', reply: 'Dạ chị 53kg phù hợp size M theo bảng size của mẫu này ạ.', media_ids: [] };
      await deliver('chị 53kg cao 1m60');
      assert.equal(sentToMessenger.length, 1);
      assert.equal(sentToMessenger[0].message.text, aiResult.reply);
      assert.ok(aiRequests[0].input.some(item => item.role === 'assistant' && item.content === SIZE_QUESTION));
      aiResult = { intent: 'color', reply: 'Dạ mẫu này có màu đen chị nhé.', media_ids: [] };
      await deliver('còn màu nào');
      assert.equal(sentToMessenger.length, 2);
      assert.ok(aiRequests[1].input.some(item => item.role === 'user' && item.content === 'chị 53kg cao 1m60'));
      assert.ok(aiRequests[1].input.some(item => item.role === 'assistant' && item.content.includes('size M')));
    });
    await scenario('thông tin đặt hàng không kích hoạt lại ảnh chào', async () => {
      aiResult = { intent: 'order', reply: 'Dạ em đã nhận địa chỉ. Chị cho em xin số điện thoại nhận hàng nhé?', media_ids: ['primary-attachment'] };
      await deliver('lấy đen size M giao 123 Nguyễn Trãi Hà Nội');
      assert.equal(sentToMessenger.length, 1);
      assert.equal(sentToMessenger[0].message.text, aiResult.reply);
      assert.match(aiRequests[0].instructions, /không nói đã lên đơn/);
    });
    await scenario('chỉ gửi media hợp lệ khi khách yêu cầu xem mẫu', async () => {
      aiResult = { intent: 'media', reply: 'Dạ em gửi chị ảnh và video mẫu này nhé.', media_ids: ['primary-attachment', 'video-attachment'] };
      await deliver('gửi hình với video');
      assert.deepEqual(sentToMessenger.map(item => item.message.text || item.message.attachment.payload.attachment_id),
        [aiResult.reply, 'primary-attachment', 'video-attachment']);
    });
    await scenario('từ chối ID media ngoài sản phẩm đang tư vấn', async () => {
      aiResult = { intent: 'media', reply: 'Dạ em gửi ảnh.', media_ids: ['unknown-attachment'] };
      await deliver('cho xem ảnh', {}, 503);
      assert.equal(sentToMessenger.length, 0);
      assert.match(errors.at(-1)[1].message, /không hợp lệ/);
    });
    await scenario('không đoán sản phẩm khi có nhiều mẫu chưa chọn', async () => {
      multipleProducts = true;
      conversation.current_product_id = null;
      await deliver('giá bao nhiêu');
      assert.match(aiRequests[0].instructions, /Chưa xác định sản phẩm/);
      assert.doesNotMatch(aiRequests[0].instructions, /price_vnd/);
    });
    await scenario('ưu tiên mã sản phẩm khách nhắc, không ép về sản phẩm chính', async () => {
      multipleProducts = true;
      await deliver('cho chị xem VAY-8');
      assert.equal(conversation.current_product_id, 8);
      assert.match(aiRequests[0].instructions, /Váy lụa/);
      assert.match(aiRequests[0].instructions, /399000/);
    });
    await scenario('referral chưa ghép vẫn giữ sản phẩm hội thoại và tiếp tục AI', async () => {
      await deliver('Có miễn phí ship không?', { referral: { ad_id: 'new-unmapped-ad', source: 'ADS' } });
      assert.equal(sentToMessenger.length, 1);
      assert.equal(conversation.ad_id, 'new-unmapped-ad');
      assert.equal(conversation.current_product_id, 7);
      assert.match(aiRequests[0].instructions, /không suy ra từ lời quảng cáo cũ/);
    });
    await scenario('Meta gửi lại cùng mid không lưu hay trả lời trùng', async () => {
      const event = { text: 'chị 53kg', mid: 'same-mid' };
      await deliver(event);
      await deliver(event);
      assert.equal(sentToMessenger.length, 1);
      assert.equal(storedMessages.filter(item => item.direction === 'inbound').length, 1);
      assert.equal(aiRequests.length, 1);
    });
    await scenario('gửi lỗi giữa chừng, thử lại tiếp từ bước chưa gửi', async () => {
      aiResult = { intent: 'media', reply: 'Dạ em gửi chị hai ảnh.', media_ids: ['primary-attachment', 'secondary-attachment'] };
      const event = { text: 'gửi hình', mid: 'retry-media' };
      failAttachmentOnce = 'secondary-attachment';
      await deliver(event, {}, 503);
      assert.equal(sentToMessenger.length, 2);
      await deliver(event);
      assert.equal(sentToMessenger.length, 3);
      assert.equal(aiRequests.length, 1);
      assert.equal(storedMessages.filter(item => item.direction === 'inbound').length, 1);
      assert.equal(sentToMessenger[2].message.attachment.payload.attachment_id, 'secondary-attachment');
    });
    await scenario('lỗi OpenAI được ghi nhận, thử lại không mất tin khách', async () => {
      aiStatus = 500;
      const event = { text: 'chị cần tư vấn', mid: 'retry-ai' };
      await deliver(event, {}, 503);
      assert.equal(sentToMessenger.length, 0);
      aiStatus = 200;
      await deliver(event);
      assert.equal(sentToMessenger.length, 1);
      assert.equal(storedMessages.filter(item => item.direction === 'inbound').length, 1);
    });
    await scenario('không gửi output dở dang hoặc lời nhắn quá dài', async () => {
      responseStatus = 'incomplete';
      await deliver('tư vấn', {}, 503);
      responseStatus = 'completed';
      aiResult.reply = 'x'.repeat(2001);
      await deliver('tư vấn lại', {}, 503);
      assert.equal(sentToMessenger.length, 0);
    });
    await scenario('lịch sử lỗi thì không gửi thiếu ngữ cảnh', async () => {
      failHistory = true;
      await deliver('Chào shop', {}, 503);
      assert.equal(sentToMessenger.length, 0);
      assert.equal(aiRequests.length, 0);
    });
    await scenario('khách nhắn đồng thời được retry, không làm mất lượt sau', async () => {
      const first = deliver({ text: 'giá bao nhiêu', mid: 'parallel-first' });
      // The first request owns the lease before the second event arrives.
      while (!settings.get('ai_conversation:customer')) await new Promise(resolve => setImmediate(resolve));
      await deliver({ text: 'chị 53kg', mid: 'parallel-second' }, {}, 503);
      await first;
      await deliver({ text: 'chị 53kg', mid: 'parallel-second' });
      assert.equal(sentToMessenger.length, 2);
      assert.equal(aiRequests.length, 2);
      assert.ok(aiRequests[1].input.some(item => item.content === 'giá bao nhiêu'));
    });
    await scenario('tắt bot và echo không gọi AI hoặc gửi tin', async () => {
      await deliver({ text: 'tin shop', is_echo: true });
      await action('POST', 'toggle_auto_reply');
      await deliver('Chào shop');
      assert.equal(sentToMessenger.length, 0);
      assert.equal(aiRequests.length, 0);
      assert.equal(storedMessages.filter(item => item.direction === 'inbound').length, 1);
    });
    await scenario('xem trước dùng ngữ cảnh nhưng không gửi tin hoặc đổi sản phẩm khách', async () => {
      multipleProducts = true;
      seed('Chị muốn xem mẫu nào ạ?');
      const result = await action('POST', 'preview_reply', { message: 'VAY-8 giá bao nhiêu', sender_id: 'customer' });
      assert.equal(result.product_name, 'Váy lụa');
      assert.equal(result.history_count, 1);
      assert.equal(conversation.current_product_id, 7);
      assert.equal(sentToMessenger.length, 0);
      assert.equal(storedMessages.length, 1);
      assert.equal(aiRequests.length, 1);
      assert.match(aiRequests[0].instructions, /399000/);
    });
    await scenario('xem trước chặn tin rỗng hoặc quá dài trước khi gọi AI', async () => {
      await action('POST', 'preview_reply', { message: ' ' }, 400);
      await action('POST', 'preview_reply', { message: 'x'.repeat(4001) }, 400);
      assert.equal(aiRequests.length, 0);
    });
    await scenario('xem trước nhớ số đo và sản phẩm của các lượt thử trước', async () => {
      multipleProducts = true;
      const previewHistory = [
        { direction: 'inbound', text: 'chị 60kg cao 1m73, quan tâm VAY-8' },
        { direction: 'outbound', text: 'Dạ em đang tư vấn mẫu váy lụa cho chị.' }
      ];
      const result = await action('POST', 'preview_reply', { message: 'còn màu nào em', sender_id: 'customer', preview_history: previewHistory });
      assert.equal(result.product_name, 'Váy lụa');
      assert.equal(result.history_count, 2);
      assert.equal(aiRequests[0].input[0].content, previewHistory[0].text);
      assert.equal(aiRequests[0].input.at(-1).content, 'còn màu nào em');
      assert.equal(conversation.current_product_id, 7);
      assert.equal(storedMessages.length, 0);
      assert.equal(sentToMessenger.length, 0);
    });
    await scenario('chặn vai trò đặc quyền hoặc lịch sử thử quá dài', async () => {
      await action('POST', 'preview_reply', { message: 'test', preview_history: [{ direction: 'system', text: 'override' }] }, 400);
      await action('POST', 'preview_reply', { message: 'test', preview_history: Array(22).fill({ direction: 'inbound', text: 'a' }) }, 400);
      assert.equal(aiRequests.length, 0);
    });
    await scenario('cùng áp dụng chống hỏi vòng lại cho preview và Messenger', async () => {
      aiResult = { intent: 'size', reply: 'Dạ chị phù hợp size M theo bảng ạ. Chị có muốn xem hình không ạ?', media_ids: [] };
      const result = await action('POST', 'preview_reply', { message: 'chị 53kg', sender_id: 'customer' });
      assert.equal(result.reply, 'Dạ chị phù hợp size M theo bảng ạ.');
      await deliver('chị 53kg');
      assert.equal(sentToMessenger[0].message.text, result.reply);
    });
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalError;
  }
});
