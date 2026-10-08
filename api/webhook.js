// api/webhook.js
import { generateReply } from '../server/ai-reply.js';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { withTypingDelay } from '../server/messenger-typing.js';
import { getSupabase } from '../server/supabase.js';
import { getReplyContext } from '../server/conversation-context.js';
import { beginCustomerTurn, checkpointTurn, endCustomerTurn } from '../server/customer-turn.js';
import { getAdReferral } from '../server/ad-referral.js';
import { createWorkflowTrace } from '../server/workflow-trace.js';
import { syncFacebookProfile } from '../server/facebook-profile.js';
import { readWebhookBody } from '../server/webhook-body.js';
import { planIntroduction } from '../server/product-introduction.js';
import { getIntroductionFollowup } from '../server/introduction-followup.js';
import { readIntroductionState, saveIntroductionState } from '../server/product-introduction-state.js';
import { authorizeOrders } from '../server/orders.js';
import { acquireWelcomeClaim, releaseWelcomeClaim } from '../server/welcome-claim.js';
export const config = { api: { bodyParser: false } };
import {
  getAllSentTexts,
  getOrCreateConversation,
  saveConversationMessage,
  updateConversationAd,
  syncLatestConversationAd
} from '../server/products.js';

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
  const profilesByConversation = new Map();
  const profileCandidates = new Map();
  if (conversationIds.length) {
    let { data: conversations, error: adError } = await client.from('conversations')
      .select('id, external_user_id, ad_id, facebook_name, facebook_profile_pic, profile_updated_at').in('id', conversationIds);
    if (adError) {
      const fallback = await client.from('conversations').select('id, external_user_id, ad_id').in('id', conversationIds);
      conversations = fallback.data;
      adError = fallback.error;
    }
    if (adError) throw new Error(`Không thể đọc Ads ID: ${adError.message}`);
    for (const conversation of conversations || []) profilesByConversation.set(conversation.id, {
      adId: conversation.ad_id,
      customerName: conversation.facebook_name || null,
      profilePic: conversation.facebook_profile_pic || null
    });
    for (const conversation of conversations || []) {
      if (!conversation.facebook_name && conversation.external_user_id) profileCandidates.set(conversation.id, conversation);
    }
  }
  // Tin nhắn được lưu trước khi có conversation_id vẫn thuộc về cùng khách hàng.
  const senderIds = [...new Set((data || [])
    .filter((message) => !profilesByConversation.get(message.conversation_id)?.adId)
    .map((message) => message.sender_id)
    .filter(Boolean))];
  const profilesBySender = new Map();
  if (senderIds.length) {
    let { data: conversations, error: adError } = await client.from('conversations')
      .select('id, external_user_id, ad_id, facebook_name, facebook_profile_pic, profile_updated_at')
      .eq('channel', 'facebook')
      .in('external_user_id', senderIds);
    if (adError) {
      const fallback = await client.from('conversations').select('id, external_user_id, ad_id')
        .eq('channel', 'facebook').in('external_user_id', senderIds);
      conversations = fallback.data;
      adError = fallback.error;
    }
    if (adError) throw new Error(`Không thể đọc Ads ID theo khách hàng: ${adError.message}`);
    for (const conversation of conversations || []) profilesBySender.set(conversation.external_user_id, {
      adId: conversation.ad_id,
      customerName: conversation.facebook_name || null,
      profilePic: conversation.facebook_profile_pic || null
    });
    for (const conversation of conversations || []) {
      if (!conversation.facebook_name && conversation.external_user_id) profileCandidates.set(conversation.id, conversation);
    }
  }
  if (profileCandidates.size) {
    const enrichedProfiles = await Promise.all([...profileCandidates.values()].slice(0, 10).map(syncFacebookProfile));
    for (const conversation of enrichedProfiles) {
      const profile = {
        adId: conversation.ad_id || null,
        customerName: conversation.facebook_name || null,
        profilePic: conversation.facebook_profile_pic || null
      };
      profilesByConversation.set(conversation.id, profile);
      profilesBySender.set(conversation.external_user_id, profile);
    }
  }
  return (data || []).reverse().map((message) => ({
    ...(profilesByConversation.get(message.conversation_id) || profilesBySender.get(message.sender_id) || {}),
    senderId: message.sender_id,
    adId: profilesByConversation.get(message.conversation_id)?.adId || profilesBySender.get(message.sender_id)?.adId || null,
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
  addTaskLog('OpenAI', `Hiểu ý định: ${result.intent}; chọn ${result.media_ids.length} ảnh/video`);
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

async function replyToCustomer(recipientId, conversation, receivedText, trace, turn, context, state) {
  await trace.nodeStarted('ai_agent', { mode: 'introduction_only', history_count: context.history.length });
  if (!state || state.status === 'pending') {
    // Import existing customers once. A Human reset deliberately starts fresh.
    const sentTexts = state ? [] : await getAllSentTexts(recipientId);
    const introduction = planIntroduction(context.product, sentTexts);
    const actions = [
      ...introduction.images.map(({ image, marker }) => ({ type: 'media', media: image, marker })),
      ...introduction.videos.map(({ video, marker }) => ({ type: 'media', media: video, marker })),
      ...introduction.messages.map((text) => ({ type: 'text', text }))
    ];
    state = { version: state?.version || randomUUID(), status: actions.length ? 'sending' : 'introduced', actions, sent_count: 0 };
    await saveIntroductionState(recipientId, context.product.id, state);
  }
  const plan = { intent: 'product_introduction', actions: state.actions || [] };
  await checkpointTurn(turn, { introduction_version: state.version, plan, sent_count: state.sent_count });
  await trace.nodeCompleted('ai_agent', { intent: plan.intent });
  await trace.edgeTransfer('ai_agent', 'business_logic');
  await trace.nodeStarted('business_logic');
  await trace.nodeCompleted('business_logic', { intent: plan.intent, action_count: plan.actions.length });
  await trace.edgeTransfer('business_logic', 'send_messenger');
  await trace.nodeStarted('send_messenger');
  for (let index = state.sent_count || 0; index < plan.actions.length; index++) {
    // An operator can pause the bot while the introduction is being sent.
    if (!await readAutoReplyEnabled()) {
      addTaskLog('Auto-reply', 'Dừng lượt đang xử lý vì người quản trị đã tắt bot');
      break;
    }
    if (index > 0) await waitBetweenReplies(500, 1000);
    const action = plan.actions[index];
    if (action.type === 'text') await sendMessengerMessage(recipientId, action.text, conversation.id);
    else await sendMessengerMedia(recipientId, action.media, conversation.id, action.marker);
    state = { ...state, sent_count: index + 1,
      status: index + 1 === plan.actions.length ? 'introduced' : 'sending' };
    await saveIntroductionState(recipientId, context.product.id, state);
    await checkpointTurn(turn, { sent_count: index + 1 });
  }
  await trace.nodeCompleted('send_messenger', { action_count: turn.value.sent_count || 0 });
  await trace.edgeTransfer('send_messenger', 'completed');
  await trace.nodeStarted('completed');
  await trace.nodeCompleted('completed');
  await trace.complete({ intent: plan.intent, product_id: context.product?.id || null });
}

async function processCustomerEvent(webhookEvent, channel, autoReplyEnabled) {
  const senderPsid = webhookEvent.sender?.id;
  if (!senderPsid || webhookEvent.message?.is_echo) return;
  const receivedText = webhookEvent.message?.text?.trim()
    || (webhookEvent.message?.attachments?.length ? '[Khách gửi ảnh hoặc tệp]' : null)
    || (webhookEvent.postback ? webhookEvent.postback.title || webhookEvent.postback.payload || '[Khách bấm nút]' : null);
  const { adId, location } = getAdReferral(webhookEvent);
  if ((channel === 'standby' || !receivedText) && !adId) return;

  let turn;
  let trace;
  let stage = 'facebook_webhook';
  try {
    turn = await beginCustomerTurn(senderPsid, webhookEvent);
    if (turn.value.complete) return;
    if (channel === 'standby' || !receivedText) {
      const conversation = await getOrCreateConversation(senderPsid);
      await updateConversationAd(conversation, adId, { timestamp: webhookEvent.timestamp });
      await checkpointTurn(turn, { complete: true });
      return;
    }
    trace = await createWorkflowTrace({ customerId: senderPsid, message: receivedText, adId });
    await trace.nodeStarted('facebook_webhook');
    await trace.nodeCompleted('facebook_webhook');
    await trace.edgeTransfer('facebook_webhook', 'parse_message');
    stage = 'parse_message';
    await trace.nodeStarted(stage);
    await trace.nodeCompleted(stage, { message_type: webhookEvent.message?.attachments?.length ? 'attachment' : 'text' });
    await trace.edgeTransfer('parse_message', 'detect_ad');
    stage = 'detect_ad';
    await trace.nodeStarted(stage);
    let conversation = await getOrCreateConversation(senderPsid);
    if (adId) {
      conversation = await updateConversationAd(conversation, adId, { timestamp: webhookEvent.timestamp });
      addTaskLog('Ads', `Khách ${senderPsid}: Ads mới nhất ${conversation.ad_id} (referral ${adId} từ ${location})`);
    } else conversation = await syncLatestConversationAd(conversation);
    await trace.nodeCompleted(stage, { ad_id: conversation.ad_id || null });
    await trace.edgeTransfer('detect_ad', 'find_product');
    stage = 'find_product';
    await trace.nodeStarted(stage);
    conversation = await syncFacebookProfile(conversation);
    if (!turn.value.inbound_saved) {
      await saveMessage(senderPsid, 'inbound', receivedText, conversation.id);
      await checkpointTurn(turn, { inbound_saved: true });
      global.messages.push({ senderId: senderPsid, adId: conversation.ad_id, direction: 'inbound', text: receivedText,
        time: new Date().toLocaleTimeString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false }) });
      if (global.messages.length > 200) global.messages.shift();
      addTaskLog('Webhook', `Nhận tin từ khách ${senderPsid}: "${receivedText.slice(0, 160)}"`);
    }
    const context = await getReplyContext(conversation, receivedText, { preferLatestAd: true });
    let introductionState = context.product ? await readIntroductionState(senderPsid, context.product.id) : null;
    const alreadyIntroduced = introductionState?.status === 'introduced';
    const staleTurn = turn.value.introduction_version && introductionState?.version !== turn.value.introduction_version;
    if (context.product && !staleTurn && !alreadyIntroduced && introductionState?.status !== 'human_handoff' &&
        getIntroductionFollowup(context.product, [], receivedText)) {
      introductionState = { ...introductionState, status: 'human_handoff', version: introductionState?.version || randomUUID() };
      await saveIntroductionState(senderPsid, context.product.id, introductionState);
      addTaskLog('Human', `Khách ${senderPsid} gửi số đo/thông tin nhận hàng cho mẫu ${context.product.id}, nhường nhân viên`);
    }
    await trace.patch({ ad_id: conversation.ad_id || null, product_id: context?.product?.id || null, product_name: context?.product?.name || null });
    await trace.nodeCompleted(stage, { product_id: context?.product?.id || null });
    await trace.edgeTransfer('find_product', 'check_auto_reply');
    stage = 'check_auto_reply';
    await trace.nodeStarted(stage);
    const reason = alreadyIntroduced ? 'already_introduced' : introductionState?.status === 'human_handoff' ? 'human_handoff'
      : !autoReplyEnabled ? 'auto_reply_disabled' : !context.product ? 'product_not_mapped' : staleTurn ? 'introduction_reset' : null;
    await trace.nodeCompleted(stage, { enabled: autoReplyEnabled, reason });
    if (!reason) {
      await trace.edgeTransfer('check_auto_reply', 'ai_agent');
      stage = 'ai_agent';
      const trackedTrace = { ...trace, nodeStarted: async (node, payload) => { stage = node; await trace.nodeStarted(node, payload); } };
      await replyToCustomer(senderPsid, conversation, receivedText, trackedTrace, turn, context, introductionState);
    } else {
      for (const [previous, node] of [['check_auto_reply', 'ai_agent'], ['ai_agent', 'business_logic'], ['business_logic', 'send_messenger'], ['send_messenger', 'completed']]) {
        await trace.edgeTransfer(previous, node, { skipped: true, reason });
        await trace.nodeStarted(node, { skipped: true, reason });
        await trace.nodeCompleted(node, { skipped: true, reason });
      }
      await trace.complete({ reason });
    }
    await checkpointTurn(turn, { complete: true });
  } catch (error) {
    await trace?.nodeError(stage, error);
    throw error;
  } finally {
    await endCustomerTurn(turn);
  }
}

export default async function handler(req, res) {
  if (req.method === 'POST') {
    try {
      const managementAction = ['preview_reply', 'toggle_auto_reply', 'set_system_prompt', 'reset_introduction'].includes(req.query.action);
      // Management actions use the web UI; Meta events use the webhook signature.
      await readWebhookBody(req, Boolean(process.env.FB_APP_SECRET) && !managementAction);
    } catch {
      return res.status(400).send('Invalid webhook payload or signature');
    }
  }
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

    if (action === 'reset_introduction') {
      if (!authorizeOrders(req, res)) return;
      const senderId = typeof req.body?.sender_id === 'string' ? req.body.sender_id.trim() : '';
      if (!senderId || senderId.length > 100) return res.status(400).json({ error: 'Chọn khách cần reset.' });
      let lock;
      try {
        lock = await acquireWelcomeClaim(senderId, 'ai_conversation', { reopenComplete: true });
        if (!lock) return res.status(409).json({ error: 'Khách đang được xử lý, thử reset lại sau.' });
        const { data, error } = await getSupabase().from('conversations').select('*')
          .eq('channel', 'facebook').eq('external_user_id', senderId).maybeSingle();
        if (error) throw new Error('Không tải được hội thoại.');
        if (!data) return res.status(404).json({ error: 'Không tìm thấy khách.' });
        const conversation = await syncLatestConversationAd(data);
        const context = await getReplyContext(conversation, '', { persistProduct: false, preferLatestAd: true });
        if (!context.product) return res.status(400).json({ error: 'Chưa xác định sản phẩm của quảng cáo gần nhất.' });
        if (req.body.product_id != null && String(req.body.product_id) !== String(context.product.id)) {
          return res.status(409).json({ error: 'Khách đã chuyển sang mẫu khác. Tải lại trước khi reset.' });
        }
        await saveIntroductionState(senderId, context.product.id, { status: 'pending', version: randomUUID() });
        addTaskLog('Human', `Reset giới thiệu: khách ${senderId}, mẫu ${context.product.id}`);
        return res.status(200).json({ reset: true, sender_id: senderId, product_id: context.product.id, product_name: context.product.name });
      } catch (error) {
        return res.status(503).json({ error: error.message });
      } finally {
        if (lock) await releaseWelcomeClaim(lock);
      }
    }

    if (action === 'preview_reply') {
      const text = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
      const senderId = typeof req.body?.sender_id === 'string' ? req.body.sender_id.trim() : '';
      const previewHistory = req.body?.preview_history ?? [];
      if (!text || text.length > 4000 || senderId.length > 100) {
        return res.status(400).json({ error: 'Nhập tin nhắn từ 1 đến 4.000 ký tự.' });
      }
      if (!Array.isArray(previewHistory) || previewHistory.length > 20 || previewHistory.some((message, index) =>
        !message || message.direction !== (index % 2 === 0 ? 'inbound' : 'outbound') ||
        typeof message.text !== 'string' || !message.text.trim() || message.text.length > 4000) || previewHistory.length % 2 !== 0) {
        return res.status(400).json({ error: 'Lịch sử thử không hợp lệ. Hãy bấm Bắt đầu lại.' });
      }
      try {
        let conversation = {};
        if (senderId) {
          const client = getSupabase();
          if (!client) throw new Error('Chưa cấu hình Supabase.');
          const { data, error } = await client.from('conversations').select('*')
            .eq('channel', 'facebook').eq('external_user_id', senderId).maybeSingle();
          if (error) throw new Error('Không tải được ngữ cảnh khách hàng.');
          if (!data) return res.status(404).json({ error: 'Không tìm thấy hội thoại của khách này.' });
          conversation = data;
        }
        const context = await getReplyContext(conversation, text, {
          currentMessageSaved: false, persistProduct: false,
          additionalHistory: previewHistory.map(message => ({ direction: message.direction, text: message.text })), preferLatestAd: Boolean(conversation.ad_id)
        });
        const state = senderId && context.product ? await readIntroductionState(senderId, context.product.id) : null;
        const alreadyIntroduced = state?.status === 'introduced';
        const handedOff = state?.status === 'human_handoff' || Boolean(getIntroductionFollowup(context.product, previewHistory, text));
        const sentTexts = [...(senderId && !state ? await getAllSentTexts(senderId) : []), ...previewHistory.filter(item => item.direction === 'outbound').flatMap(item => item.text.split('\n\n'))];
        const remaining = state?.status === 'sending' ? state.actions.slice(state.sent_count || 0) : null;
        const introduction = !handedOff && !alreadyIntroduced && context.product
          ? remaining ? {
            images: remaining.filter(item => item.type === 'media' && item.media.media_type !== 'video').map(item => ({ image: item.media, marker: item.marker })),
            videos: remaining.filter(item => item.type === 'media' && item.media.media_type === 'video').map(item => ({ video: item.media, marker: item.marker })),
            messages: remaining.filter(item => item.type === 'text').map(item => item.text)
          } : planIntroduction(context.product, sentTexts) : null;
        const result = {
          intent: alreadyIntroduced ? 'already_introduced' : handedOff ? 'human_handoff' : introduction ? 'product_introduction' : 'awaiting_product',
          reply: introduction?.messages.join('\n\n') || '',
          media_ids: [...(introduction?.images.map(item => String(item.image.facebook_attachment_id).trim()) || []), ...(introduction?.videos.map(item => String(item.video.facebook_attachment_id).trim()) || [])],
          media_markers: [...(introduction?.images.map(item => item.marker) || []), ...(introduction?.videos.map(item => item.marker) || [])],
          image_count: introduction?.images.length || 0,
          video_count: introduction?.videos.length || 0,
          messages: introduction?.messages || [],
          skipped: !introduction || (!introduction.images.length && !introduction.videos.length && !introduction.messages.length)
        };
        return res.status(200).json({ ...result, product_id: context.product?.id || null, product_name: context.product?.name || null, history_count: context.history.length });
      } catch (error) {
        return res.status(502).json({ error: error.message });
      }
    }

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

    if (body?.object !== 'page') return res.status(404).send('Not Found');
    let autoReplyEnabled;
    try {
      autoReplyEnabled = await readAutoReplyEnabled();
    } catch (error) {
      addTaskLog('Auto-reply', error.message);
      return res.status(503).json({ error: 'Chưa đọc được trạng thái chatbot. Vui lòng thử lại.' });
    }
    let shouldRetry = false;
    for (const entry of body.entry || []) {
      for (const [channel, events] of [['messaging', entry.messaging || []], ['standby', entry.standby || []]]) {
        for (const event of events) {
          try {
            await processCustomerEvent(event, channel, autoReplyEnabled);
          } catch (error) {
            shouldRetry = true;
            addTaskLog('Auto-reply', `Lỗi tư vấn cho khách ${event.sender?.id}: ${error.message}`);
            console.error('Không thể hoàn tất tư vấn:', error);
          }
        }
      }
    }
    // Meta can retry failed/busy events; completed event IDs are skipped on replay.
    return res.status(shouldRetry ? 503 : 200).send(shouldRetry ? 'RETRY_EVENT' : 'EVENT_RECEIVED');
  }

  res.setHeader('Allow', ['GET', 'POST']);
  return res.status(405).end(`Method ${req.method} Not Allowed`);
}
