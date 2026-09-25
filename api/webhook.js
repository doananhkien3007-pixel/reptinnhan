// api/webhook.js

export default async function handler(req, res) {
  const VERIFY_TOKEN = process.env.FB_VERIFY_TOKEN || process.env.VERIFY_TOKEN || 'my_secure_verify_token';
  const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN || 'EAASc7lUnpQkBSuQP9iIBVendAAjT6ZCloI4jikrQZBwjn1wvdMULE7QnDFGoEVDfbOrZBlj7gulkvZBX8szZC32dJCLxZBcyTPkzUbaCrSwORL93SXyshKVKOf30JScTJVNG5ar4TY86mIZC4lpbz58mhey7MNEdDcfZBliyfiwS6lKcu3qkKZANkkcWhuT0huzFIzznUg0qMHDXKaoVb4UoF5AZDZD';

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
      for (const entry of body.entry) {
        const webhookEvent = entry.messaging[0];
        if (!webhookEvent) continue;
        
        console.log('Nhận được sự kiện webhook:', JSON.stringify(webhookEvent));
        
        const senderPsid = webhookEvent.sender?.id;

        if (webhookEvent.message && webhookEvent.message.text) {
          const receivedText = webhookEvent.message.text;
          console.log(`Sender PSID: ${senderPsid}, Nội dung tin nhắn: ${receivedText}`);
          
          // Gửi tin nhắn trả lời
          if (PAGE_ACCESS_TOKEN && senderPsid) {
            await callSendAPI(senderPsid, `Chào bạn, mình đã nhận được tin nhắn: "${receivedText}"`, PAGE_ACCESS_TOKEN);
          }
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

// Hàm gọi Facebook Graph API để gửi tin nhắn
async function callSendAPI(senderPsid, textMessage, pageAccessToken) {
  const requestBody = {
    recipient: { id: senderPsid },
    message: { text: textMessage }
  };
  const url = `https://graph.facebook.com/v19.0/me/messages?access_token=${pageAccessToken}`;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });
  } catch (error) {
    console.error('Lỗi kết nối khi gửi API:', error);
  }
}
