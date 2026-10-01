import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';

const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 20]), Buffer.from('ftypisom0000video')]);

test('upload video qua Storage hoặc chuyển file nhỏ thẳng Facebook và lưu attachment ID', async () => {
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SECRET_KEY = 'test-secret';
  process.env.PAGE_ACCESS_TOKEN = 'test-page-token';
  const originalFetch = globalThis.fetch;
  const originalError = console.error;
  console.error = () => {};
  const product = { images: [{ image_url: 'old.jpg', facebook_attachment_id: 'old-image' }] };
  let facebookResult = { attachment_id: 'video-attachment' };
  let facebookStatus = 200;
  let expectedVideo = mp4;
  const graphRequests = [];
  const storageRequests = [];
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    const method = init.method || 'GET';
    if (url.hostname === 'graph.facebook.com') {
      assert.match(url.pathname, /\/me\/message_attachments$/);
      if (init.headers['Content-Type'] === 'application/json') {
        const payload = JSON.parse(init.body);
        assert.equal(payload.message.attachment.type, 'video');
        assert.equal(payload.message.attachment.payload.is_reusable, true);
        assert.match(payload.message.attachment.payload.url, /\/storage\/v1\/object\/public\/product-images\/7\/videos\//);
        graphRequests.push(payload);
        return json(facebookResult, facebookStatus);
      }
      assert.equal(url.searchParams.has('access_token'), false);
      assert.equal(init.headers.Authorization, 'Bearer test-page-token');
      assert.ok(init.body instanceof FormData);
      assert.deepEqual(JSON.parse(init.body.get('message')), {
        attachment: { type: 'video', payload: { is_reusable: true } }
      });
      const file = init.body.get('filedata');
      assert.equal(file.type, 'video/mp4');
      assert.deepEqual(Buffer.from(await file.arrayBuffer()), expectedVideo);
      graphRequests.push(init.body);
      return json(facebookResult, facebookStatus);
    }
    if (url.pathname.startsWith('/storage/')) {
      storageRequests.push(url.pathname);
      if (url.pathname === '/storage/v1/bucket/product-images') return json({ id: 'product-images', public: true });
      if (url.pathname.startsWith('/storage/v1/object/upload/sign/product-images/')) {
        return json({ url: `${url.pathname}?token=signed-token` });
      }
    }
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
    const jsonCall = async (action, body) => {
      const res = { status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } };
      await handler({ method: 'POST', query: { action }, body, headers: { 'content-type': 'application/json' } }, res);
      return res;
    };
    assert.equal((await call(Buffer.alloc(0))).statusCode, 400);
    assert.equal((await call(Buffer.from('not an mp4 video'))).statusCode, 400);
    assert.equal((await call(mp4, { headers: { 'content-type': 'application/json' } })).statusCode, 400);
    assert.equal((await call({ path: '7/video.mp4' })).statusCode, 400);
    assert.equal((await call(mp4, { query: { action: 'upload_video', product_id: 999 } })).statusCode, 400);
    assert.equal(graphRequests.length, 0);
    facebookStatus = 400;
    facebookResult = { error: { message: 'Video rejected' } };
    const largeMp4 = Buffer.concat([mp4, Buffer.alloc(5 * 1024 * 1024)]);
    expectedVideo = largeMp4;
    const largeRejected = await call(largeMp4);
    assert.equal(largeRejected.statusCode, 400);
    assert.match(largeRejected.body.error, /Video rejected/);
    expectedVideo = mp4;
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
    assert.equal(graphRequests.length, 4);

    const prepared = await jsonCall('prepare_video_upload', { product_id: 7, filename: 'video lớn.mp4' });
    assert.equal(prepared.statusCode, 200);
    assert.match(prepared.body.path, /^7\/videos\/.*-video-l-n\.mp4$/);
    assert.match(prepared.body.signed_url, /token=signed-token/);
    const finalized = await jsonCall('finalize_video_upload', {
      product_id: 7, path: prepared.body.path, color: 'Đỏ', sort_order: 4
    });
    assert.equal(finalized.statusCode, 200);
    assert.equal(finalized.body.facebook_attachment_id, 'video-attachment');
    assert.equal(finalized.body.storage_path, prepared.body.path);
    assert.equal(finalized.body.color, 'Đỏ');
    assert.equal(product.images.length, 3);
    assert.equal(graphRequests.length, 5);
    const duplicate = await jsonCall('finalize_video_upload', { product_id: 7, path: prepared.body.path });
    assert.equal(duplicate.body.id, finalized.body.id);
    assert.equal(graphRequests.length, 5);
    assert.deepEqual(storageRequests, [
      '/storage/v1/bucket/product-images',
      `/storage/v1/object/upload/sign/product-images/${prepared.body.path}`
    ]);
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalError;
  }
});
