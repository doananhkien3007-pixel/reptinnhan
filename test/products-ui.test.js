import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

test('giao diện chuyển file qua server và hiển thị ID Facebook không cần URL video', async () => {
  const elements = new Map();
  const element = () => ({
    innerHTML: '', value: '', files: [], style: {}, addEventListener() {}, reset() {}, appendChild() {},
    querySelector: () => element()
  });
  let uploadFails = true;
  let expectedColor = 'Đen & đỏ';
  let listedProducts = [];
  const calls = [];
  let preparedCount = 0;
  const context = vm.createContext({
    URLSearchParams, FormData,
    window: { scrollTo() {} },
    document: {
      getElementById(id) { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); },
      createElement: element, querySelectorAll: () => []
    },
    fetch: async (url, init = {}) => {
      if (url === '/api/products?action=list') return Response.json(listedProducts);
      calls.push({ url, ...init });
      const parsed = new URL(url, 'https://app.example');
      if (parsed.hostname === 'storage.example') {
        assert.equal(init.method, 'PUT');
        assert.ok(init.body instanceof FormData);
        assert.ok(init.body.get('') instanceof Blob);
        return Response.json({ Key: 'product-images/video.mp4' });
      }
      const action = parsed.searchParams.get('action');
      const payload = JSON.parse(init.body);
      assert.equal(init.method, 'POST');
      assert.equal(init.headers['Content-Type'], 'application/json');
      assert.equal(payload.product_id, 7);
      if (action === 'prepare_video_upload') {
        preparedCount += 1;
        assert.match(payload.filename, /\.mp4$/);
        return Response.json({
          path: `7/videos/video-${preparedCount}.mp4`,
          signed_url: `https://storage.example/upload-${preparedCount}`
        });
      }
      assert.equal(action, 'finalize_video_upload');
      assert.equal(payload.color, expectedColor);
      assert.equal(payload.sort_order, 0);
      assert.match(payload.path, /^7\/videos\/video-\d+\.mp4$/);
      return uploadFails ? Response.json({ error: 'Facebook bận' }, { status: 400 }) : Response.json({ facebook_attachment_id: 'video-1' });
    }
  });
  const html = fs.readFileSync(new URL('../public/products/index.html', import.meta.url), 'utf8');
  vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], context);
  await new Promise((resolve) => setImmediate(resolve));
  const file = new Blob(['video bytes'], { type: 'video/mp4' });
  file.name = 'demo.mp4';
  await assert.rejects(context.uploadVideo(file, 7, 'Đen & đỏ', 0, {}), /Facebook bận/);
  uploadFails = false;
  assert.equal((await context.uploadVideo(file, 7, 'Đen & đỏ', 0, {})).facebook_attachment_id, 'video-1');
  assert.equal(calls.length, 6);
  const largeFile = new Blob(['video bytes'], { type: 'video/mp4' });
  largeFile.name = 'large.mp4';
  Object.defineProperty(largeFile, 'size', { value: 8 * 1024 * 1024 });
  await context.uploadVideo(largeFile, 7, 'Đen & đỏ', 0, {});
  assert.equal(calls.length, 9);
  vm.runInContext(`products = [{id: 7, name: 'Váy', images: [
    {image_url: 'image.jpg'}, {media_type: 'video', facebook_attachment_id: 'video-1'}
  ]}]; renderProducts();`, context);
  assert.match(elements.get('products').innerHTML, /Video đã lưu trên Facebook/);
  assert.match(elements.get('products').innerHTML, /ID: video-1/);
  assert.match(elements.get('products').innerHTML, /<img src="image.jpg"/);
  assert.doesNotMatch(elements.get('products').innerHTML, /<video|undefined/);

  // Existing products without colors can upload video immediately, without saving again.
  context.editProduct({
    id: 7, name: 'Sản phẩm cũ', images: [
      { color: 'Đỏ', facebook_attachment_id: 'image-attachment-1' },
      { media_type: 'video', facebook_attachment_id: 'video-attachment-1' }
    ]
  });
  assert.equal(elements.get('upload-product-videos').disabled, false);
  assert.match(elements.get('product-video-status').textContent, /upload thêm video ngay/);
  assert.match(elements.get('product-attachment-ids').innerHTML, /Ảnh · Màu Đỏ/);
  assert.match(elements.get('product-attachment-ids').innerHTML, /image-attachment-1/);
  assert.match(elements.get('product-attachment-ids').innerHTML, /video-attachment-1/);
  expectedColor = '';
  elements.get('product-video-files').files = [file];
  listedProducts = [{ id: 7, name: 'Sản phẩm cũ', images: [{ media_type: 'video', facebook_attachment_id: 'video-1' }] }];
  assert.equal(await context.uploadProductVideos(), true);
  assert.equal(calls.length, 12);
  assert.match(elements.get('product-videos').innerHTML, /ID: video-1/);
  assert.equal(elements.get('product-video-files').value, '');
  context.clearForm();
  assert.equal(elements.get('upload-product-videos').disabled, true);
  assert.equal(elements.get('product-videos').innerHTML, '');
});
