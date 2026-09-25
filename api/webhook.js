// api/webhook.js

// Biến toàn cục lưu trữ tin nhắn tạm thời (sẽ mất khi Vercel restart)
if (!global.messages) {
  global.messages = [];
}

export default async function handler(req, res) {
  const VERIFY_TOKEN = process.env.FB_VERIFY_TOKEN || process.env.VERIFY_TOKEN || 'my_secure_verify_token';

  // 1. Xử lý yêu cầu xác minh từ Facebook (GET) VÀ trả về danh sách tin nhắn cho Web
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    const action = req.query['action'];

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
    const body = req.body;

    if (body.object === 'page') {
      for (const entry of body.entry) {
        const webhookEvent = entry.messaging[0];
        if (!webhookEvent) continue;
        
        const senderPsid = webhookEvent.sender?.id;

        // Nếu có tin nhắn văn bản
        if (webhookEvent.message && webhookEvent.message.text) {
          const receivedText = webhookEvent.message.text;
          
          // LƯU TIN NHẮN VÀO BỘ NHỚ (Để hiển thị lên trang chủ)
          const currentTime = new Date().toLocaleTimeString('vi-VN');
          global.messages.push({
            senderId: senderPsid,
            text: receivedText,
            time: currentTime
          });
          
          console.log(`Đã lưu tin nhắn hiển thị lên Web: ${receivedText}`);
          // ĐÃ XOÁ BỎ HOÀN TOÀN TÍNH NĂNG TỰ ĐỘNG NHẮN TIN TRẢ LỜI LẠI KHÁCH HÀNG.
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
