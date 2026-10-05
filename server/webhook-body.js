import { createHmac, timingSafeEqual } from 'node:crypto';

// Vercel bodyParser is disabled so signature verification uses the original bytes.
export async function readWebhookBody(req, verifySignature) {
  let raw;
  if (Buffer.isBuffer(req.body)) raw = req.body;
  else if (req.body === undefined && req[Symbol.asyncIterator]) {
    const chunks = []; let size = 0;
    for await (const chunk of req) {
      const bytes = Buffer.from(chunk); size += bytes.length;
      if (size > 1024 * 1024) throw new Error('Payload quá lớn.');
      chunks.push(bytes);
    }
    raw = Buffer.concat(chunks);
  }
  if (verifySignature) {
    const secret = process.env.FB_APP_SECRET;
    if (!secret) throw new Error('Thiếu FB_APP_SECRET để xác minh webhook tạo đơn.');
    const signature = req.headers?.['x-hub-signature-256'];
    if (!raw || !/^sha256=[0-9a-f]{64}$/i.test(signature || '')) throw new Error('Webhook thiếu chữ ký hợp lệ.');
    const actual = Buffer.from(signature.slice(7), 'hex');
    const expected = createHmac('sha256', secret).update(raw).digest();
    if (!timingSafeEqual(actual, expected)) throw new Error('Chữ ký webhook không hợp lệ.');
  }
  if (raw) {
    const text = raw.toString('utf8').trim();
    // Management actions such as toggling auto-reply legitimately send an
    // empty POST body. Treat that as an empty object instead of parsing an
    // empty string as JSON.
    req.body = text ? JSON.parse(text) : {};
  }
}
