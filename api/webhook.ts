import type { VercelRequest, VercelResponse } from '@vercel/node';

export default function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'GET') {
    // Xác minh Webhook từ Facebook
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    const verifyToken = process.env.FB_VERIFY_TOKEN;

    if (mode === 'subscribe' && token === verifyToken) {
      console.log('WEBHOOK_VERIFIED');
      return res.status(200).send(challenge);
    } else {
      return res.status(403).json({ error: 'Verification failed' });
    }
  } else if (req.method === 'POST') {
    const body = req.body;

    // Kiểm tra xem đây có phải là sự kiện từ Page không
    if (body.object === 'page') {
      body.entry?.forEach((entry: any) => {
        const webhookEvent = entry.messaging?.[0];
        
        // Bỏ qua event không có message và message có is_echo
        if (webhookEvent && webhookEvent.message && !webhookEvent.message.is_echo) {
          const senderId = webhookEvent.sender?.id;
          const recipientId = webhookEvent.recipient?.id;
          const messageId = webhookEvent.message?.mid;
          const text = webhookEvent.message?.text;
          const timestamp = webhookEvent.timestamp;

          // Log ra định dạng: PSID | Page ID | Message ID | Text
          console.log(`${senderId} | ${recipientId} | ${messageId} | ${text}`);
          
          // Bạn có thể sử dụng các biến môi trường này cho các tác vụ tiếp theo (ví dụ: gọi Send API)
          // const pageAccessToken = process.env.FB_PAGE_ACCESS_TOKEN;
          // const appSecret = process.env.FB_APP_SECRET;
        }
      });

      // Luôn trả HTTP 200 nhanh để Facebook không gửi lại webhook
      return res.status(200).send('EVENT_RECEIVED');
    } else {
      return res.status(404).send('Not Found');
    }
  } else {
    // Trả về lỗi nếu không phải là GET hoặc POST
    return res.status(405).json({ error: 'Method Not Allowed' });
  }
}
