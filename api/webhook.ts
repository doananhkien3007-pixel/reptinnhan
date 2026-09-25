import type { VercelRequest, VercelResponse } from '@vercel/node';

// --- HÀM TƯƠNG TÁC VỚI VERCEL KV (DATABASE) ---
// Biến RAM dự phòng nếu chưa cài Database
(global as any).ramMessagesDB = (global as any).ramMessagesDB || [];
(global as any).ramProcessedMids = (global as any).ramProcessedMids || [];

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

async function getMessagesFromDB() {
  if (!KV_URL || !KV_TOKEN) {
    return (global as any).ramMessagesDB; // Fallback dùng RAM
  }
  try {
    const res = await fetch(`${KV_URL}/get/messagesDB`, {
      headers: { Authorization: `Bearer ${KV_TOKEN}` }
    });
    const data = await res.json();
    return data.result ? JSON.parse(data.result) : [];
  } catch (err) {
    console.error("❌ Lỗi đọc từ DB:", err);
    return [];
  }
}

async function saveMessagesToDB(messages: any[]) {
  if (messages.length > 200) messages = messages.slice(-200); // Giữ tối đa 200 tin
  
  if (!KV_URL || !KV_TOKEN) {
    console.warn("⚠️ Chưa kết nối Vercel KV. Đang lưu tạm vào RAM (sẽ bị mất khi server sleep).");
    (global as any).ramMessagesDB = messages; // Fallback dùng RAM
    return;
  }

  try {
    await fetch(`${KV_URL}/set/messagesDB`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KV_TOKEN}` },
      body: JSON.stringify(JSON.stringify(messages))
    });
    console.log(`💾 Đã lưu DB thành công. Tổng số tin nhắn: ${messages.length}`);
  } catch (err) {
    console.error("❌ Lỗi lưu DB:", err);
  }
}

async function getProcessedMids() {
  if (!KV_URL || !KV_TOKEN) return (global as any).ramProcessedMids; // Fallback
  try {
    const res = await fetch(`${KV_URL}/get/processedMids`, {
      headers: { Authorization: `Bearer ${KV_TOKEN}` }
    });
    const data = await res.json();
    return data.result ? JSON.parse(data.result) : [];
  } catch (err) {
    return [];
  }
}

async function saveProcessedMids(mids: string[]) {
  if (mids.length > 200) mids = mids.slice(-200);
  
  if (!KV_URL || !KV_TOKEN) {
    (global as any).ramProcessedMids = mids; // Fallback
    return;
  }
  
  try {
    await fetch(`${KV_URL}/set/processedMids`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KV_TOKEN}` },
      body: JSON.stringify(JSON.stringify(mids))
    });
  } catch (err) {}
}

async function clearDB() {
  if (!KV_URL || !KV_TOKEN) {
    (global as any).ramMessagesDB = [];
    (global as any).ramProcessedMids = [];
    return;
  }
  await fetch(`${KV_URL}/del/messagesDB`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}` }
  });
  await fetch(`${KV_URL}/del/processedMids`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}` }
  });
}
// ------------------------------------------------

