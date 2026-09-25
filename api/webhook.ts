import type { VercelRequest, VercelResponse } from '@vercel/node';

export default function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'POST') {
    console.log('=== FACEBOOK POST WEBHOOK ===');
    console.log('BODY:', JSON.stringify(req.body, null, 2));

    const body = req.body;

    if (!body) {
      return res.status(400).send('Bad Request');
    }

    if (body.object !== 'page') {
      console.log('Not page event:', body.object);
      return res.status(200).send('EVENT_RECEIVED');
    }

    body.entry?.forEach((entry: any) => {
      entry.messaging?.forEach((event: any) => {

        console.log('EVENT:', JSON.stringify(event, null, 2));

        if (event.message?.is_echo) {
          console.log('Ignore echo');
          return;
        }

        const senderId = event.sender?.id;
        const recipientId = event.recipient?.id;
        const messageId = event.message?.mid;
        const messageText = event.message?.text;
        const timestamp = event.timestamp;

        console.log('--- TIN KHÁCH GỬI ---');
        console.log('Sender ID:', senderId);
        console.log('Page ID:', recipientId);
        console.log('Message ID:', messageId);
        console.log('Text:', messageText);
        console.log('Timestamp:', timestamp);
      });
    });

    // Trả Facebook 200 ngay
    return res.status(200).send('EVENT_RECEIVED');
  }

  return res.status(405).send('Method Not Allowed');
}
