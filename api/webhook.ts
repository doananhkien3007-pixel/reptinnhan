import type { VercelRequest, VercelResponse } from '@vercel/node';

export default function handler(req: VercelRequest, res: VercelResponse) {
  // Luôn luôn trả về 200 nếu không phải POST để tránh lỗi linh tinh, hoặc từ chối.
  // Nhưng theo yêu cầu: "Chỉ giữ POST /api/webhook"
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  const body = req.body;

  // Log ngay khi có request POST
  console.log("FACEBOOK WEBHOOK RECEIVED");
  console.log(JSON.stringify(body, null, 2));

  if (body && body.object === 'page' && body.entry) {
    body.entry.forEach((entry: any) => {
      const webhookEvent = entry.messaging?.[0];
      
      if (webhookEvent && webhookEvent.message) {
        // Bỏ qua message.is_echo
        if (!webhookEvent.message.is_echo) {
          const senderId = webhookEvent.sender?.id;
          const recipientId = webhookEvent.recipient?.id;
          const messageId = webhookEvent.message?.mid;
          const text = webhookEvent.message?.text;
          const timestamp = webhookEvent.timestamp;

          console.log(`PSID: ${senderId} | Page ID: ${recipientId} | Message ID: ${messageId} | Text: ${text} | Timestamp: ${timestamp}`);
        }
      }
    });
  }

  // Luôn trả HTTP 200 nhanh (kể cả không có message)
  return res.status(200).send('EVENT_RECEIVED');
}
