import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';

const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 20]), Buffer.from('ftypisom0000video')]);

test('upload file thẳng Facebook, chỉ lưu ID và không gọi Storage', async () => {
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SECRET_KEY = 'test-secret';
  process.env.PAGE_ACCESS_TOKEN = 'test-page-token';
  const originalFetch = globalThis.fetch;
  const originalError = console.error;
  console.error = () => {};
  const product = { images: [{ image_url: 'old.jpg', facebook_attachment_id: 'old-image' }] };
  let facebookResult = { attachment_id: 'video-attachment' };
  let facebookStatus = 200;
  const graphRequests = [];
  const storageRequests = [];
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    const method = init.method || 'GET';
    if (url.hostname === 'graph.facebook.com') {
      assert.match(url.pathname, /\/me\/message_attachments$/);
      assert.equal(url.searchParams.has('access_token'), false);
      assert.equal(init.headers.Authorization, 'Bearer test-page-token');
      assert.ok(init.body instanceof FormData);
      assert.deepEqual(JSON.parse(init.body.get('message')), {
        attachment: { type: 'video', payload: { is_reusable: true } }
      });
      const file = init.body.get('filedata');
      assert.equal(file.type, 'video/mp4');
      assert.deepEqual(Buffer.from(await file.arrayBuffer()), mp4);
      graphRequests.push(init.body);
      return json(facebookResult, facebookStatus);
    }
    if (url.pathname.startsWith('/storage/')) storageRequests.push(url.pathname);
    if (url.pathname === '/rest/v1/products') {
      if (method === 'PATCH') { Object.assign(product, JSON.parse(init.body)); return json(null); }
      return json(url.searchParams.get('id') === 'eq.7' ? [product] : []);
    }
    throw new Error(`Unexpected request: ${method} ${url.pathname}`);
  };
  try {
    const { default: handler } = await import('../api/products.js');
    const call = async (body = mp4, overrides = {}, stream = false) => {
      const res = { status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
      const req = stream ? Readable.from([body.subarray(0, 8), body.subarray(8)]) : { body };
      Object.assign(req, { method: 'POST', query: { action: 'upload_video', product_id: '7', color: 'Đen', sort_order: '2' }, headers: { 'content-type': 'application/octet-stream' } }, overrides);
      await handler(req, res);
      return res;
    };
    assert.equal((await call(Buffer.alloc(4 * 1024 * 1024 + 1))).statusCode, 400);
    assert.equal((await call(Buffer.alloc(0))).statusCode, 400);
    assert.equal((await call(Buffer.from('not an mp4 video'))).statusCode, 400);
    assert.equal((await call(mp4, { headers: { 'content-type': 'application/json' } })).statusCode, 400);
    assert.equal((await call({ path: '7/video.mp4' })).statusCode, 400);
    assert.equal((await call(mp4, { query: { action: 'upload_video', product_id: 999 } })).statusCode, 400);
    assert.equal(graphRequests.length, 0);
    facebookStatus = 400;
    facebookResult = { error: { message: 'Video rejected' } };
    const rejected = await call();
    assert.equal(rejected.statusCode, 400);
    assert.match(rejected.body.error, /Video rejected/);
    assert.equal(product.images.length, 1);
    facebookStatus = 200;
    facebookResult = {};
    assert.equal((await call()).statusCode, 400);
    assert.equal(product.images.length, 1);
    facebookResult = { attachment_id: 'video-attachment' };
    const uploaded = await call(mp4, {}, true);
    assert.equal(uploaded.statusCode, 200);
    assert.equal(uploaded.body.media_type, 'video');
    assert.equal(uploaded.body.facebook_attachment_id, 'video-attachment');
    assert.equal(uploaded.body.color, 'Đen');
    assert.equal(product.images.length, 2);
    assert.deepEqual(Object.keys(uploaded.body).sort(), ['id', 'media_type', 'facebook_attachment_id', 'color', 'sort_order'].sort());
    assert.equal((await call()).body.id, uploaded.body.id);
    assert.equal(product.images.length, 2);
    assert.equal(graphRequests.length, 3);
    assert.deepEqual(storageRequests, []);
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalError;
  }
});
