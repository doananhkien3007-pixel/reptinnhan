// api/webhook.js

export default function handler(req, res) {
  const VERIFY_TOKEN = process.env.FB_VERIFY_TOKEN || process.env.VERIFY_TOKEN || 'my_secure_verify_token';

  // 1. Xử lý yêu cầu xác minh từ Facebook (GET)
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode && token) {
      if (mode === 'subscribe' && token === VERIFY_TOKEN) {
        console.log('WEBHOOK_VERIFIED');
        return res.status(200).send(challenge);
      } else {
        return res.status(403).send('Forbidden');
      }
    }
    return res.status(400).send('Bad Request');
  }

  // 2. Xử lý tin nhắn đến từ Facebook (POST)
  if (req.method === 'POST') {
    const body = req.body;

    if (body.object === 'page') {
      body.entry.forEach(function(entry) {
        const webhookEvent = entry.messaging[0];
        console.log('Nhận được sự kiện webhook:', webhookEvent);
        
        const senderPsid = webhookEvent.sender.id;
        console.log('Sender PSID: ' + senderPsid);

        if (webhookEvent.message && webhookEvent.message.text) {
          console.log('Nội dung tin nhắn: ' + webhookEvent.message.text);
          // TODO: Gọi API Facebook Graph để trả lời tin nhắn ở đây
        }
      });

      return res.status(200).send('EVENT_RECEIVED');
    } else {
      return res.status(404).send('Not Found');
    }
  }

  res.setHeader('Allow', ['GET', 'POST']);
  return res.status(405).end(`Method ${req.method} Not Allowed`);
}
