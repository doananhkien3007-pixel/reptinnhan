// api/webhook.js
import { generateReply } from './services/ai-reply.js';
import { setTimeout as sleep } from 'node:timers/promises';
import { withTypingDelay } from './services/messenger-typing.js';
import { getSupabase } from './services/supabase.js';
import { planIntroduction } from './services/product-introduction.js';
import { getAdReferral } from './services/ad-referral.js';
import { acquireWelcomeClaim, completeWelcomeClaim, releaseWelcomeClaim } from './services/welcome-claim.js';
import {
  getOrCreateConversation,
  getMainProduct,
  getAllSentTexts,
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
  // Tin nhắn được lưu trước khi có conversation_id vẫn thuộc về cùng khách hàng.
  const senderIds = [...new Set((data || [])
    .filter((message) => !adsByConversation.get(message.conversation_id))
    .map((message) => message.sender_id)
    .filter(Boolean))];
  const adsBySender = new Map();
  if (senderIds.length) {
    const { data: conversations, error: adError } = await client.from('conversations')
      .select('external_user_id, ad_id')
      .eq('channel', 'facebook')
      .in('external_user_id', senderIds);
    if (adError) throw new Error(`Không thể đọc Ads ID theo khách hàng: ${adError.message}`);
    for (const conversation of conversations || []) adsBySender.set(conversation.external_user_id, conversation.ad_id);
  }
  return (data || []).reverse().map((message) => ({
    senderId: message.sender_id,
    adId: adsByConversation.get(message.conversation_id) || adsBySender.get(message.sender_id) || null,
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

async function generateOpenAIReply(receivedText, context = {}) {
  addTaskLog('OpenAI', `Đang phân tích tin nhắn và ${context.history?.length || 0} tin lịch sử`);
  const result = await generateReply(receivedText, {
    ...context,
    systemPrompt: global.openaiSystemPrompt
  });
  addTaskLog('OpenAI', `Đã tạo câu trả lời theo ngữ cảnh; chọn ${result.media_ids.length} ảnh/video`);
  return result;
}

async function sendMessengerMessage(recipientId, text, conversationId = null) {
  const pageAccessToken = process.env.PAGE_ACCESS_TOKEN;
  const graphApiVersion = process.env.GRAPH_API_VERSION || 'v26.0';
  if (!pageAccessToken || !recipientId) {
    throw new Error('Chưa cấu hình PAGE_ACCESS_TOKEN hoặc thiếu sender PSID.');
  }

  return withTypingDelay(recipientId, text, async () => {
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
  });
}

async function sendMessengerMedia(recipientId, media, conversationId, marker) {
  const pageAccessToken = process.env.PAGE_ACCESS_TOKEN;
  const graphApiVersion = process.env.GRAPH_API_VERSION || 'v26.0';
  if (!pageAccessToken || !recipientId) {
    throw new Error('Chưa cấu hình PAGE_ACCESS_TOKEN hoặc thiếu sender PSID.');
  }
  const attachmentId = String(media.facebook_attachment_id || '').trim();
  if (!attachmentId) throw new Error('Ảnh/video sản phẩm chưa có facebook_attachment_id.');
  const attachment = {
    type: media.media_type === 'video' ? 'video' : 'image',
    payload: { attachment_id: attachmentId }
  };
  const apiUrl = `https://graph.facebook.com/${graphApiVersion}/me/messages?access_token=${encodeURIComponent(pageAccessToken)}`;
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recipient: { id: recipientId },
      message: { attachment }
    })
  });
  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Facebook API gửi ${attachment.type} ${response.status}: ${errorBody}`);
  }
  await saveConversationMessage({ conversationId, senderId: recipientId, direction: 'outbound', text: marker });
  addTaskLog('Messenger', `Đã gửi ${marker} cho khách ${recipientId}`);
}

function randomDelay(min, max) {
  return Math.floor(min + Math.random() * (max - min + 1));
}

async function waitBetweenReplies(min = 800, max = 1800) {
  const configured = Number(process.env.MESSENGER_SEQUENCE_DELAY_MS);
  const delay = Number.isFinite(configured)
    ? Math.max(0, Math.min(5000, configured))
    : randomDelay(min, max);
  if (delay) await sleep(delay);
}

async function waitBeforeFirstReply() {
  const configured = Number(process.env.MESSENGER_INITIAL_REPLY_DELAY_MS);
  const delay = Number.isFinite(configured)
    ? Math.max(0, Math.min(10000, configured))
    : randomDelay(2000, 4000);
  if (delay) await sleep(delay);
}

async function replyToCustomer(recipientId, conversation) {
  const product = await getMainProduct();
  const texts = await getAllSentTexts(recipientId);
  // Chỉ công nhận marker cũ không có mã sản phẩm nếu hội thoại đang gắn đúng mẫu.
  const allowLegacy = String(conversation.current_product_id) === String(product.id);
  const plan = planIntroduction(product, texts, { allowLegacy });
  if (!plan.images.length && !plan.videos.length && !plan.messages.length) {
    addTaskLog('Auto-reply', `Khách ${recipientId} đã nhận đủ 2 ảnh, video, giá, ưu đãi, chất vải và câu hỏi cân nặng/chiều cao; hoàn tất.`);
    return;
  }
  // Khóa riêng cho nhiệm vụ mới; trạng thái complete của lời chào cũ không bỏ sót câu hỏi size.
  const claim = await acquireWelcomeClaim(recipientId, `bot_intro_v2:${product.id}`, { reopenComplete: true });
  if (!claim) return;
  try {
    const latest = planIntroduction(product, await getAllSentTexts(recipientId), { allowLegacy });
    await waitBeforeFirstReply();
    let sentAny = false;
    const pause = async (min, max) => {
      if (sentAny) await waitBetweenReplies(min, max);
      sentAny = true;
    };
    for (const { image, marker } of latest.images) {
      await pause(800, 1600);
      await sendMessengerMedia(recipientId, image, conversation.id, marker);
    }
    for (const { video, marker } of latest.videos) {
      await pause(1500, 2500);
      await sendMessengerMedia(recipientId, video, conversation.id, marker);
    }
    for (const [index, text] of latest.messages.entries()) {
      await pause(index === 0 ? 1200 : 1000, index === 0 ? 2200 : 2000);
      await sendMessengerMessage(recipientId, text, conversation.id);
    }
    // Chỉ chuyển liên kết sản phẩm sau khi tư vấn đủ, tránh nhận nhầm marker mẫu cũ khi thử lại.
    await updateConversationProduct(conversation.id, product.id);
    await completeWelcomeClaim(claim);
    addTaskLog('Auto-reply', `Đã tư vấn đủ sản phẩm ${product.name} cho khách ${recipientId}; bot dừng trả lời.`);
  } catch (error) {
    await releaseWelcomeClaim(claim);
    throw error;
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
        const { reply } = await generateOpenAIReply('Trả lời đúng một từ: OK');
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
                conversation = { ...conversation, ad_id: adId, current_product_id: productId };
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
                adId: adId || conversation?.ad_id || null,
                text: receivedText,
                time: currentTime
              });
              let contextReady = false;
              try {
                conversation ||= await getOrCreateConversation(senderPsid);
                await saveMessage(senderPsid, 'inbound', receivedText, conversation.id);
                contextReady = true;
              } catch (error) {
                addTaskLog('Supabase', error.message);
              }

              console.log(`Đã lưu tin nhắn hiển thị lên Web: ${receivedText}`);

              // Tự động trả lời khách hàng qua Facebook Messenger nếu đang bật.
              if (autoReplyEnabled) {
                try {
                  if (!contextReady) throw new Error('Thiếu lịch sử hội thoại; không gửi câu trả lời thiếu ngữ cảnh.');
                  await replyToCustomer(senderPsid, conversation);
                } catch (error) {
                  addTaskLog('Auto-reply', `Lỗi tư vấn cho khách ${senderPsid}: ${error.message}`);
                  console.error('Không thể hoàn tất tư vấn:', error);
                }
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
