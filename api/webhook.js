// api/webhook.js
import OpenAI from 'openai';
import { getSupabase } from './services/supabase.js';
import { getAdReferral } from './services/ad-referral.js';
import { getWeightSizeAdvice, WEIGHT_PATTERN } from './services/size-advice.js';
import {
  getOrCreateConversation,
  getOnlyActiveProduct,
  getProductContext,
  getProductImages,
  getProductSizeGuide,
  getRecentConversationMessages,
  hasSentProductIntroduction,
  saveConversationMessage,
  updateConversationAd,
  updateConversationProduct
} from './services/products.js';

const PROMOTION_MESSAGE = '🌷 Mẫu này hôm nay bên em đang ưu đãi chỉ còn 289K + freeship ạ. Sang ngày mai shop sẽ trở lại giá cũ 450K chị nha 🥰';
const MATERIAL_MESSAGE = 'Dạ mẫu này bên em là vải cotton lạnh, chất mềm mát, mặc thoải mái, co giãn nhẹ và ít nhăn chị nha. Form lên dáng đẹp, không bị bí nóng ạ.';
const SIZE_QUESTION = 'Chị cho em xin chiều cao + cân nặng, em chọn size chuẩn cho chị nhé.';

// Biến toàn cục lưu trữ tin nhắn tạm thời (sẽ mất khi Vercel restart)
if (!global.messages) {
  global.messages = [];
}
if (typeof global.autoReplyEnabled !== 'boolean') {
  global.autoReplyEnabled = true;
}
if (!global.taskLogs) {
  global.taskLogs = [];
}
if (typeof global.openaiSystemPrompt !== 'string') {
  global.openaiSystemPrompt = process.env.OPENAI_SYSTEM_PROMPT ||
    'Bạn là trợ lý chăm sóc khách hàng của Emi House - Váy Thiết Kế. Trả lời bằng tiếng Việt, lịch sự, ngắn gọn và tự nhiên.';
}

async function persistTaskLog(action, detail, createdAt) {
  const client = getSupabase();
  if (!client) return;
  const { error } = await client.from('task_logs').insert({
    action,
    detail,
    created_at: createdAt
  });
  if (error) console.error('Không thể lưu task log vào Supabase:', error.message);
}

function addTaskLog(action, detail) {
  const createdAt = new Date().toISOString();
  const entry = {
    time: new Date().toLocaleString('vi-VN', {
      timeZone: 'Asia/Ho_Chi_Minh',
      hour12: false
    }),
    action,
    detail
  };
  global.taskLogs.push(entry);
  if (global.taskLogs.length > 200) global.taskLogs.shift();
  void persistTaskLog(action, detail, createdAt);
}

async function loadSettings() {
  if (global.settingsLoaded) return;
  const client = getSupabase();
  if (!client) return;

  const { data: promptRow, error: promptError } = await client
    .from('system_prompts')
    .select('prompt')
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();
  if (promptError) {
    console.error('Không thể tải System Prompt từ Supabase:', promptError.message);
  } else if (promptRow?.prompt) {
    global.openaiSystemPrompt = promptRow.prompt;
  }
  global.settingsLoaded = true;
}

