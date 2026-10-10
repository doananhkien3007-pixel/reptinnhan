import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { createLabStore } from './store.js';
import { CloudLabService } from './service.js';
import { catalog, defaultModel, fail, uuid } from './settings.js';
import { PERSONA_VERSION } from '../persona.js';

const cookieName = 'emi_lab_session';
const sign = (id, secret) => createHmac('sha256', secret).update(id).digest('hex');
function session(req, res, secret, allowCreate) {
  const value = (req.headers.cookie || '').split(';').map(v => v.trim()).find(v => v.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
  const [id, signature] = (value || '').split('.');
  if (id && signature && /^[0-9a-f-]{36}$/.test(id) && /^[0-9a-f]{64}$/.test(signature) && timingSafeEqual(Buffer.from(signature), Buffer.from(sign(id, secret)))) return id;
  if (!allowCreate) fail(401, 'Phiên Lab đã hết hạn. Tải lại trang để mở phiên mới.');
  const fresh = randomUUID();
  const secure = process.env.VERCEL || req.headers['x-forwarded-proto'] === 'https';
  res.setHeader('Set-Cookie', `${cookieName}=${fresh}.${sign(fresh, secret)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=7776000${secure ? '; Secure' : ''}`);
  return fresh;
}
async function readBody(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) fail(415, 'Yêu cầu application/json.');
  let raw = '';
  if (req.body !== undefined) raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
  else for await (const chunk of req) { raw += chunk; if (Buffer.byteLength(raw) > 12000) fail(413, 'Tin nhắn quá lớn.'); }
  if (Buffer.byteLength(raw) > 12000) fail(413, 'Tin nhắn quá lớn.');
  let body;
  try { body = JSON.parse(raw); } catch { fail(400, 'JSON không hợp lệ.'); }
  if (!body || Array.isArray(body) || typeof body !== 'object') fail(400, 'Body không hợp lệ.');
  return body;
}
export function createCloudHandler({ storeFactory = createLabStore, brain, sessionSecret = () => process.env.EMI_LAB_SESSION_SECRET } = {}) {
  return async (req, res) => {
    const send = (status, value) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(value)); };
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      const secret = sessionSecret();
      if (!secret || secret.length < 32) fail(503, 'Thiếu EMI_LAB_SESSION_SECRET (ít nhất 32 ký tự) phía server.');
      if (!['GET', 'POST'].includes(req.method)) { res.setHeader('Allow', 'GET, POST'); fail(405, 'Method không hỗ trợ.'); }
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const action = url.searchParams.get('action') || 'bootstrap';
      if (req.method === 'POST') {
        let origin;
        try { origin = new URL(req.headers.origin); } catch { fail(403, 'Origin không hợp lệ.'); }
        if (origin.host !== req.headers.host || !['https:', 'http:'].includes(origin.protocol) || req.headers['sec-fetch-site'] === 'cross-site') fail(403, 'Origin không hợp lệ.');
      }
      const sessionId = session(req, res, secret, req.method === 'GET' && action === 'bootstrap');
      const store = storeFactory();
      const service = new CloudLabService(store, brain);
      if (req.method === 'GET' && action === 'bootstrap') return send(200, { products: catalog.products, catalog_notice: catalog.notice, persona: 'Emi House · xưng em, gọi chị · tư vấn chủ động theo toàn bộ ngữ cảnh', persona_version: PERSONA_VERSION, default_model: defaultModel(), max_custom_instructions: 8000, openai_ready: !!process.env.OPENAI_API_KEY, conversations: await store.list(sessionId) });
      if (req.method === 'GET' && action === 'conversation') return send(200, { conversation: await store.get(sessionId, uuid(url.searchParams.get('id'))) });
      if (req.method !== 'POST') fail(404, 'Route không có trong Lab.');
      const body = await readBody(req);
      if (action === 'create') return send(201, { conversation: await service.create(sessionId, body) });
      if (action === 'turn') return send(200, await service.turn(sessionId, uuid(body.conversation_id), body));
      fail(404, 'Route không có trong Lab.');
    } catch (error) {
      const status = Number.isInteger(error.status) && error.status >= 400 && error.status <= 599 ? error.status : 500;
      send(status, { error: status === 500 ? 'Lượt chưa hoàn tất. Hội thoại cũ vẫn được giữ; thử lại hoặc kiểm tra log phía server.' : error.message });
    }
  };
}
