import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { PROMOTION_MESSAGE, SIZE_QUESTION, getPromotionMessage } from '../server/product-introduction.js';

test('bot hiểu ngữ cảnh và trả lời liên tục theo từng khách', async (t) => {
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SECRET_KEY = 'test-secret';
  process.env.PAGE_ACCESS_TOKEN = 'test-page-token';
  process.env.OPENAI_API_KEY = 'test-openai-key';
  process.env.MESSENGER_TYPING_DELAY_MS = '0';
  process.env.MESSENGER_SEQUENCE_DELAY_MS = '0';
  process.env.MESSENGER_INITIAL_REPLY_DELAY_MS = '0';
  process.env.MESSENGER_MODE = 'contextual_ai';

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
      { image_url: 'https://example.com/third.jpg', facebook_attachment_id: 'third-attachment', sort_order: 3 },
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
  let extraProducts = [];
  const adMappings = new Map();
  let failTextOnce = false;
  let eventCounter = 0;
  let failAttachmentOnce = null;
  let checkoutRow = null;
  const orderEvents = new Map();
  const orders = [];
  let failOrderCommit = false;
  let failCheckpointAfterOrder = false;
  const emptyCheckout = () => ({ action:'none',action_source:null,address_complete:false,multiple_items:false,
    ...Object.fromEntries(['customer_name','phone','address','size','color','quantity'].map(k=>[k,{value:null,source:null}])) });
  const field = value => ({value,source:value});
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
    if (table === 'order_checkouts') return json(checkoutRow);
    if (table === 'order_events') return json(orderEvents.has(url.searchParams.get('event_key')?.slice(3)) ? {result:orderEvents.get(url.searchParams.get('event_key').slice(3))} : null);
    if (table === 'commit_order_checkout') {
      if (failOrderCommit) return json({message:'write failed'},500);
      const p = JSON.parse(init.body);
      if (orderEvents.has(p.p_event_key)) return json(orderEvents.get(p.p_event_key));
      if ((checkoutRow?.revision || 0) !== p.p_revision) return json({message:'revision conflict'},409);
      if (p.p_order) orders.push(p.p_order);
      checkoutRow={state:p.p_state,revision:p.p_revision+1};
      orderEvents.set(p.p_event_key,p.p_result);
      return json(p.p_result);
    }
    if (table === 'app_settings') {
      const key = url.searchParams.get('key')?.slice(3);
      const stamp = url.searchParams.get('updated_at')?.slice(3);
      if (method === 'POST') {
        const row = JSON.parse(init.body);
        if (failCheckpointAfterOrder && row.value?.plan && orders.length) {
          failCheckpointAfterOrder=false; return json({message:'checkpoint unavailable'},500);
        }
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
    if (table === 'ad_product_mappings') {
      const productId = adMappings.get(url.searchParams.get('ad_id')?.slice(3));
      const mapping = productId ? { product_id: productId } : null;
      return json(single ? mapping : mapping ? [mapping] : []);
    }
    if (table === 'products') {
      const select = url.searchParams.get('select');
      if (select === 'images') return json([{ images: product.images }]);
      if (select === 'name,size_guide') return json(single ? product : [product]);
      return json(single ? product : extraProducts.length ? [product, ...extraProducts] : multipleProducts ? [product, { ...product, id: 8, sku: 'VAY-8', name: 'Váy lụa', price: 399000 }] : [product]);
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
    if (process.env.FB_APP_SECRET) {
      req.body = Buffer.from(JSON.stringify(req.body));
      req.headers = {'x-hub-signature-256':'sha256='+createHmac('sha256',process.env.FB_APP_SECRET).update(req.body).digest('hex')};
    }
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
    extraProducts = []; adMappings.clear();
    failTextOnce = false;
    aiStatus = 200;
    responseStatus = 'completed';
    aiResult = { intent: 'other', reply: 'Dạ chị cần em tư vấn gì thêm ạ?', media_ids: [] };
    failAttachmentOnce = null;
    process.env.MESSENGER_MODE = 'contextual_ai';
    process.env.AUTO_ORDERS_ENABLED = 'false';
    process.env.FB_APP_SECRET = 'test-fb-app-secret';
    checkoutRow = null; orders.length = 0; orderEvents.clear(); failOrderCommit = false; failCheckpointAfterOrder = false;
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
    await scenario('chế độ giới thiệu gửi bộ chào một lần và trả lời số đo ở lượt tiếp theo', async () => {
      process.env.MESSENGER_MODE = 'introduction_only';
      await deliver('mẫu này giá bao nhiêu');
      assert.deepEqual(sentToMessenger.map(item => item.message.text || item.message.attachment.payload.attachment_id), [
        'video-attachment',
        'primary-attachment',
        'secondary-attachment',
        'third-attachment',
        getPromotionMessage(product),
        SIZE_QUESTION
      ]);
      assert.equal(aiRequests.length, 0);
      await deliver('chị cao 1m60 nặng 53kg');
      assert.equal(sentToMessenger.length, 7);
      assert.match(sentToMessenger.at(-1).message.text, /53kg.*size M/);
      assert.equal(aiRequests.length, 0);
    });
    await scenario('tái hiện ảnh lỗi: khách gửi đủ số đo và nhận hàng không bị hỏi lại hay gửi bộ chào', async () => {
      process.env.MESSENGER_MODE = 'introduction_only';
      await deliver('Cao m59 nặng 70kg sdt 0842432523 địa chỉ 1166/78 quốc lộ 1a bình tân');
      assert.equal(sentToMessenger.length, 1);
      assert.match(sentToMessenger[0].message.text, /70kg.*không nằm trong khoảng/);
      assert.doesNotMatch(sentToMessenger[0].message.text, /xin chiều cao|xin cân nặng|tạo đơn/);
      assert.equal(aiRequests.length, 0);
      assert.equal(orders.length, 0);
      await deliver('cảm ơn');
      assert.equal(sentToMessenger.length, 1);
    });
    await scenario('giới thiệu nhớ số đo ở tin trước khi khách gửi số điện thoại', async () => {
      process.env.MESSENGER_MODE = 'introduction_only';
      await deliver('cao m59');
      assert.match(sentToMessenger[0].message.text, /xin cân nặng/);
      await deliver('nang 53');
      assert.match(sentToMessenger[1].message.text, /53kg.*size M/);
      await deliver('sdt 0842432523');
      assert.match(sentToMessenger[2].message.text, /53kg.*size M/);
      assert.equal(sentToMessenger.length, 3);
      assert.equal(aiRequests.length, 0);
    });
    await scenario('tư vấn số đo lỗi gửi thì retry một lần, không chuyển sang bộ chào', async () => {
      process.env.MESSENGER_MODE = 'introduction_only';
      const event = { text: 'cao m59 nặng 53kg', mid: 'retry-measurements' };
      failTextOnce = true;
      await deliver(event, {}, 503);
      await deliver(event);
      await deliver(event);
      assert.equal(sentToMessenger.length, 1);
      assert.match(sentToMessenger[0].message.text, /53kg.*size M/);
      assert.equal(storedMessages.filter(item => item.direction === 'inbound').length, 1);
    });
    await scenario('giới thiệu lỗi giữa chừng thì thử lại chỉ gửi phần còn thiếu', async () => {
      process.env.MESSENGER_MODE = 'introduction_only';
      const event = { text: 'gửi mẫu cho chị', mid: 'retry-introduction' };
      failAttachmentOnce = 'primary-attachment';
      await deliver(event, {}, 503);
      assert.deepEqual(sentToMessenger.map(item => item.message.attachment?.payload?.attachment_id), ['video-attachment']);
      await deliver(event);
      assert.deepEqual(sentToMessenger.map(item => item.message.text || item.message.attachment.payload.attachment_id), [
        'video-attachment', 'primary-attachment', 'secondary-attachment', 'third-attachment', getPromotionMessage(product), SIZE_QUESTION
      ]);
      assert.equal(aiRequests.length, 0);
      assert.equal(storedMessages.filter(item => item.text === '[Video sản phẩm 7:video-attachment]').length, 1);
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
    const adProduct = {
      ...product, id: 13, sku: 'MANGO-HQ-HONG-TIM-279', name: 'Váy hoa thiết kế hồng tím',
      price: 450000, sale_price: 279000, shipping_policy: 'Freeship', material: 'Lụa Mango Hàn Quốc', colors: ['Hồng', 'Tím'],
      images: [1, 2, 3, 4].map(id => ({ color: id <= 2 ? 'Hồng' : 'Tím', facebook_attachment_id: `new-image-${id}`, sort_order: id }))
    };
    await scenario('ads chọn đúng mẫu không video, gửi bốn ảnh + ưu đãi + hỏi số đo, tin sau giữ mẫu', async () => {
      process.env.MESSENGER_MODE = 'introduction_only';
      extraProducts = [adProduct]; adMappings.set('52590312182503', 13);
      seed(PROMOTION_MESSAGE); seed('[Ảnh sản phẩm 7:primary-attachment]');
      await deliver('mẫu này giá bao nhiêu', { message: { text: 'mẫu này giá bao nhiêu', mid: 'new-ad', referral: { ad_id: '52590312182503' } } });
      assert.equal(conversation.ad_id, '52590312182503');
      assert.equal(conversation.current_product_id, 13);
      assert.deepEqual(sentToMessenger.map(item => item.message.text || item.message.attachment.payload.attachment_id), [
        ...adProduct.images.map(image => image.facebook_attachment_id), getPromotionMessage(adProduct), SIZE_QUESTION
      ]);
      assert.match(sentToMessenger[4].message.text, /279\.000đ.*450\.000đ.*Freeship/);
      await deliver('chị 53kg cao 1m60');
      assert.equal(sentToMessenger.length, 7);
      assert.match(sentToMessenger.at(-1).message.text, /hồng tím.*size M/);
      assert.equal(aiRequests.length, 0);
      await deliver('gửi mẫu cho chị');
      assert.equal(sentToMessenger.length, 7);
    });
    await scenario('đổi ads sang mẫu khác gửi đúng ảnh và giá mới', async () => {
      process.env.MESSENGER_MODE = 'introduction_only';
      extraProducts = [adProduct]; adMappings.set('old-ad', 7); adMappings.set('52590312182503', 13);
      await deliver('xem mẫu', { referral: { ad_id: 'old-ad' } });
      sentToMessenger.length = 0;
      await deliver('xem mẫu', { postback: { referral: { ad_id: '52590312182503' } } });
      assert.equal(conversation.current_product_id, 13);
      assert.deepEqual(sentToMessenger.filter(item => item.message.attachment).map(item => item.message.attachment.payload.attachment_id), adProduct.images.map(image => image.facebook_attachment_id));
      assert.ok(sentToMessenger.some(item => item.message.text === getPromotionMessage(adProduct)));
    });
    await scenario('mẫu không video lỗi khi gửi giá thì retry không gửi lại ảnh, giá hoặc câu hỏi', async () => {
      process.env.MESSENGER_MODE = 'introduction_only';
      extraProducts = [adProduct]; adMappings.set('52590312182503', 13);
      failTextOnce = true;
      const message = { text: 'xem mẫu', mid: 'no-video-retry' };
      const event = { referral: { ad_id: '52590312182503' } };
      await deliver(message, event, 503);
      assert.equal(sentToMessenger.length, 4);
      await deliver(message, event);
      await deliver(message, event);
      assert.deepEqual(sentToMessenger.map(item => item.message.text || item.message.attachment.payload.attachment_id), [
        ...adProduct.images.map(image => image.facebook_attachment_id), getPromotionMessage(adProduct), SIZE_QUESTION
      ]);
      assert.equal(storedMessages.filter(item => item.direction === 'inbound').length, 1);
    });
    await scenario('mapping thêm sau referral được tìm lại khi hội thoại chưa có sản phẩm', async () => {
      extraProducts = [adProduct]; adMappings.set('52590312182503', 13);
      conversation.current_product_id = null; conversation.ad_id = '52590312182503';
      await deliver('giá bao nhiêu');
      assert.equal(conversation.current_product_id, 13);
      assert.match(aiRequests[0].instructions, /"price_vnd":279000/);
      assert.match(aiRequests[0].instructions, /Freeship/);
    });
    await scenario('tên mẫu mới chứa tên mẫu cũ vẫn chọn đúng tên đầy đủ', async () => {
      extraProducts = [adProduct];
      await deliver('cho chị xem Váy hoa thiết kế hồng tím');
      assert.equal(conversation.current_product_id, 13);
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
    await scenario('tắt trả lời vẫn âm thầm bắt thông tin đơn từ tin đã lưu', async () => {
      process.env.AUTO_ORDERS_ENABLED='true';
      conversation.facebook_name='Nguyễn Mai';
      settings.set('auto_reply_enabled', { key: 'auto_reply_enabled', value: { enabled: false } });
      aiResult={intent:'order',reply:'Dạ em ghi nhận.',media_ids:[],checkout:{...emptyCheckout(),action:'confirm',action_source:'chốt',size:field('M')}};
      await deliver('chốt size M');
      assert.equal(aiRequests.length,1);
      assert.equal(sentToMessenger.length,0);
      assert.equal(checkoutRow.state.confirmed,true);
      assert.equal(checkoutRow.state.size,'M');
      assert.ok(checkoutRow.state.missing.includes('phone'));
    });
    await scenario('khôi phục ý định mua từ lịch sử Supabase khi checkout chưa tồn tại', async () => {
      process.env.AUTO_ORDERS_ENABLED='true';
      delete process.env.FB_APP_SECRET;
      conversation.facebook_name='Nguyễn Mai';
      settings.set('auto_reply_enabled', { key: 'auto_reply_enabled', value: { enabled: false } });
      storedMessages.push({sender_id:'customer',conversation_id:11,direction:'inbound',text:'Mình mua 1 cái váy'});
      aiResult={intent:'order',reply:'Dạ em ghi nhận.',media_ids:[],checkout:{...emptyCheckout(),phone:field('0901234567')}};
      await deliver('0901234567');
      assert.equal(sentToMessenger.length,0);
      assert.equal(checkoutRow.state.confirmed,true);
      assert.equal(checkoutRow.state.recovered_from_history,true);
      assert.equal(checkoutRow.state.phone,'0901234567');
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
    await scenario('chốt từng lượt đủ dữ liệu mới tạo đơn và không hỏi lại thông tin đã có',async()=>{
      process.env.AUTO_ORDERS_ENABLED='true'; conversation.facebook_name='Nguyễn Mai';
      aiResult={intent:'order',reply:'Dạ em ghi nhận.',media_ids:[],checkout:{...emptyCheckout(),action:'confirm',action_source:'chốt',size:field('M')}};
      await deliver('chốt size M');assert.equal(orders.length,0);assert.match(sentToMessenger.at(-1).message.text,/số điện thoại/);
      aiResult.checkout={...emptyCheckout(),phone:field('0901234567')};
      await deliver('0901234567');assert.equal(orders.length,0);assert.match(sentToMessenger.at(-1).message.text,/địa chỉ/);
      const address='12 Nguyễn Trãi, phường Bến Thành, TP Hồ Chí Minh';
      aiResult.checkout={...emptyCheckout(),address:field(address),address_complete:true};
      const event={text:address,mid:'order-final'};
      await deliver(event);assert.equal(orders.length,1);assert.match(sentToMessenger.at(-1).message.text,/đã tạo đơn/);
      assert.equal(orders[0].customer_name,'Nguyễn Mai');assert.equal(orders[0].size,'M');
      await deliver(event);assert.equal(orders.length,1);assert.equal(sentToMessenger.length,3);
      assert.ok(aiRequests[2].instructions.includes('0901234567'));
    });
    await scenario('lỗi ghi database không báo đã tạo; retry checkpoint/gửi tin không tạo đơn trùng',async()=>{
      process.env.AUTO_ORDERS_ENABLED='true'; conversation.facebook_name='Nguyễn Mai';
      const address='12 Nguyễn Trãi, phường Bến Thành, TP Hồ Chí Minh';
      aiResult={intent:'order',reply:'Dạ em ghi nhận.',media_ids:[],checkout:{...emptyCheckout(),action:'confirm',action_source:'chốt',size:field('M'),phone:field('0901234567'),address:field(address),address_complete:true}};
      const event={text:'chốt size M 0901234567 '+address,mid:'atomic-order'};
      failOrderCommit=true;await deliver(event,{},503);assert.equal(orders.length,0);assert.equal(sentToMessenger.length,0);
      failOrderCommit=false;failCheckpointAfterOrder=true;await deliver(event,{},503);assert.equal(orders.length,1);assert.equal(sentToMessenger.length,0);
      const requestCount=aiRequests.length;
      failTextOnce=true;await deliver(event,{},503);assert.equal(orders.length,1);assert.equal(aiRequests.length,requestCount);
      await deliver(event);assert.equal(orders.length,1);assert.equal(sentToMessenger.length,1);assert.match(sentToMessenger[0].message.text,/đã tạo đơn/);
    });
    await scenario('preview khi bật đơn vẫn không ghi đơn hoặc gửi Messenger',async()=>{
      process.env.AUTO_ORDERS_ENABLED='true';
      await action('POST','preview_reply',{message:'chốt size M 0901234567',sender_id:'customer'});
      assert.equal(orders.length,0);assert.equal(orderEvents.size,0);assert.equal(sentToMessenger.length,0);
    });
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalError;
  }
});