async function readAutoReplyEnabled() {
  const client = getSupabase();
  if (!client) throw new Error('Chưa cấu hình Supabase để đọc trạng thái tự động trả lời.');
  const { data, error } = await client.from('app_settings')
    .select('value')
    .eq('key', 'auto_reply_enabled')
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Không thể đọc trạng thái tự động trả lời: ${error.message}`);
  global.autoReplyEnabled = typeof data?.value?.enabled === 'boolean' ? data.value.enabled : true;
  return global.autoReplyEnabled;
}

async function saveSetting(key, value) {
  const client = getSupabase();
  if (!client) throw new Error('Chưa cấu hình Supabase để lưu trạng thái tự động trả lời.');
  const { error } = await client.from('app_settings').upsert({
    key,
    value,
    updated_at: new Date().toISOString()
  });
  if (error) throw new Error(`Không thể lưu cài đặt Supabase: ${error.message}`);
}

async function saveSystemPrompt(prompt) {
  const client = getSupabase();
  if (!client) return;

  const { data: activePrompt, error: findError } = await client
    .from('system_prompts')
    .select('id')
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();
  if (findError) throw new Error(`Không thể tìm System Prompt Supabase: ${findError.message}`);

  const query = activePrompt
    ? client.from('system_prompts').update({ prompt, updated_at: new Date().toISOString() }).eq('id', activePrompt.id)
    : client.from('system_prompts').insert({ name: 'default', prompt, is_active: true });
  const { error } = await query;
  if (error) throw new Error(`Không thể lưu System Prompt Supabase: ${error.message}`);
}

async function saveMessage(senderId, direction, text, conversationId = null) {
  const client = getSupabase();
  if (!client) return;
  const { error } = await client.from('messenger_messages').insert({
    sender_id: senderId,
    direction,
    text,
    conversation_id: conversationId
  });
  if (error) throw new Error(`Không thể lưu tin nhắn Supabase: ${error.message}`);
}

async function getStoredMessages() {
  const client = getSupabase();
  if (!client) return global.messages;
  const { data, error } = await client
    .from('messenger_messages')
    .select('sender_id, direction, text, message_time, conversation_id')
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) throw new Error(`Không thể đọc tin nhắn Supabase: ${error.message}`);
  const conversationIds = [...new Set((data || []).map((message) => message.conversation_id).filter(Boolean))];
  const adsByConversation = new Map();
  if (conversationIds.length) {
    const { data: conversations, error: adError } = await client.from('conversations')
      .select('id, ad_id').in('id', conversationIds);
    if (adError) throw new Error(`Không thể đọc Ads ID: ${adError.message}`);
    for (const conversation of conversations || []) adsByConversation.set(conversation.id, conversation.ad_id);
  }
  return (data || []).reverse().map((message) => ({
    senderId: message.sender_id,
    adId: adsByConversation.get(message.conversation_id) || null,
    direction: message.direction,
    text: message.text,
    time: new Date(message.message_time).toLocaleTimeString('vi-VN', {
      timeZone: 'Asia/Ho_Chi_Minh',
      hour12: false
    })
  }));
}

async function getStoredTaskLogs() {
  const client = getSupabase();
  if (!client) return global.taskLogs;
  const { data, error } = await client
    .from('task_logs')
    .select('action, detail, created_at')
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) throw new Error(`Không thể đọc task log Supabase: ${error.message}`);
  return (data || []).reverse().map((log) => ({
    time: new Date(log.created_at).toLocaleString('vi-VN', {
      timeZone: 'Asia/Ho_Chi_Minh',
      hour12: false
    }),
    action: log.action,
    detail: log.detail
  }));
}

let openai;

const CUSTOMER_CONTEXT_TOOL = {
  type: 'function',
  name: 'get_customer_context',
  description: 'Lấy sản phẩm đang tư vấn, bảng size và lịch sử hội thoại mới nhất từ Supabase trước khi trả lời khách.',
  parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
  strict: true
};

const fixedProductRules = [
  'Bạn là nhân viên tư vấn thời trang của shop, xưng "em" và gọi khách là "chị".',
  'Shop chỉ có một sản phẩm đang hoạt động trong Supabase. Luôn tư vấn SẢN PHẨM ĐANG TƯ VẤN, không hỏi khách đang quan tâm mẫu nào.',
  'Chỉ được sử dụng dữ liệu trong SẢN PHẨM ĐANG TƯ VẤN, ƯU ĐÃI HIỆN TẠI và LỊCH SỬ HỘI THOẠI.',
  'Không tự bịa giá, màu, size hoặc tồn kho.',
  'Mọi tư vấn size phải dựa trên Size guide của đúng sản phẩm. Cân nặng ngoài các khoảng đã ghi thì không có size theo bảng; tuyệt đối không chọn size gần nhất.',
  'Nếu dữ liệu cần thiết còn thiếu, hãy hỏi đúng thông tin còn thiếu.',
  'Chỉ nói có thể gửi hình khi dữ liệu Hình ảnh ghi rõ là có thể gửi cho khách.',
  'Trả lời bằng tiếng Việt tự nhiên, ngắn gọn 1-3 câu và không nói mình là AI.'
].join('\n');

async function generateOpenAIReply(receivedText, { productContext, history = [] } = {}) {
  if (!process.env.OPENAI_API_KEY) {
    addTaskLog('OpenAI', 'Lỗi: thiếu OPENAI_API_KEY');
    throw new Error('Chưa cấu hình OPENAI_API_KEY.');
  }
  addTaskLog('OpenAI', `Gửi nội dung khách: "${receivedText.slice(0, 120)}"`);
  if (!openai) {
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }

  const historyText = history.length
    ? history.map((message) => `${message.direction === 'inbound' ? 'Khách' : 'Shop'}: ${message.text}`).join('\n')
    : 'Chưa có lịch sử hội thoại.';
  const input = [
    productContext || 'SẢN PHẨM ĐANG TƯ VẤN: Chưa xác định. Không được đoán sản phẩm.',
    `LỊCH SỬ HỘI THOẠI:\n${historyText}`,
    `TIN NHẮN KHÁCH:\n"${receivedText}"`
  ].join('\n\n');

  const response = await openai.responses.create({
    model: process.env.OPENAI_MODEL || 'gpt-6-luna',
    instructions: `${global.openaiSystemPrompt}\n\n${fixedProductRules}`,
    input
  });

  const reply = response.output_text?.trim();
  if (!reply) {
    addTaskLog('OpenAI', 'Lỗi: không có nội dung trả lời');
    throw new Error('OpenAI không trả về nội dung trả lời.');
  }
  addTaskLog('OpenAI', `Nhận câu trả lời: "${reply.slice(0, 160)}"`);
  return reply;
}

async function sendMessengerAction(recipientId, action) {
  const pageAccessToken = process.env.PAGE_ACCESS_TOKEN;
  const graphApiVersion = process.env.GRAPH_API_VERSION || 'v26.0';
  if (!pageAccessToken || !recipientId) {
    console.warn('Chưa cấu hình PAGE_ACCESS_TOKEN hoặc thiếu sender PSID.');
    return;
  }

  const apiUrl = `https://graph.facebook.com/${graphApiVersion}/me/messages?access_token=${encodeURIComponent(pageAccessToken)}`;
  const sendRequest = (payload) => fetch(apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const response = await sendRequest({
    recipient: { id: recipientId },
    sender_action: action
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Facebook API ${response.status}: ${errorBody}`);
  }
  addTaskLog('Messenger', `Đã gửi ${action} cho khách ${recipientId}`);
}

async function sendMessengerMessage(recipientId, text, conversationId = null) {
  const pageAccessToken = process.env.PAGE_ACCESS_TOKEN;
  const graphApiVersion = process.env.GRAPH_API_VERSION || 'v26.0';
  if (!pageAccessToken || !recipientId) {
    console.warn('Chưa cấu hình PAGE_ACCESS_TOKEN hoặc thiếu sender PSID.');
    return;
  }

  const apiUrl = `https://graph.facebook.com/${graphApiVersion}/me/messages?access_token=${encodeURIComponent(pageAccessToken)}`;
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recipient: { id: recipientId },
      message: { text }
    })
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Facebook API ${response.status}: ${errorBody}`);
  }
  addTaskLog('Messenger', `Đã gửi trả lời cho khách ${recipientId}: "${text.slice(0, 160)}"`);
  if (conversationId) {
    await saveConversationMessage({ conversationId, senderId: recipientId, direction: 'outbound', text });
  } else {
    await saveMessage(recipientId, 'outbound', text);
  }
}

async function sendMessengerImages(recipientId, images, conversationId = null) {
  const pageAccessToken = process.env.PAGE_ACCESS_TOKEN;
  const graphApiVersion = process.env.GRAPH_API_VERSION || 'v26.0';
  const attachments = images.slice(0, 30).map((image) => ({
    type: 'image',
    payload: image.facebook_attachment_id
      ? { attachment_id: image.facebook_attachment_id }
      : { url: image.image_url }
  }));
  if (!pageAccessToken || !recipientId || !attachments.length) return;
  const apiUrl = `https://graph.facebook.com/${graphApiVersion}/me/messages?access_token=${encodeURIComponent(pageAccessToken)}`;
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recipient: { id: recipientId },
      message: attachments.length === 1
        ? { attachment: attachments[0] }
        : { attachments }
    })
  });
  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Facebook API gửi album ảnh ${response.status}: ${errorBody}`);
  }
  const attachmentIds = attachments.map((item) => item.payload.attachment_id).filter(Boolean);
  const imageUrls = attachments.map((item) => item.payload.url).filter(Boolean);
  addTaskLog('Messenger', `Đã gửi ${attachments.length} ảnh trong một tin cho khách ${recipientId}; attachment_id: ${attachmentIds.join(', ') || 'không có'}${imageUrls.length ? `; URL: ${imageUrls.join(', ')}` : ''}`);
  if (conversationId) await saveConversationMessage({ conversationId, senderId: recipientId, direction: 'outbound', text: `[Album ${attachments.length} ảnh sản phẩm]` });
}

async function replyWithOpenAI(recipientId, receivedText, conversationId = null) {
  await sendMessengerAction(recipientId, 'typing_on');
  const conversation = await getOrCreateConversation(recipientId);
  const product = await getOnlyActiveProduct();
  if (conversation.current_product_id !== product.id) {
    await updateConversationProduct(conversation.id, product.id);
  }
  conversationId = conversation.id;
  const productImages = await getProductImages(product.id);
  const availableImages = productImages
    .filter((item) => item.facebook_attachment_id || item.image_url)
    .sort((a, b) => Number(Boolean(b.is_primary)) - Number(Boolean(a.is_primary)) || Number(a.sort_order || 0) - Number(b.sort_order || 0));

  if (!await hasSentProductIntroduction(conversationId, PROMOTION_MESSAGE)) {
    if (availableImages.length) {
      await sendMessengerImages(recipientId, availableImages, conversationId);
    } else {
      addTaskLog('Product', `Sản phẩm ${product.id} chưa có ảnh để gửi`);
    }
    await sendMessengerMessage(recipientId, PROMOTION_MESSAGE, conversationId);
    await sendMessengerMessage(recipientId, MATERIAL_MESSAGE, conversationId);
    const firstSizeAdvice = WEIGHT_PATTERN.test(receivedText)
      ? getWeightSizeAdvice(receivedText, await getProductSizeGuide(product.id))
      : null;
    await sendMessengerMessage(recipientId, firstSizeAdvice?.reply || SIZE_QUESTION, conversationId);
    return;
  }

  const asksForImage = /(xem|gửi|cho|coi).{0,20}(hình|ảnh)|\b(hình|ảnh)\b/i.test(receivedText);
  if (WEIGHT_PATTERN.test(receivedText)) {
    const sizeAdvice = getWeightSizeAdvice(receivedText, await getProductSizeGuide(product.id));
    await sendMessengerMessage(recipientId, sizeAdvice.reply, conversationId);
    if (asksForImage && availableImages.length) await sendMessengerImages(recipientId, availableImages, conversationId);
    return;
  }
  if (receivedText === '[Khách gửi ảnh hoặc tệp]') {
    await sendMessengerMessage(recipientId, SIZE_QUESTION, conversationId);
    return;
  }

  if (!process.env.OPENAI_API_KEY) throw new Error('Chưa cấu hình OPENAI_API_KEY.');
  if (!openai) openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const model = process.env.OPENAI_MODEL || 'gpt-6-luna';
  addTaskLog('OpenAI', `Gửi nội dung khách: "${receivedText.slice(0, 120)}"`);

  const toolRequest = await openai.responses.create({
    model,
    instructions: 'Trước khi trả lời khách, gọi get_customer_context để lấy dữ liệu hiện tại từ Supabase.',
    input: receivedText,
    tools: [CUSTOMER_CONTEXT_TOOL],
    tool_choice: { type: 'function', name: CUSTOMER_CONTEXT_TOOL.name },
    parallel_tool_calls: false
  });
  const toolCall = toolRequest.output.find((item) => item.type === 'function_call' && item.name === CUSTOMER_CONTEXT_TOOL.name);
  if (!toolCall) throw new Error('OpenAI không gọi được công cụ lấy dữ liệu khách.');

  let productContext = null;
  let history = [];
  productContext = await getProductContext(product.id);
  history = await getRecentConversationMessages(conversationId, 10);

  const historyText = history.length
    ? history.map((message) => `${message.direction === 'inbound' ? 'Khách' : 'Shop'}: ${message.text}`).join('\n')
    : 'Chưa có lịch sử hội thoại.';
  addTaskLog('Supabase', `Đã trả dữ liệu sản phẩm và lịch sử cho OpenAI; khách ${recipientId}`);
  const finalResponse = await openai.responses.create({
    model,
    previous_response_id: toolRequest.id,
    instructions: `${global.openaiSystemPrompt}\n\n${fixedProductRules}`,
    input: [{
      type: 'function_call_output',
      call_id: toolCall.call_id,
      output: JSON.stringify({
        productContext: `${productContext}\nƯU ĐÃI HIỆN TẠI: Giá hôm nay 289K, freeship; ngày mai trở lại 450K. Chất liệu cotton lạnh, mềm mát, co giãn nhẹ, ít nhăn.`,
        history: historyText
      })
    }],
    tools: [CUSTOMER_CONTEXT_TOOL],
    tool_choice: 'none'
  });
  const generatedReply = finalResponse.output_text?.trim();
  if (!generatedReply) throw new Error('OpenAI không trả về nội dung trả lời.');
  const reply = generatedReply;
  addTaskLog('OpenAI', `Nhận câu trả lời: "${reply.slice(0, 160)}"`);

  const delayMs = 500 + Math.floor(Math.random() * 1001);
  addTaskLog('Auto-reply', `Chờ thêm ${delayMs}ms trước khi gửi câu trả lời`);
  await new Promise((resolve) => setTimeout(resolve, delayMs));

  await sendMessengerMessage(recipientId, reply, conversationId);

  if (asksForImage && availableImages.length) await sendMessengerImages(recipientId, availableImages, conversationId);
}

export default async function handler(req, res) {
  const VERIFY_TOKEN = process.env.FB_VERIFY_TOKEN || process.env.VERIFY_TOKEN || 'my_secure_verify_token';
  await loadSettings();

  // 1. Xử lý yêu cầu xác minh từ Facebook (GET) VÀ trả về danh sách tin nhắn cho Web
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    const action = req.query['action'];

    if (action === 'auto_reply_status') {
      try {
        return res.status(200).json({ enabled: await readAutoReplyEnabled() });
      } catch (error) {
        return res.status(500).json({ error: error.message });
      }
    }

    if (action === 'get_task_logs') {
      try {
        return res.status(200).json(await getStoredTaskLogs());
      } catch (error) {
        return res.status(500).json({ error: error.message });
      }
    }

    if (action === 'get_system_prompt') {
      return res.status(200).json({ prompt: global.openaiSystemPrompt });
    }

    if (action === 'test_openai') {
      addTaskLog('Web', 'Bắt đầu test kết nối OpenAI');
      try {
        const reply = await generateOpenAIReply('Trả lời đúng một từ: OK');
        addTaskLog('Web', 'Test OpenAI thành công');
        return res.status(200).json({ ok: true, reply });
      } catch (error) {
        addTaskLog('Web', `Test OpenAI thất bại: ${error.message}`);
        console.error('Kiểm tra OpenAI thất bại:', error);
        return res.status(500).json({ ok: false, error: error.message });
      }
    }

    // Facebook xác minh Webhook
    if (mode && token) {
      if (mode === 'subscribe' && token === VERIFY_TOKEN) {
        console.log('WEBHOOK_VERIFIED');
        return res.status(200).send(challenge);
      } else {
        return res.status(403).send('Forbidden');
      }
    }
    
    // Web gọi API để lấy danh sách tin nhắn hiển thị lên trang chủ
    if (action === 'get_messages') {
      try {
        return res.status(200).json(await getStoredMessages());
      } catch (error) {
        return res.status(500).json({ error: error.message });
      }
    }

    return res.status(400).send('Bad Request');
  }

  // 2. Xử lý tin nhắn đến từ Facebook (POST)
  if (req.method === 'POST') {
    const action = req.query['action'];

    if (action === 'toggle_auto_reply') {
      try {
        const enabled = !await readAutoReplyEnabled();
        await saveSetting('auto_reply_enabled', { enabled });
        global.autoReplyEnabled = enabled;
        addTaskLog('Web', `Đã ${enabled ? 'bật' : 'tắt'} tự động trả lời`);
        return res.status(200).json({ enabled });
      } catch (error) {
        return res.status(500).json({ error: error.message });
      }
    }

    if (action === 'set_system_prompt') {
      const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';
      if (!prompt) {
        return res.status(400).json({ error: 'System Prompt không được để trống.' });
      }
      global.openaiSystemPrompt = prompt;
      await saveSystemPrompt(prompt);
      addTaskLog('Web', `Đã cập nhật System Prompt (${prompt.length} ký tự)`);
      return res.status(200).json({ prompt: global.openaiSystemPrompt });
    }

    const body = req.body;

    if (body.object === 'page') {
      let autoReplyEnabled;
      try {
        autoReplyEnabled = await readAutoReplyEnabled();
      } catch (error) {
        addTaskLog('Auto-reply', error.message);
        return res.status(503).json({ error: error.message });
      }
      for (const entry of body.entry || []) {
        for (const [channel, events] of [['messaging', entry.messaging || []], ['standby', entry.standby || []]]) {
          for (const webhookEvent of events) {
            const senderPsid = webhookEvent.sender?.id;
            if (!senderPsid) continue;
            if (webhookEvent.message?.is_echo) continue;
            const { adId, location, source } = getAdReferral(webhookEvent);
            let conversation = null;
            if (adId) {
              try {
                conversation = await getOrCreateConversation(senderPsid);
                const productId = await updateConversationAd(conversation, adId);
                addTaskLog('Ads', `Khách ${senderPsid}: ad_id ${adId} từ ${channel}.${location}${productId ? ` → sản phẩm ${productId}` : ' (chưa map sản phẩm)'}`);
              } catch (error) {
                addTaskLog('Supabase', error.message);
              }
            } else if (location) {
              addTaskLog('Ads', `Khách ${senderPsid}: ${channel}.${location}, source ${source || 'không có'}, nhưng Meta không gửi ad_id`);
            } else if (channel === 'messaging' && webhookEvent.message?.text) {
              addTaskLog('Ads', `Khách ${senderPsid}: tin nhắn không có referral/ad_id trong payload Meta`);
            }

            if (channel === 'standby') continue;

            // Tin nhắn đầu tiên có thể là chữ, ảnh, sticker hoặc nút bắt đầu.
            const receivedText = webhookEvent.message?.text?.trim()
              || (webhookEvent.message?.attachments?.length ? '[Khách gửi ảnh hoặc tệp]' : null)
              || (webhookEvent.postback ? webhookEvent.postback.title || webhookEvent.postback.payload || '[Khách bấm nút]' : null);
            if (receivedText) {
              addTaskLog('Webhook', `Nhận tin từ khách ${senderPsid}: "${receivedText.slice(0, 160)}"`);

              // LƯU TIN NHẮN VÀO BỘ NHỚ (Để hiển thị lên trang chủ)
              const currentTime = new Date().toLocaleTimeString('vi-VN', {
                timeZone: 'Asia/Ho_Chi_Minh',
                hour12: false
              });
              global.messages.push({
                senderId: senderPsid,
                text: receivedText,
                time: currentTime
              });
              try {
                conversation ||= await getOrCreateConversation(senderPsid);
                await saveMessage(senderPsid, 'inbound', receivedText, conversation.id);
              } catch (error) {
                addTaskLog('Supabase', error.message);
              }

              console.log(`Đã lưu tin nhắn hiển thị lên Web: ${receivedText}`);

              // Tự động trả lời khách hàng qua Facebook Messenger nếu đang bật.
              if (autoReplyEnabled) {
                // Không chặn phản hồi webhook; tin nhắn sẽ hiện trên web trước.
                replyWithOpenAI(senderPsid, receivedText, conversation?.id || null)
                  .then(() => console.log(`Đã trả lời khách hàng ${senderPsid} bằng OpenAI`))
                  .catch((error) => {
                    addTaskLog('Auto-reply', `Lỗi trả lời khách ${senderPsid}: ${error.message}`);
                    console.error('Không thể tạo/gửi tin nhắn trả lời:', error);
                  });
              } else {
                addTaskLog('Auto-reply', 'Bỏ qua trả lời vì đang tắt');
                console.log('Tự động trả lời đang tắt.');
              }
            }
          }
        }
      }

      return res.status(200).send('EVENT_RECEIVED');
    } else {
      return res.status(404).send('Not Found');
    }
  }

  res.setHeader('Allow', ['GET', 'POST']);
  return res.status(405).end(`Method ${req.method} Not Allowed`);
}
