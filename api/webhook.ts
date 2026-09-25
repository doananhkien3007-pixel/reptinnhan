import type { VercelRequest, VercelResponse } from '@vercel/node';

// Biến global lưu tạm tin nhắn trên RAM (Chỉ dùng để test/prototype, có thể mất khi server sleep)
(global as any).messagesDB = (global as any).messagesDB || [];

// Biến global lưu các mid đã xử lý để tránh gửi trùng lặp
(global as any).processedMids = (global as any).processedMids || new Set();

// Hàm gửi tin nhắn qua Facebook Send API
async function callSendAPI(senderId: string, messageText: string) {
  const PAGE_ACCESS_TOKEN = process.env.FB_PAGE_ACCESS_TOKEN;
  
  if (!PAGE_ACCESS_TOKEN) {
    console.error('❌ Thiếu biến môi trường FB_PAGE_ACCESS_TOKEN');
    return false;
  }

  // Tự tạo nội dung trả lời dựa trên tin nhắn khách
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
      // Lưu lại tin nhắn bot gửi
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
  const path = req.url?.split('?')[0];

  // API lấy danh sách tin nhắn để hiển thị lên Web
  if (path === '/api/messages') {
    if (req.method === 'GET') {
      return res.status(200).json((global as any).messagesDB);
    } else if (req.method === 'DELETE') {
      (global as any).messagesDB = [];
      (global as any).processedMids.clear();
      return res.status(200).json({ success: true });
    }
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
    }
  }

  // 2. Nhận tin nhắn từ Fanpage (Method POST)
  if (req.method === 'POST') {
    const body = req.body;

    if (body.object === 'page') {
      const promises: Promise<any>[] = [];

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

            // Kiểm tra trùng lặp bằng message.mid
            if (messageMid) {
              if ((global as any).processedMids.has(messageMid)) {
                console.log(`⏩ Bỏ qua tin nhắn trùng lặp (MID: ${messageMid})`);
                return;
              }
              (global as any).processedMids.add(messageMid);
            }

            console.log('\n--- TIN KHÁCH GỬI ---');
            console.log(`Sender ID: ${senderId}`);
            if (messageMid) console.log(`Message MID: ${messageMid}`);
            console.log(`Text: "${messageText}"`);

            // Lưu tin nhắn của khách vào biến global
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