// Hàm gửi tin nhắn qua Facebook Send API
async function callSendAPI(senderId: string, messageText: string, messagesDB: any[]) {
  const PAGE_ACCESS_TOKEN = process.env.FB_PAGE_ACCESS_TOKEN;
  
  if (!PAGE_ACCESS_TOKEN) {
    console.error('❌ Thiếu biến môi trường FB_PAGE_ACCESS_TOKEN');
    return false;
  }

  const replyText = `Cảm ơn bạn đã nhắn: "${messageText}". Bot đã nhận được tin nhắn!`;
  console.log(`[BOT TRẢ LỜI] -> "${replyText}" (Tới ID: ${senderId})`);

  const requestBody = {
    recipient: { id: senderId },
    messaging_type: 'RESPONSE',
    message: { text: replyText },
  };

  try {
    const response = await fetch(
      `https://graph.facebook.com/v21.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      }
    );

    if (response.ok) {
      console.log('✅ TRẠNG THÁI: Gửi tin nhắn thành công!');
      messagesDB.push({
        type: 'bot',
        text: replyText,
        senderId: senderId,
        time: new Date().toISOString()
      });
      return true;
    } else {
      const errorData = await response.json();
      console.error('❌ TRẠNG THÁI: Gửi tin nhắn thất bại:', errorData);
      return false;
    }
  } catch (error) {
    console.error('❌ Lỗi hệ thống khi gọi Send API:', error);
    return false;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const path = req.url?.split('?')[0];

  // ==========================================
  // API GIAO DIỆN WEB (/api/messages)
  // ==========================================
  if (path === '/api/messages') {
    // Chống cache cho API
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    if (req.method === 'GET') {
      const dbMessages = await getMessagesFromDB();
      console.log(`🌐 /api/messages Đã đọc ${dbMessages.length} tin nhắn từ Database.`);
      return res.status(200).json(dbMessages);
    } else if (req.method === 'DELETE') {
      await clearDB();
      console.log(`🗑️ Đã xoá toàn bộ Database.`);
      return res.status(200).json({ success: true });
    }
  }

  // ==========================================
  // XÁC MINH WEBHOOK (GET)
  // ==========================================
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    const FB_VERIFY_TOKEN = process.env.FB_VERIFY_TOKEN;

    if (mode === 'subscribe' && token === FB_VERIFY_TOKEN) {
      console.log('✅ Webhook Verified!');
      return res.status(200).send(challenge);
    } else if (mode) {
      console.error('❌ Xác minh Webhook thất bại. Token không khớp.');
      return res.status(403).send('Forbidden');
    }
  }

  // ==========================================
  // XỬ LÝ NHẬN TIN NHẮN (POST)
  // ==========================================
  if (req.method === 'POST') {
    const body = req.body;

    if (body.object === 'page') {
      const promises: Promise<any>[] = [];
      let dbUpdated = false;

      // Kéo Database về trước khi xử lý
      const messagesDB = await getMessagesFromDB();
      const processedMids = await getProcessedMids();

      body.entry?.forEach((entry: any) => {
        entry.messaging?.forEach((webhookEvent: any) => {
          if (webhookEvent.message?.is_echo) {
            console.log('🔄 Bỏ qua tin nhắn echo từ chính Fanpage gửi.');
            return;
          }

          if (webhookEvent.message && webhookEvent.message.text) {
            const senderId = webhookEvent.sender?.id;
            const messageText = webhookEvent.message?.text;
            const messageMid = webhookEvent.message?.mid;

            // Kiểm tra trùng lặp
            if (messageMid) {
              if (processedMids.includes(messageMid)) {
                console.log(`⏩ Bỏ qua tin nhắn trùng lặp (MID: ${messageMid})`);
                return;
              }
              processedMids.push(messageMid);
            }

            console.log('\n--- TIN KHÁCH GỬI ---');
            console.log(`Sender ID: ${senderId}`);
            if (messageMid) console.log(`Message MID: ${messageMid}`);
            console.log(`Text: "${messageText}"`);

            // Thêm tin nhắn của khách vào array DB tạm thời
            messagesDB.push({
              type: 'user',
              text: messageText,
              senderId: senderId,
              time: new Date().toISOString()
            });
            dbUpdated = true;
            
            // Push tác vụ gửi trả lời khách (Truyền messagesDB vào để nếu bot nhắn thành công, nó lưu log bot luôn)
            promises.push(callSendAPI(senderId, messageText, messagesDB));
          }
        });
      });

      // Chờ tất cả bot reply API hoàn thành
      await Promise.all(promises);

      // Lưu đè lại array vào DB nếu có tin mới
      if (dbUpdated) {
        await saveMessagesToDB(messagesDB);
        await saveProcessedMids(processedMids);
      }

      return res.status(200).send('EVENT_RECEIVED');
    } else {
      return res.status(404).send('Not Found');
    }
  }

  return res.status(405).send('Method Not Allowed');
}
