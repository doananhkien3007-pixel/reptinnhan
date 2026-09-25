import type { VercelRequest, VercelResponse } from '@vercel/node';

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
  // 1. Xác minh Webhook (Method GET) - Giữ nguyên
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    const FB_VERIFY_TOKEN = process.env.FB_VERIFY_TOKEN;

    if (mode === 'subscribe' && token === FB_VERIFY_TOKEN) {
      console.log('✅ Webhook Verified!');
      return res.status(200).send(challenge);
    } else {
      console.error('❌ Xác minh Webhook thất bại. Token không khớp.');
      return res.status(403).send('Forbidden');
    }
  }

  // 2. Nhận tin nhắn từ Fanpage (Method POST)
  if (req.method === 'POST') {
    const body = req.body;

    if (body.object === 'page') {
      // Mảng chứa các promise để chờ (await) Vercel không ngắt function sớm
      const promises: Promise<any>[] = [];

      body.entry?.forEach((entry: any) => {
        entry.messaging?.forEach((webhookEvent: any) => {
          // Bỏ qua tin nhắn do chính Page gửi (echo) để tránh bot tự trả lời tạo vòng lặp
          if (webhookEvent.message?.is_echo) {
            console.log('🔄 Bỏ qua tin nhắn echo từ chính Fanpage gửi.');
            return;
          }

          // Kiểm tra xem có text gửi tới không
          if (webhookEvent.message && webhookEvent.message.text) {
            const senderId = webhookEvent.sender?.id;
            const messageText = webhookEvent.message?.text;

            console.log('\n--- TIN KHÁCH GỬI ---');
            console.log(`Sender ID: ${senderId}`);
            console.log(`Text: "${messageText}"`);
            
            // Xử lý gửi trả lời khách
            promises.push(callSendAPI(senderId, messageText));
          }
        });
      });

      // Bắt buộc phải await để các tác vụ gọi Facebook API hoàn thành 
      // trước khi Vercel đóng kết nối Serverless function
      await Promise.all(promises);

      // Trả về 200 OK cho Facebook biết đã nhận được và xử lý xong
      return res.status(200).send('EVENT_RECEIVED');
    } else {
      return res.status(404).send('Not Found');
    }
  }

  return res.status(405).send('Method Not Allowed');
}
