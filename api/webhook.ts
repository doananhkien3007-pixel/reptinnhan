import type { VercelRequest, VercelResponse } from '@vercel/node';

// Biến global lưu tạm tin nhắn trên RAM (Chỉ dùng để test/prototype, có thể mất khi server sleep)
(global as any).messagesDB = (global as any).messagesDB || [];

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
  // API lấy danh sách tin nhắn để hiển thị lên Web
  if (req.query.action === 'get_messages') {
    if (req.method === 'GET') {
      return res.status(200).json((global as any).messagesDB);
    } else if (req.method === 'DELETE') {
      (global as any).messagesDB = [];
      return res.status(200).json({ success: true });
    }
  }

  // 1. Xác minh Webhook (Method GET)
  if (req.method === 'GET') {
    console.log('--- NHẬN REQUEST GET (XÁC MINH) ---', req.query);
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
      // Nếu không có hub.mode, có thể ai đó vô tình truy cập GET /api/webhook
      return res.status(200).send('Webhook đang hoạt động (Chờ POST từ Facebook).');
    }
  }

  // 2. Nhận tin nhắn từ Fanpage (Method POST)
  if (req.method === 'POST') {
    console.log('--- NHẬN REQUEST POST TỪ FACEBOOK ---');
    console.log('Body:', JSON.stringify(req.body, null, 2));

    const body = req.body;

    // Trả về 400 nếu body rỗng
    if (!body) {
      console.error('❌ Body trống!');
      return res.status(400).send('Bad Request');
    }

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

            console.log('\n--- TIN KHÁCH GỬI ---');
            console.log(`Sender ID: ${senderId}`);
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
      console.log('✅ Đã xử lý xong POST request, trả về 200 OK cho Facebook.');
      return res.status(200).send('EVENT_RECEIVED');
    } else {
      console.error('❌ Event không phải từ Fanpage (object !== page)');
      return res.status(404).send('Not Found');
    }
  }

  return res.status(405).send('Method Not Allowed');
}
