import { NextResponse } from 'next/server';

// 1. GET handler for Facebook Webhook Verification
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    
    const mode = searchParams.get('hub.mode');
    const token = searchParams.get('hub.verify_token');
    const challenge = searchParams.get('hub.challenge');

    const verifyToken = process.env.FB_VERIFY_TOKEN;

    if (mode && token) {
      if (mode === 'subscribe' && token === verifyToken) {
        console.log('✅ WEBHOOK_VERIFIED');
        // Return the challenge token from the request
        return new NextResponse(challenge, { status: 200 });
      } else {
        // Responds with '403 Forbidden' if verify tokens do not match
        console.log('❌ WEBHOOK_VERIFICATION_FAILED');
        return new NextResponse('Forbidden', { status: 403 });
      }
    }

    return new NextResponse('Bad Request', { status: 400 });
  } catch (error) {
    console.error('Error verifying webhook:', error);
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}

// 2. POST handler for receiving messages
export async function POST(request: Request) {
  try {
    const body = await request.json();

    // Check if this is an event from a page subscription
    if (body.object === 'page') {
      
      // Iterate over each entry - there may be multiple if batched
      body.entry?.forEach((entry: any) => {
        const page_id = entry.id;
        
        // Get the webhook event. entry.messaging is an array, but 
        // will only ever contain one event, so we get index 0
        const webhook_event = entry.messaging?.[0];

        if (webhook_event) {
          const sender_id = webhook_event.sender?.id;
          const timestamp = webhook_event.timestamp;
          
          if (webhook_event.message) {
            const message_id = webhook_event.message.mid;
            const message_text = webhook_event.message.text;

            if (message_text) {
              // Parse and log exactly as requested
              console.log('\n--- 💬 NEW MESSAGE RECEIVED ---');
              console.log(`- Page ID: ${page_id}`);
              console.log(`- Sender ID: ${sender_id}`);
              console.log(`- Message ID: ${message_id}`);
              console.log(`- Text: "${message_text}"`);
              console.log(`- Timestamp: ${timestamp}`);
              console.log('-------------------------------\n');
            } else {
              console.log('⚠️ Received non-text message event (e.g. attachment, sticker)');
            }
          } else {
            console.log('⚠️ Received non-message event (e.g. delivery, read receipt)');
          }
        }
      });

      // Return a '200 OK' response to all requests
      // This is crucial! FB needs a 200 OK quickly, otherwise it will retry
      return new NextResponse('EVENT_RECEIVED', { status: 200 });
    } else {
      // Return a '404 Not Found' if event is not from a page subscription
      return new NextResponse('Not Found', { status: 404 });
    }
  } catch (error) {
    console.error('❌ Error processing webhook event:', error);
    // FB recommends returning 200 even on error to avoid unnecessary retries,
    // but 500 can be used if you want them to retry. Returning 200 here for stability.
    return new NextResponse('EVENT_RECEIVED_WITH_ERROR', { status: 200 });
  }
}
