import type { VercelRequest, VercelResponse } from '@vercel/node';
import axios from 'axios';

// Token dùng để xác minh webhook với Facebook
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
// Token của Fanpage dùng để gửi tin nhắn
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;

/**
 * Gửi tin nhắn trả lời lại người dùng
 */
async function callSendAPI(senderPsid: string, response: any) {
  if (!PAGE_ACCESS_TOKEN) {
    console.error('Missing PAGE_ACCESS_TOKEN');
    return;
  }

  const requestBody = {
    recipient: {
      id: senderPsid,
    },
    message: response,
  };

  try {
    await axios.post(
      'https://graph.facebook.com/v21.0/me/messages',
      requestBody,
      {
        params: { access_token: PAGE_ACCESS_TOKEN },
      }
    );
    console.log('Message sent!');
  } catch (error: any) {
    console.error('Unable to send message:', error.response?.data || error.message);
  }
}

/**
 * Xử lý sự kiện tin nhắn tới
 */
async function handleMessage(senderPsid: string, receivedMessage: any) {
  let response;

  // Kiểm tra nếu tin nhắn có chứa text
  if (receivedMessage.text) {
    // Tạo payload phản hồi (Echo lại tin nhắn người dùng)
    response = {
      text: `Bạn vừa nhắn: "${receivedMessage.text}". Hiện tại hệ thống đang được phát triển!`,
    };
  } else if (receivedMessage.attachments) {
    // Nếu tin nhắn là file đính kèm
    response = {
      text: 'Cảm ơn bạn đã gửi file đính kèm. Hiện tại tôi chỉ có thể xử lý tin nhắn văn bản.',
    };
  }

  // Gửi tin nhắn trả lại
  if (response) {
    await callSendAPI(senderPsid, response);
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // 1. Xử lý yêu cầu xác minh Webhook từ Facebook (Method GET)
  if (req.method === 'GET') {
    // Parse các query string do Facebook gửi
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    // Kiểm tra xem mode và token có tồn tại không
    if (mode && token) {
      // Kiểm tra mode là 'subscribe' và token khớp
      if (mode === 'subscribe' && token === VERIFY_TOKEN) {
        console.log('WEBHOOK_VERIFIED');
        // Phản hồi lại với mã challenge do FB gửi kèm HTTP 200
        return res.status(200).send(challenge);
      } else {
        // Phản hồi HTTP 403 Forbidden nếu token không khớp
        return res.status(403).send('Forbidden');
      }
    }
    return res.status(400).send('Bad Request');
  }

  // 2. Xử lý các sự kiện tin nhắn tới từ Facebook (Method POST)
  if (req.method === 'POST') {
    const body = req.body;

    // Kiểm tra xem đây có phải là sự kiện từ một Page (Fanpage) không
    if (body.object === 'page') {
      // Duyệt qua tất cả các entry (có thể có nhiều nếu batch)
      body.entry.forEach((entry: any) => {
        // Lấy sự kiện tin nhắn (thường chỉ có 1 trong mảng messaging)
        const webhookEvent = entry.messaging[0];
        console.log('Webhook event received:', webhookEvent);

        // Lấy ID của người gửi (PSID - Page-Scoped ID)
        const senderPsid = webhookEvent.sender.id;
        console.log('Sender PSID:', senderPsid);

        // Xử lý sự kiện nếu đó là tin nhắn
        if (webhookEvent.message) {
          handleMessage(senderPsid, webhookEvent.message);
        }
      });

      // Luôn phải trả về '200 OK' cho Facebook trong vòng 20 giây
      // để thông báo là đã nhận được sự kiện
      return res.status(200).send('EVENT_RECEIVED');
    } else {
      // Trả về 404 nếu không phải sự kiện từ Page
      return res.status(404).send('Not Found');
    }
  }

  // Nếu không phải GET hoặc POST
  return res.status(405).send('Method Not Allowed');
}
