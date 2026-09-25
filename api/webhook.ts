import type { VercelRequest, VercelResponse } from '@vercel/node';

// Lưu tạm trên RAM của Vercel (chỉ hoạt động tốt nếu frontend và webhook chung 1 file)
(global as any).messagesDB = (global as any).messagesDB || [];

// Hàm gửi tin nhắn qua Facebook Send API
async function callSendAPI(senderId: string, messageText: string) {
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
      (global as any).messagesDB.push({
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
  res.setHeader('Cache-Control', 'no-store, max-age=0'); // Không cache

  // 0. API LẤY TIN NHẮN CHO FRONTEND
  if (req.query.action === 'get_messages') {
    if (req.method === 'GET') {
      const msgs = [...(global as any).messagesDB];
      // Sau khi frontend lấy xong, ta xoá RAM luôn để tránh lấy lại trùng lặp 
      // (vì frontend sẽ tự lưu vào localStorage của trình duyệt)
      (global as any).messagesDB = [];
      return res.status(200).json(msgs);
    }
    if (req.method === 'DELETE') {
      (global as any).messagesDB = [];
      return res.status(200).json({ success: true });
    }
    return res.status(405).send('Method Not Allowed');
  }

  // 1. Xác minh Webhook (Method GET)
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
    } else {
      return res.status(200).send('Webhook đang hoạt động (Chờ POST từ Facebook).');
    }
  }

  // 2. Nhận tin nhắn từ Fanpage (Method POST)
  if (req.method === 'POST') {
    console.log('POST /api/webhook');
    const body = req.body;
    if (!body) return res.status(400).send('Bad Request');

    if (body.object === 'page') {
      const promises: Promise<any>[] = [];

      body.entry?.forEach((entry: any) => {
        entry.messaging?.forEach((webhookEvent: any) => {
          if (webhookEvent.message?.is_echo) return;

          if (webhookEvent.message && webhookEvent.message.text) {
            const senderId = webhookEvent.sender?.id;
            const messageText = webhookEvent.message?.text;
            const messageId = webhookEvent.message?.mid;

            console.log('\n--- TIN KHÁCH GỬI ---');
            console.log(`Sender ID: ${senderId}`);
            console.log(`Message ID: ${messageId}`);
            console.log(`Text: "${messageText}"`);

            // Lưu vào RAM
            (global as any).messagesDB.push({
              type: 'user',
              text: messageText,
              senderId: senderId,
              time: new Date().toISOString()
            });
            
            promises.push(callSendAPI(senderId, messageText));
          }
        });
      });

      await Promise.all(promises);
      return res.status(200).send('EVENT_RECEIVED');
    } else {
      return res.status(404).send('Not Found');
    }
  }

  return res.status(405).send('Method Not Allowed');
}
