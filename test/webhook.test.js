import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { PROMOTION_MESSAGE, SIZE_QUESTION, getPromotionMessage } from '../server/product-introduction.js';

test('bot chỉ giới thiệu một lần theo khách + sản phẩm của Ads mới nhất', async (t) => {
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
  let failHandoffOnce = false;
  let failAdUpdateOnce = false;
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
        if (failHandoffOnce && row.key.startsWith('product_intro:') && row.value.status === 'human_handoff') { failHandoffOnce = false; return json({message:'handoff unavailable'},500); }
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
      if (method === 'PATCH') {
        const patch=JSON.parse(init.body);
        if(failAdUpdateOnce && patch.ad_id) {failAdUpdateOnce=false;return json({message:'ad update unavailable'},500);}
        conversation = { ...conversation, ...patch };
      }
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
        return json(storedMessages.filter((message) => message.sender_id === url.searchParams.get('sender_id')?.slice(3) && message.direction === 'outbound')
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
  const action = async (method, name, body = {}, expectedStatus = 200, headers = {}) => {
    const res = {
      status(code) { this.statusCode = code; return this; },
      setHeader() {},
      json(body) { this.body = body; return this; }
    };
    await handler({ method, query: { action: name }, body, headers }, res);
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
    conversation = { id: 11, channel: 'facebook', external_user_id: 'customer', ad_id: 'default-ad', current_product_id: 7 };
    failHistory = false;
    multipleProducts = false;
    extraProducts = []; adMappings.clear(); adMappings.set('default-ad',7);
    failTextOnce = false;
    aiStatus = 200;
    responseStatus = 'completed';
    aiResult = { intent: 'other', reply: 'Dạ chị cần em tư vấn gì thêm ạ?', media_ids: [] };
    failAttachmentOnce = null; failHandoffOnce = false; failAdUpdateOnce = false;
    process.env.ORDERS_ADMIN_TOKEN = "test-admin-token-at-least-24-characters";
    process.env.MESSENGER_MODE = 'contextual_ai';
    process.env.AUTO_ORDERS_ENABLED = 'false';
    process.env.FB_APP_SECRET = 'test-fb-app-secret';
    checkoutRow = null; orders.length = 0; orderEvents.clear(); failOrderCommit = false; failCheckpointAfterOrder = false;
    settings.set('auto_reply_enabled', { key: 'auto_reply_enabled', value: { enabled: true } });
    await run();
  });
  const messageValues = () => sentToMessenger.map(item => item.message.text || item.message.attachment.payload.attachment_id);
  const introductionValues = p => [
    ...p.images.filter(item => item.media_type !== 'video').sort((a,b) => Number(Boolean(b.is_primary))-Number(Boolean(a.is_primary)) || (a.sort_order || 0)-(b.sort_order || 0)).map(item => item.facebook_attachment_id).slice(0,4),
    ...p.images.filter(item => item.media_type === 'video').sort((a,b) => (a.sort_order || 0)-(b.sort_order || 0)).slice(0,1).map(item => item.facebook_attachment_id),
    getPromotionMessage(p), SIZE_QUESTION
  ];
  const adProduct = { ...product, id: 13, sku: 'VAY-13', name: 'Váy hồng tím', price: 450000, sale_price: 279000, shipping_policy: 'Freeship',
    images: [1,2,3,4].map(id => ({facebook_attachment_id:`new-image-${id}`,sort_order:id})) };
  try {
    await scenario('chỉ gửi ảnh, video nếu có, giá và xin số đo; không gọi AI hay tự tạo đơn', async () => {
      process.env.MESSENGER_MODE = 'contextual_ai'; process.env.AUTO_ORDERS_ENABLED = 'true';
      await deliver('mẫu này giá bao nhiêu');
      assert.deepEqual(messageValues(), introductionValues(product));
      assert.equal(aiRequests.length, 0); assert.equal(orders.length, 0); assert.equal(checkoutRow, null);
      await deliver('còn màu nào'); await deliver('gửi hình lại');
      assert.deepEqual(messageValues(), introductionValues(product));
    });
    await scenario('cùng khách + sản phẩm: quick reply sau nhiều giờ hoặc Ads khác không gửi lại', async () => {
      adMappings.set('ad-A',7); adMappings.set('ad-B',7);
      await deliver('Xem mẫu',{referral:{ad_id:'ad-A'},timestamp:1000});
      assert.equal(settings.get('product_intro:customer:7').value.status,'introduced');
      storedMessages.length=0; global.messages=[]; sentToMessenger.length=0;
      await deliver('Giá bao nhiêu?',{referral:{ad_id:'ad-A'},timestamp:1000+4*3600000});
      await deliver('Gửi mẫu',{postback:{referral:{ad_id:'ad-B'}},timestamp:1000+5*3600000});
      assert.equal(sentToMessenger.length,0);
    });
    await scenario('một khách chuyển A sang B rồi quay lại A vẫn nhớ từng sản phẩm', async () => {
      extraProducts=[adProduct]; adMappings.set('ad-A',7); adMappings.set('ad-B',13);
      await deliver('Xem A',{referral:{ad_id:'ad-A'},timestamp:1000});
      await deliver('Xem B',{referral:{ad_id:'ad-B'},timestamp:2000});
      const before=sentToMessenger.length;
      await deliver('Xem A',{referral:{ad_id:'ad-A'},timestamp:3000});
      assert.equal(sentToMessenger.length,before);
      assert.equal(settings.get('product_intro:customer:7').value.status,'introduced');
      assert.equal(settings.get('product_intro:customer:13').value.status,'introduced');
    });
    await scenario('hai khách cùng sản phẩm có trạng thái riêng', async () => {
      await deliver('Xem mẫu');
      conversation={id:12,channel:'facebook',external_user_id:'customer-2',ad_id:'default-ad',current_product_id:7};
      sentToMessenger.length=0;
      await deliver('Xem mẫu',{sender:{id:'customer-2'}});
      assert.deepEqual(messageValues(),introductionValues(product));
      assert.ok(sentToMessenger.every(item=>item.recipient.id==='customer-2'));
      assert.equal(settings.get('product_intro:customer:7').value.status,'introduced');
      assert.equal(settings.get('product_intro:customer-2:7').value.status,'introduced');
    });
    await scenario('đang gửi lỗi chưa đánh dấu đã giới thiệu', async () => {
      failAttachmentOnce='secondary-attachment';
      const event={text:'Xem mẫu',mid:'receipt-progress'};
      await deliver(event,{},503);
      assert.equal(settings.get('product_intro:customer:7').value.status,'sending');
      assert.equal(settings.get('product_intro:customer:7').value.sent_count,1);
      await deliver(event);
      assert.equal(settings.get('product_intro:customer:7').value.status,'introduced');
      assert.deepEqual(messageValues(),introductionValues(product));
    });
    await scenario('chưa có Ads thì không đoán sản phẩm dù chỉ một mẫu', async () => {
      conversation.ad_id=null;
      await deliver('Xem mẫu');
      assert.equal(sentToMessenger.length,0);
      assert.equal(settings.has('product_intro:customer:7'),false);
    });
    await scenario('Human reset đúng cặp khách + mẫu, không gửi ngay; lượt sau gửi đủ bộ', async () => {
      extraProducts=[adProduct]; adMappings.set('ad-A',7); adMappings.set('ad-B',13);
      await deliver('Xem A',{referral:{ad_id:'ad-A'},timestamp:1000});
      await deliver('Xem B',{referral:{ad_id:'ad-B'},timestamp:2000});
      sentToMessenger.length=0;
      const headers={authorization:'Bearer '+process.env.ORDERS_ADMIN_TOKEN};
      await action('POST','reset_introduction',{sender_id:'customer',product_id:13},200,headers);
      assert.equal(sentToMessenger.length,0);
      assert.equal(settings.get('product_intro:customer:7').value.status,'introduced');
      assert.equal(settings.get('product_intro:customer:13').value.status,'pending');
      await deliver('Xem mẫu');
      assert.deepEqual(messageValues(),introductionValues(adProduct));
      await deliver('Xem mẫu'); assert.deepEqual(messageValues(),introductionValues(adProduct));
    });
    await scenario('reset không có mã quản trị hoặc nhầm mẫu không thay đổi trạng thái', async () => {
      await deliver('Xem mẫu');
      const before=JSON.stringify(settings.get('product_intro:customer:7').value);
      await action('POST','reset_introduction',{sender_id:'customer'},401);
      await action('POST','reset_introduction',{sender_id:'customer',product_id:13},409,{authorization:'Bearer '+process.env.ORDERS_ADMIN_TOKEN});
      assert.equal(JSON.stringify(settings.get('product_intro:customer:7').value),before);
    });
    await scenario('retry lượt cũ sau Human reset không tự gửi bộ mới', async () => {
      const event={text:'Xem mẫu',mid:'before-reset'};
      failAttachmentOnce='secondary-attachment'; await deliver(event,{},503);
      await action('POST','reset_introduction',{sender_id:'customer'},200,{authorization:'Bearer '+process.env.ORDERS_ADMIN_TOKEN});
      const before=sentToMessenger.length;
      await deliver(event); assert.equal(sentToMessenger.length,before);
      await deliver('Xem mẫu');
      assert.deepEqual(messageValues().slice(before),introductionValues(product));
    });
    await scenario('khách gửi đủ số đo và nhận hàng từ đầu: không trả lời và không tạo đơn', async () => {
      await deliver('Cao m59 nặng 70kg sdt 0842432523 địa chỉ 1166/78 quốc lộ 1a bình tân');
      assert.equal(sentToMessenger.length, 0); assert.equal(aiRequests.length, 0); assert.equal(orders.length, 0);
      assert.equal(['introduced','human_handoff'].includes(settings.get('product_intro:customer:7').value.status), true);
      assert.equal(storedMessages.filter(item => item.direction === 'inbound').length, 1);
      await deliver('cảm ơn'); await deliver('gửi mẫu cho chị');
      assert.equal(sentToMessenger.length, 0);
    });
    await scenario('chỉ có chiều cao hoặc chỉ cân nặng đã dừng bot', async () => {
      await deliver('cao m59'); await deliver('nang 53'); await deliver('sdt 0842432523');
      assert.equal(sentToMessenger.length, 0); assert.equal(aiRequests.length, 0);
    });
    await scenario('nhận số đo sau lời giới thiệu thì bàn giao, không tự tư vấn size', async () => {
      await deliver('xin giá');
      const before = sentToMessenger.length;
      await deliver('53kg cao 1m60'); await deliver('size nào'); await deliver('gửi hình');
      assert.equal(sentToMessenger.length, before);
      assert.equal(['introduced','human_handoff'].includes(settings.get('product_intro:customer:7').value.status), true);
    });
    await scenario('cân nặng chỉ ghi số sau câu hỏi số đo cũng bàn giao', async () => {
      await deliver('xin giá'); const before = sentToMessenger.length;
      await deliver('53');
      assert.equal(sentToMessenger.length, before);
      assert.equal(['introduced','human_handoff'].includes(settings.get('product_intro:customer:7').value.status), true);
    });
    await scenario('bàn giao mẫu A không chặn bộ giới thiệu mẫu B', async () => {
      await deliver('53kg');
      storedMessages.length = 0;
      for (let i=0;i<65;i++) storedMessages.push({sender_id:'customer',conversation_id:11,direction:'inbound',text:'cảm ơn'});
      global.messages = [];
      extraProducts = [adProduct]; adMappings.set('new-ad', 13);
      await deliver('gửi ảnh mới', {referral:{ad_id:'new-ad'},timestamp:2000});
      assert.equal(conversation.ad_id, 'new-ad'); assert.deepEqual(messageValues(),introductionValues(adProduct));
    });
    await scenario('không dùng số đo ở mẫu cũ để chặn sản phẩm chưa giới thiệu', async () => {
      storedMessages.push({sender_id:'customer',conversation_id:11,direction:'inbound',text:'chị 53kg'});
      await deliver('cho xem ảnh');
      assert.deepEqual(messageValues(),introductionValues(product));
      assert.equal(settings.get('product_intro:customer:7').value.status,'introduced');
    });
    await scenario('lỗi lưu bàn giao thì retry không nhắn khách và không mất tin', async () => {
      const event = {text:'53kg',mid:'retry-handoff'};
      failHandoffOnce = true;
      await deliver(event,{},503); await deliver(event); await deliver(event);
      assert.equal(sentToMessenger.length,0); assert.equal(['introduced','human_handoff'].includes(settings.get('product_intro:customer:7').value.status),true);
      assert.equal(storedMessages.filter(item => item.direction === 'inbound').length,1);
    });
    await scenario('retry phần ảnh lỗi chỉ gửi phần còn thiếu', async () => {
      failAttachmentOnce = 'secondary-attachment';
      const event={text:'xem mẫu',mid:'retry-introduction'};
      await deliver(event,{},503); assert.deepEqual(messageValues(),['primary-attachment']);
      await deliver(event); await deliver(event);
      assert.deepEqual(messageValues(), introductionValues(product)); assert.equal(aiRequests.length,0);
      assert.equal(storedMessages.filter(item => item.direction === 'inbound').length,1);
    });
    await scenario('retry báo giá lỗi không gửi lại ảnh', async () => {
      failTextOnce = true; const event={text:'xem mẫu',mid:'retry-price'};
      await deliver(event,{},503); assert.equal(sentToMessenger.length,4);
      await deliver(event); await deliver(event);
      assert.deepEqual(messageValues(),introductionValues(product));
    });
    await scenario('video gửi lỗi thì retry tiếp video, không gửi lại ảnh', async () => {
      failAttachmentOnce='video-attachment';
      const event={text:'xin giá',mid:'retry-video'};
      await deliver(event,{},503);
      assert.deepEqual(messageValues(),introductionValues(product).slice(0,3));
      await deliver(event); await deliver(event);
      assert.deepEqual(messageValues(),introductionValues(product));
    });
    await scenario('khách đã giới thiệu từ bản không video thì không gửi bổ sung video', async () => {
      seed('[Ảnh sản phẩm 7:primary-attachment]'); seed(getPromotionMessage(product)); seed(SIZE_QUESTION);
      await deliver('xin giá'); await deliver('gửi mẫu');
      assert.equal(sentToMessenger.length,0);
    });
    await scenario('mẫu mới lỗi ở giá vẫn xin số đo sau retry dù mẫu cũ đã xin trước đó', async () => {
      extraProducts=[adProduct]; adMappings.set('new-ad',13);
      seed(getPromotionMessage(product)); seed(SIZE_QUESTION);
      failTextOnce=true; const event={text:'xem mẫu',mid:'new-product-price-failure'};
      const referral={referral:{ad_id:'new-ad'},timestamp:2000};
      await deliver(event,referral,503); await deliver(event,referral);
      assert.deepEqual(messageValues(),introductionValues(adProduct));
    });
    await scenario('Ads mới nhất quyết định sản phẩm kể cả tin nhắc mẫu cũ', async () => {
      extraProducts=[adProduct]; adMappings.set('new-ad',13);
      await deliver({text:'cho xem VAY-7',referral:{ad_id:'new-ad'}},{timestamp:2000});
      assert.equal(conversation.ad_id,'new-ad'); assert.equal(conversation.current_product_id,13);
      assert.deepEqual(messageValues(),introductionValues(adProduct));
      await deliver('VAY-7'); assert.deepEqual(messageValues(),introductionValues(adProduct));
    });
    await scenario('đổi Ads sang mẫu khác gửi đúng hình và giá mới', async () => {
      extraProducts=[adProduct]; adMappings.set('old-ad',7); adMappings.set('new-ad',13);
      await deliver('xem mẫu',{referral:{ad_id:'old-ad'},timestamp:1000});
      sentToMessenger.length=0;
      await deliver('xem mẫu',{postback:{referral:{ad_id:'new-ad'}},timestamp:2000});
      assert.deepEqual(messageValues(),introductionValues(adProduct));
    });
    await scenario('Ads cũ đến muộn không thay Ads mới nhất', async () => {
      extraProducts=[adProduct]; adMappings.set('old-ad',7); adMappings.set('new-ad',13);
      await deliver('xem mẫu',{referral:{ad_id:'new-ad'},timestamp:2000}); sentToMessenger.length=0;
      await deliver('xem mẫu',{referral:{ad_id:'old-ad'},timestamp:1000});
      assert.equal(conversation.ad_id,'new-ad'); assert.equal(conversation.current_product_id,13);
      assert.equal(sentToMessenger.length,0);
    });
    await scenario('lỗi ghi Ads giữa chừng: tin tiếp theo phục hồi Ads mới thay vì tư vấn mẫu cũ', async () => {
      extraProducts=[adProduct]; adMappings.set('old-ad',7); adMappings.set('new-ad',13);
      conversation.ad_id='old-ad'; failAdUpdateOnce=true;
      await deliver('xem mẫu',{referral:{ad_id:'new-ad'},timestamp:2000},503);
      assert.equal(sentToMessenger.length,0);
      await deliver('xin giá');
      assert.equal(conversation.ad_id,'new-ad'); assert.deepEqual(messageValues(),introductionValues(adProduct));
      await deliver('xem mẫu',{referral:{ad_id:'old-ad'},timestamp:1000});
      assert.equal(conversation.ad_id,'new-ad'); assert.deepEqual(messageValues(),introductionValues(adProduct));
    });
    await scenario('Ads mới chưa gắn mẫu không dùng sản phẩm cũ dù chỉ còn một mẫu', async () => {
      await deliver('xem mẫu',{referral:{ad_id:'unmapped-ad'},timestamp:2000});
      assert.equal(conversation.ad_id,'unmapped-ad'); assert.equal(conversation.current_product_id,null);
      assert.equal(sentToMessenger.length,0); assert.equal(aiRequests.length,0);
      adMappings.set('unmapped-ad',7);
      await deliver('xin giá'); assert.deepEqual(messageValues(),introductionValues(product));
    });
    await scenario('referral riêng không có tin được lưu; referral cũ không ghi đè', async () => {
      extraProducts=[adProduct]; adMappings.set('old-ad',7); adMappings.set('new-ad',13);
      await deliver({}, {message:undefined, referral:{ad_id:'new-ad'},timestamp:2000});
      assert.equal(conversation.ad_id,'new-ad'); assert.equal(sentToMessenger.length,0);
      await deliver({}, {message:undefined, referral:{ad_id:'old-ad'},timestamp:1000});
      assert.equal(conversation.ad_id,'new-ad');
      await deliver('xin giá'); assert.deepEqual(messageValues(),introductionValues(adProduct));
    });
    await scenario('hai referral riêng cùng timestamp vẫn phân biệt Ads ID', async () => {
      extraProducts=[adProduct]; adMappings.set('old-ad',7); adMappings.set('new-ad',13);
      await deliver({}, {message:undefined,referral:{ad_id:'old-ad'},timestamp:2000});
      await deliver({}, {message:undefined,referral:{ad_id:'new-ad'},timestamp:2000});
      assert.equal(conversation.ad_id,'new-ad');
      await deliver('xin giá'); assert.deepEqual(messageValues(),introductionValues(adProduct));
    });
    await scenario('không đoán mẫu khi nhiều sản phẩm và chưa có Ads', async () => {
      multipleProducts=true; conversation.current_product_id=null; conversation.ad_id=null;
      await deliver('xin giá'); assert.equal(sentToMessenger.length,0); assert.equal(aiRequests.length,0);
    });
    await scenario('Meta gửi trùng mid không lặp lời giới thiệu', async () => {
      const event={text:'xin giá',mid:'same-mid'};
      await deliver(event); await deliver(event);
      assert.deepEqual(messageValues(),introductionValues(product));
      assert.equal(storedMessages.filter(item => item.direction==='inbound').length,1);
    });
    await scenario('lịch sử lỗi thì không gửi thiếu ngữ cảnh', async () => {
      failHistory=true; await deliver('xin giá',{},503);
      assert.equal(sentToMessenger.length,0); assert.equal(aiRequests.length,0);
    });
    await scenario('tin đến đồng thời được retry rồi bàn giao khi khách gửi số đo', async () => {
      const first=deliver({text:'xin giá',mid:'parallel-first'});
      while (!settings.get('ai_conversation:customer')) await new Promise(resolve=>setImmediate(resolve));
      await deliver({text:'53kg',mid:'parallel-second'},{},503);
      await first; const before=sentToMessenger.length;
      await deliver({text:'53kg',mid:'parallel-second'});
      assert.equal(sentToMessenger.length,before); assert.equal(['introduced','human_handoff'].includes(settings.get('product_intro:customer:7').value.status),true);
    });
    await scenario('tắt bot vẫn lưu tin và bàn giao; không âm thầm bắt đơn', async () => {
      process.env.AUTO_ORDERS_ENABLED='true'; await action('POST','toggle_auto_reply');
      await deliver('chốt size M'); await deliver('53kg');
      assert.equal(sentToMessenger.length,0); assert.equal(aiRequests.length,0); assert.equal(orders.length,0);
      assert.equal(storedMessages.filter(item=>item.direction==='inbound').length,2);
      await action('POST','toggle_auto_reply'); await deliver('gửi ảnh');
      assert.equal(sentToMessenger.length,0);
    });
    await scenario('echo không kích hoạt bàn giao hoặc gửi tin', async () => {
      await deliver({text:'chị 53kg',is_echo:true});
      assert.equal(sentToMessenger.length,0); assert.equal(settings.has('product_intro:customer:7'),false);
      assert.equal(storedMessages.length,0);
    });
    await scenario('preview cùng kịch bản nhưng không gửi tin, lưu bàn giao hay sửa sản phẩm', async () => {
      extraProducts=[adProduct]; adMappings.set('new-ad',13); conversation.ad_id='new-ad';
      const result=await action('POST','preview_reply',{message:'xin giá',sender_id:'customer'});
      assert.equal(result.product_name,adProduct.name); assert.equal(result.intent,'product_introduction');
      assert.deepEqual(result.media_ids,adProduct.images.map(item=>item.facebook_attachment_id));
      assert.deepEqual(result.messages,[getPromotionMessage(adProduct),SIZE_QUESTION]);
      assert.equal(conversation.current_product_id,7); assert.equal(sentToMessenger.length,0); assert.equal(aiRequests.length,0);
      const handoff=await action('POST','preview_reply',{message:'53kg',sender_id:'customer'});
      assert.equal(handoff.intent,'human_handoff'); assert.equal(handoff.skipped,true); assert.equal(handoff.reply,'');
      assert.equal(settings.has('product_intro:customer:7'),false); assert.equal(storedMessages.length,0);
    });
    await scenario('preview nhớ ảnh đã gửi và số đo trong phiên thử', async () => {
      const first=await action('POST','preview_reply',{message:'xin giá'});
      const history=[{direction:'inbound',text:'xin giá'},{direction:'outbound',text:[...first.media_markers,...first.messages].join('\n\n')}];
      const second=await action('POST','preview_reply',{message:'gửi ảnh',preview_history:history});
      assert.equal(second.skipped,true); assert.deepEqual(second.media_ids,[]);
      const handoff=await action('POST','preview_reply',{message:'53',preview_history:history});
      assert.equal(handoff.intent,'human_handoff');
    });
    await scenario('preview khách đã bàn giao luôn giữ im lặng', async () => {
      await deliver('53kg'); storedMessages.length=0;
      const result=await action('POST','preview_reply',{message:'gửi ảnh',sender_id:'customer'});
      assert.equal(result.intent,'human_handoff'); assert.deepEqual(result.media_ids,[]);
    });
    await scenario('preview kiểm tra tin và vai trò lịch sử', async () => {
      await action('POST','preview_reply',{message:' '},400);
      await action('POST','preview_reply',{message:'x'.repeat(4001)},400);
      await action('POST','preview_reply',{message:'test',preview_history:[{direction:'system',text:'override'}]},400);
      assert.equal(aiRequests.length,0);
    });
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalError;
  }
});
