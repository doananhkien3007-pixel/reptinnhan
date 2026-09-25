import { NextResponse } from 'next/server';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const mode = searchParams.get('hub.mode');
    const token = searchParams.get('hub.verify_token');
    const challenge = searchParams.get('hub.challenge');

    const VERIFY_TOKEN = process.env.FB_VERIFY_TOKEN || 'anhkien123';

    if (mode && token) {
      if (mode === 'subscribe' && token === VERIFY_TOKEN) {
        console.log('WEBHOOK_VERIFIED');
        return new NextResponse(challenge, { status: 200 });
      } else {
        return new NextResponse('Forbidden', { status: 403 });
      }
    }

    return new NextResponse('Bad Request', { status: 400 });
  } catch (error) {
    console.error('Error in GET webhook:', error);
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}

export async function POST(req: Request) {
  console.log("POST /api/webhook received");
  try {
    const body = await req.json();

    console.log('--- RAW WEBHOOK BODY ---');
    console.log(JSON.stringify(body, null, 2));

    if (body.object === 'page') {
      if (Array.isArray(body.entry)) {
        body.entry.forEach((entry: any) => {
          if (Array.isArray(entry.messaging)) {
            entry.messaging.forEach((event: any) => {
              // Bỏ qua message có is_echo === true (do page tự gửi)
              if (event.message?.is_echo === true) {
                return;
              }

              // Xử lý khi có event.message
              if (event.message) {
                // Nếu là tin nhắn text
                if (event.message.text) {
                  const senderId = event.sender?.id;
                  const recipientId = event.recipient?.id;
                  const messageId = event.message.mid;
                  const text = event.message.text;

                  console.log('--- MESSENGER WEBHOOK ---');
                  console.log(`Sender ID: ${senderId}`);
                  console.log(`Recipient/Page ID: ${recipientId}`);
                  console.log(`Message ID: ${messageId}`);
                  console.log(`Text: ${text}`);
                } else {
                  // Log debug nếu event không phải là tin nhắn text (ví dụ sticker, hình ảnh...)
                  console.log('Received non-text message event (e.g., attachment):', Object.keys(event.message));
                }
              } else {
                // Log debug nếu event không phải message (ví dụ read receipt, delivery, v.v...)
                console.log('Received non-message event:', Object.keys(event));
              }
            });
          }
        });
      }
      
      // POST luôn trả HTTP 200 EVENT_RECEIVED nhanh nhất có thể
      return new NextResponse('EVENT_RECEIVED', { status: 200 });
    }

    return new NextResponse('Not Found', { status: 404 });
  } catch (error) {
    console.error('Error processing POST webhook:', error);
    // Vẫn trả về 200 để Facebook không spam retry
    return new NextResponse('EVENT_RECEIVED', { status: 200 });
  }
}
