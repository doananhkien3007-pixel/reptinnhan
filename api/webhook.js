// api/webhook.js
import OpenAI from 'openai';
import { getSupabase } from './services/supabase.js';
import {
  findMentionedProduct,
  getOrCreateConversation,
  getProductContext,
  getProductImages,
  getRecentConversationMessages,
  saveConversationMessage,
  updateConversationAd,
  updateConversationProduct
} from './services/products.js';

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

  const { data, error } = await client
    .from('app_settings')
    .select('key, value')
    .eq('key', 'auto_reply_enabled');
  if (error) {
    console.error('Không thể tải cài đặt từ Supabase:', error.message);
    return;
  }

  for (const setting of data || []) {
    if (setting.key === 'auto_reply_enabled' && typeof setting.value?.enabled === 'boolean') {
      global.autoReplyEnabled = setting.value.enabled;
    }
  }

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

async function saveSetting(key, value) {
  const client = getSupabase();
  if (!client) return;
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

async function generateOpenAIReply(receivedText, { productContext, history = [] } = {}) {
  if (!process.env.OPENAI_API_KEY) {
    addTaskLog('OpenAI', 'Lỗi: thiếu OPENAI_API_KEY');
    throw new Error('Chưa cấu hình OPENAI_API_KEY.');
  }
  addTaskLog('OpenAI', `Gửi nội dung khách: "${receivedText.slice(0, 120)}"`);
  if (!openai) {
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }

  const fixedProductRules = [
    'Bạn là nhân viên tư vấn thời trang của shop, xưng "em" và gọi khách là "chị".',
    'Chỉ được sử dụng dữ liệu trong SẢN PHẨM ĐANG TƯ VẤN và LỊCH SỬ HỘI THOẠI.',
    'Không tự bịa giá, màu, size hoặc tồn kho.',
    'Nếu dữ liệu thiếu, hãy hỏi lại khách; nếu chưa xác định sản phẩm, trả lời đúng ý: "Dạ chị đang quan tâm mẫu nào ạ? Chị gửi hình hoặc tên mẫu giúp em nhé 🌷".',
    'Chỉ nói có thể gửi hình khi dữ liệu Hình ảnh ghi rõ là có thể gửi cho khách.',
    'Trả lời bằng tiếng Việt tự nhiên, ngắn gọn 1-3 câu và không nói mình là AI.'
  ].join('\n');
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
  let productContext = null;
  let history = [];
  let productImages = [];
  let mentionedProduct = null;

  if (conversationId) {
    const conversation = await getOrCreateConversation(recipientId);
    let productId = conversation.current_product_id;
    mentionedProduct = await findMentionedProduct(receivedText);
    if (mentionedProduct) {
      productId = mentionedProduct.id;
      if (productId !== conversation.current_product_id) {
        await updateConversationProduct(conversation.id, productId);
        addTaskLog('Product', `Đã chuyển sản phẩm tư vấn sang ${mentionedProduct.sku} - ${mentionedProduct.name}`);
      }
    }
    if (productId) {
      productContext = await getProductContext(productId);
      productImages = await getProductImages(productId);
    }
    history = await getRecentConversationMessages(conversation.id, 10);
  }

  const reply = await generateOpenAIReply(receivedText, { productContext, history });

  const delayMs = 500 + Math.floor(Math.random() * 1001);
  addTaskLog('Auto-reply', `Chờ thêm ${delayMs}ms trước khi gửi câu trả lời`);
  await new Promise((resolve) => setTimeout(resolve, delayMs));

  await sendMessengerMessage(recipientId, reply, conversationId);

  const asksForImage = /(xem|gửi|cho|coi).{0,20}(hình|ảnh)|\b(hình|ảnh)\b/i.test(receivedText);
  if ((asksForImage || mentionedProduct) && productImages.length) {
    const availableImages = productImages.filter((item) => item.facebook_attachment_id || item.image_url);
    if (availableImages.length) await sendMessengerImages(recipientId, availableImages, conversationId);
  }
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
      return res.status(200).json({ enabled: global.autoReplyEnabled });
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
      global.autoReplyEnabled = !global.autoReplyEnabled;
      await saveSetting('auto_reply_enabled', { enabled: global.autoReplyEnabled });
      addTaskLog('Web', `Đã ${global.autoReplyEnabled ? 'bật' : 'tắt'} tự động trả lời`);
      return res.status(200).json({ enabled: global.autoReplyEnabled });
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
      for (const entry of body.entry || []) {
        for (const webhookEvent of entry.messaging || []) {
        
        const senderPsid = webhookEvent.sender?.id;
        if (!senderPsid) continue;
        const referral = webhookEvent.referral || webhookEvent.message?.referral || webhookEvent.postback?.referral || webhookEvent.optin?.referral;
        const adId = referral?.ad_id || referral?.source_id || referral?.ads_context_data?.ad_id;
        let conversation = null;
        if (adId) {
          try {
            conversation = await getOrCreateConversation(senderPsid);
            await updateConversationAd(conversation.id, String(adId));
            addTaskLog('Ads', `Khách ${senderPsid} bấm quảng cáo ${adId}`);
          } catch (error) {
            addTaskLog('Supabase', error.message);
          }
        }

        // Nếu có tin nhắn văn bản
        if (webhookEvent.message && webhookEvent.message.text) {
          const receivedText = webhookEvent.message.text;
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
          if (global.autoReplyEnabled) {
            // Không chặn phản hồi webhook; tin nhắn sẽ hiện trên web trước.
            replyWithOpenAI(senderPsid, receivedText, conversation?.id || null)
              .then(() => console.log(`Đã trả lời khách hàng ${senderPsid} bằng OpenAI`))
              .catch((error) => console.error('Không thể tạo/gửi tin nhắn trả lời:', error));
          } else {
            addTaskLog('Auto-reply', 'Bỏ qua trả lời vì đang tắt');
            console.log('Tự động trả lời đang tắt.');
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
