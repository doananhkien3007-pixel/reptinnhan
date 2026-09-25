import type { VercelRequest, VercelResponse } from '@vercel/node';

export default function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'POST') {
    console.log('===== FACEBOOK WEBHOOK RECEIVED =====');

    const body = req.body;

    console.log('FULL BODY:', JSON.stringify(body, null, 2));

    if (!body) {
      console.log('Không có body');
      return res.status(400).send('Bad Request');
    }

    // Facebook Messenger webhook
    if (body.object === 'page') {
      body.entry?.forEach((entry: any) => {
        entry.messaging?.forEach((event: any) => {

          console.log('FULL EVENT:', JSON.stringify(event, null, 2));

          // Bỏ qua tin nhắn do chính Page gửi
          if (event.message?.is_echo) {
            console.log('Bỏ qua echo message');
            return;
          }

          const senderId = event.sender?.id;
          const pageId = event.recipient?.id;
          const messageId = event.message?.mid;
          const messageText = event.message?.text;
          const timestamp = event.timestamp;

          console.log('----- TIN NHẮN KHÁCH -----');
          console.log('Sender ID:', senderId);
          console.log('Page ID:', pageId);
          console.log('Message ID:', messageId);
          console.log('Text:', messageText);
          console.log('Timestamp:', timestamp);
          console.log('--------------------------');
        });
      });

      return res.status(200).send('EVENT_RECEIVED');
    }

    // Không phải Page event vẫn trả 200
    console.log('Unknown object:', body.object);
    return res.status(200).send('EVENT_RECEIVED');
  }

  return res.status(405).send('Method Not Allowed');
}
