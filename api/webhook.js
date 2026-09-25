// api/webhook.js

// Biến toàn cục để lưu trữ tin nhắn tạm thời (sẽ mất khi Vercel restart)
if (!global.messages) {
  global.messages = [];
}

export default async function handler(req, res) {
  const VERIFY_TOKEN = process.env.FB_VERIFY_TOKEN || process.env.VERIFY_TOKEN || 'my_secure_verify_token';
  const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN || 'EAASc7lUnpQkBSuQP9iIBVendAAjT6ZCloI4jikrQZBwjn1wvdMULE7QnDFGoEVDfbOrZBlj7gulkvZBX8szZC32dJCLxZBcyTPkzUbaCrSwORL93SXyshKVKOf30JScTJVNG5ar4TY86mIZC4lpbz58mhey7MNEdDcfZBliyfiwS6lKcu3qkKZANkkcWhuT0huzFIzznUg0qMHDXKaoVb4UoF5AZDZD';

  // 1. Xử lý yêu cầu xác minh từ Facebook (GET) VÀ Giao diện Web hiển thị tin nhắn
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    const action = req.query['action'];

    // Nếu là Facebook xác minh Webhook
    if (mode && token) {
      if (mode === 'subscribe' && token === VERIFY_TOKEN) {
        console.log('WEBHOOK_VERIFIED');
        return res.status(200).send(challenge);
      } else {
        return res.status(403).send('Forbidden');
      }
    }
    
    // Nếu gọi API để lấy danh sách tin nhắn dạng JSON
    if (action === 'get_messages') {
      return res.status(200).json(global.messages);
    }

    // Nếu người dùng truy cập trực tiếp bằng trình duyệt -> Hiển thị Giao diện Web
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(`
      <!DOCTYPE html>
      <html lang="vi">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Tin nhắn từ Facebook</title>
        <style>
          body { font-family: Arial, sans-serif; background: #f0f2f5; padding: 20px; }
          .container { max-width: 600px; margin: 0 auto; background: white; padding: 20px; border-radius: 10px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
          h2 { color: #1877f2; text-align: center; }
          .message { background: #e4e6eb; padding: 10px 15px; border-radius: 15px; margin-bottom: 10px; display: inline-block; max-width: 80%; }
          .message-row { margin-bottom: 15px; }
          .time { font-size: 11px; color: #65676b; margin-left: 5px; }
          .sender { font-size: 12px; font-weight: bold; color: #1877f2; margin-bottom: 2px; }
          #chat-box { height: 400px; overflow-y: auto; padding-right: 10px; }
        </style>
      </head>
      <body>
        <div class="container">
          <h2>💬 Tin nhắn từ Khách hàng</h2>
          <div id="chat-box">Đang tải tin nhắn...</div>
        </div>

        <script>
          async function fetchMessages() {
            try {
              const res = await fetch('/api/webhook?action=get_messages');
              const messages = await res.json();
              
              const chatBox = document.getElementById('chat-box');
              if (messages.length === 0) {
                chatBox.innerHTML = '<p style="text-align:center; color:#65676b;">Chưa có tin nhắn nào.</p>';
                return;
              }

              chatBox.innerHTML = messages.map(msg => 
                '<div class="message-row">' +
                  '<div class="sender">ID Khách: ' + msg.senderId + ' <span class="time">' + msg.time + '</span></div>' +
                  '<div class="message">' + msg.text + '</div>' +
                '</div>'
              ).join('');
              
              // Tự động cuộn xuống dưới cùng
              chatBox.scrollTop = chatBox.scrollHeight;
            } catch (err) {
              console.error('Lỗi khi lấy tin nhắn', err);
            }
          }

          // Gọi lần đầu tiên
          fetchMessages();
          
          // Tự động làm mới mỗi 3 giây
          setInterval(fetchMessages, 3000);
        </script>
      </body>
      </html>
    `);
  }

  // 2. Xử lý tin nhắn đến từ Facebook (POST)
  if (req.method === 'POST') {
    const body = req.body;

    if (body.object === 'page') {
      for (const entry of body.entry) {
        const webhookEvent = entry.messaging[0];
        if (!webhookEvent) continue;
        
        const senderPsid = webhookEvent.sender?.id;

        if (webhookEvent.message && webhookEvent.message.text) {
          const receivedText = webhookEvent.message.text;
          
          // LƯU TIN NHẮN VÀO BỘ NHỚ (Để hiển thị lên web)
          const currentTime = new Date().toLocaleTimeString('vi-VN');
          global.messages.push({
            senderId: senderPsid,
            text: receivedText,
            time: currentTime
          });
          
          // Gửi tin nhắn trả lời
          if (PAGE_ACCESS_TOKEN && senderPsid) {
            await callSendAPI(senderPsid, \`Chào bạn, mình đã nhận được tin nhắn: "\${receivedText}"\`, PAGE_ACCESS_TOKEN);
          }
        }
      }

      return res.status(200).send('EVENT_RECEIVED');
    } else {
      return res.status(404).send('Not Found');
    }
  }

  res.setHeader('Allow', ['GET', 'POST']);
  return res.status(405).end(\`Method \${req.method} Not Allowed\`);
}

// Hàm gọi Facebook Graph API để gửi tin nhắn
async function callSendAPI(senderPsid, textMessage, pageAccessToken) {
  const requestBody = {
    recipient: { id: senderPsid },
    message: { text: textMessage }
  };
  const url = \`https://graph.facebook.com/v19.0/me/messages?access_token=\${pageAccessToken}\`;
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
