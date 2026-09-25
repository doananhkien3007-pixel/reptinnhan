// api/webhook.js
import OpenAI from 'openai';

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

function addTaskLog(action, detail) {
  global.taskLogs.push({
    time: new Date().toLocaleString('vi-VN', {
      timeZone: 'Asia/Ho_Chi_Minh',
      hour12: false
    }),
    action,
    detail
  });
  if (global.taskLogs.length > 200) global.taskLogs.shift();
}

let openai;

async function generateOpenAIReply(receivedText) {
  if (!process.env.OPENAI_API_KEY) {
    addTaskLog('OpenAI', 'Lỗi: thiếu OPENAI_API_KEY');
    throw new Error('Chưa cấu hình OPENAI_API_KEY.');
  }
  addTaskLog('OpenAI', `Gửi nội dung khách: "${receivedText.slice(0, 120)}"`);
  if (!openai) {
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }

  const response = await openai.responses.create({
    model: process.env.OPENAI_MODEL || 'gpt-6-luna',
    instructions: global.openaiSystemPrompt,
    input: receivedText
  });

  const reply = response.output_text?.trim();
  if (!reply) {
    addTaskLog('OpenAI', 'Lỗi: không có nội dung trả lời');
    throw new Error('OpenAI không trả về nội dung trả lời.');
  }
  addTaskLog('OpenAI', `Nhận câu trả lời: "${reply.slice(0, 160)}"`);
  return reply;
}

async function sendMessengerReply(recipientId, text) {
  const pageAccessToken = process.env.PAGE_ACCESS_TOKEN;
  const graphApiVersion = process.env.GRAPH_API_VERSION || 'v26.0';
  const replyDelayMs = Number(process.env.REPLY_DELAY_MS || 3000);
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

  const typingResponse = await sendRequest({
    recipient: { id: recipientId },
    sender_action: 'typing_on'
  });

  if (!typingResponse.ok) {
    const errorBody = await typingResponse.text();
    throw new Error(`Facebook API ${typingResponse.status}: ${errorBody}`);
  }
  addTaskLog('Messenger', `Đã gửi typing_on cho khách ${recipientId}`);

  // Giữ trạng thái "đang nhập..." để phản hồi tự nhiên hơn.
  await new Promise((resolve) => setTimeout(resolve, replyDelayMs));

  const response = await sendRequest({
    recipient: { id: recipientId },
    message: { text }
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Facebook API ${response.status}: ${errorBody}`);
  }
  addTaskLog('Messenger', `Đã gửi trả lời cho khách ${recipientId}: "${text.slice(0, 160)}"`);
}

export default async function handler(req, res) {
  const VERIFY_TOKEN = process.env.FB_VERIFY_TOKEN || process.env.VERIFY_TOKEN || 'my_secure_verify_token';

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
      return res.status(200).json(global.taskLogs);
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
      return res.status(200).json(global.messages);
    }

    return res.status(400).send('Bad Request');
  }

  // 2. Xử lý tin nhắn đến từ Facebook (POST)
  if (req.method === 'POST') {
    const action = req.query['action'];

    if (action === 'toggle_auto_reply') {
      global.autoReplyEnabled = !global.autoReplyEnabled;
      addTaskLog('Web', `Đã ${global.autoReplyEnabled ? 'bật' : 'tắt'} tự động trả lời`);
      return res.status(200).json({ enabled: global.autoReplyEnabled });
    }

    if (action === 'set_system_prompt') {
      const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';
      if (!prompt) {
        return res.status(400).json({ error: 'System Prompt không được để trống.' });
      }
      global.openaiSystemPrompt = prompt;
      addTaskLog('Web', `Đã cập nhật System Prompt (${prompt.length} ký tự)`);
      return res.status(200).json({ prompt: global.openaiSystemPrompt });
    }

    const body = req.body;

    if (body.object === 'page') {
      for (const entry of body.entry) {
        const webhookEvent = entry.messaging[0];
        if (!webhookEvent) continue;
        
        const senderPsid = webhookEvent.sender?.id;

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
          
          console.log(`Đã lưu tin nhắn hiển thị lên Web: ${receivedText}`);

          // Tự động trả lời khách hàng qua Facebook Messenger nếu đang bật.
          if (global.autoReplyEnabled) {
            // Không chặn phản hồi webhook; tin nhắn sẽ hiện trên web trước.
            generateOpenAIReply(receivedText)
              .then((reply) => sendMessengerReply(senderPsid, reply))
              .then(() => console.log(`Đã trả lời khách hàng ${senderPsid} bằng OpenAI`))
              .catch((error) => console.error('Không thể tạo/gửi tin nhắn trả lời:', error));
          } else {
            addTaskLog('Auto-reply', 'Bỏ qua trả lời vì đang tắt');
            console.log('Tự động trả lời đang tắt.');
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
