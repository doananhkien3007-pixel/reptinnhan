import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // 1. Xác minh Webhook (Method GET)
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    // Dùng biến môi trường FB_VERIFY_TOKEN
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
      body.entry?.forEach((entry: any) => {
        entry.messaging?.forEach((webhookEvent: any) => {
          // Bỏ qua tin nhắn do chính Page gửi (echo)
          if (webhookEvent.message?.is_echo) {
            console.log('Bỏ qua tin nhắn echo từ Fanpage.');
            return;
          }

          if (webhookEvent.message) {
            const senderId = webhookEvent.sender?.id;
            const messageText = webhookEvent.message?.text;
            const messageMid = webhookEvent.message?.mid;

            // Log tin nhắn ra Vercel Logs
            console.log('--- TIN NHẮN MỚI ---');
            console.log(`Sender ID: ${senderId}`);
            console.log(`Message ID (MID): ${messageMid}`);
            console.log(`Text: ${messageText}`);
            console.log('--------------------');
          }
        });
      });

      // Bắt buộc trả về 200 OK cho Facebook biết đã nhận được
      return res.status(200).send('EVENT_RECEIVED');
    } else {
      return res.status(404).send('Not Found');
    }
  }

  return res.status(405).send('Method Not Allowed');
}
