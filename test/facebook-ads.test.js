import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  fetchFacebookAds,
  getCreativeCover,
  getCreativeDestination,
  normalizeAdAccountId,
  suggestProductForAd
} from '../server/facebook-ads.js';

test('Ads API dùng token Marketing riêng, không dùng token Messenger', () => {
  const source = fs.readFileSync(new URL('../api/facebook-ads.js', import.meta.url), 'utf8');
  assert.match(source, /process\.env\.FB_MARKETING_ACCESS_TOKEN/);
  assert.doesNotMatch(source, /process\.env\.PAGE_ACCESS_TOKEN|process\.env\.META_ACCESS_TOKEN/);
});

test('chuẩn hoá ad account và không chấp nhận ID không an toàn', () => {
  assert.equal(normalizeAdAccountId('123456'), 'act_123456');
  assert.equal(normalizeAdAccountId('act_987'), 'act_987');
  assert.throws(() => normalizeAdAccountId('act_123/ads'), /FB_AD_ACCOUNT_ID/);
  assert.throws(() => normalizeAdAccountId(''), /FB_AD_ACCOUNT_ID/);
});

test('lấy ảnh bìa và URL đích từ nhiều loại creative', () => {
  assert.equal(getCreativeCover({ image_url: 'direct.jpg', thumbnail_url: 'thumb.jpg' }), 'direct.jpg');
  assert.equal(getCreativeCover({ object_story_spec: { video_data: { image_url: 'video-cover.jpg' } } }), 'video-cover.jpg');
  assert.equal(getCreativeCover({ asset_feed_spec: { images: [{ url: 'dynamic.jpg' }] } }), 'dynamic.jpg');
  assert.equal(getCreativeDestination({ object_story_spec: { link_data: { link: 'https://shop.example/p/1' } } }), 'https://shop.example/p/1');
  assert.equal(getCreativeDestination({ object_story_spec: { video_data: { call_to_action: { value: { link: 'https://shop.example/p/2' } } } } }), 'https://shop.example/p/2');
});

test('gợi ý sản phẩm theo SKU trước, sau đó theo tên sản phẩm', () => {
  const products = [
    { id: 1, sku: 'VAY-001', name: 'Váy hoa thiết kế' },
    { id: 2, sku: 'AO-002', name: 'Áo sơ mi lụa' }
  ];
  assert.deepEqual(suggestProductForAd({ name: 'Retarget | VAY-001 | nữ 25-34' }, products), {
    product_id: 1, reason: 'SKU VAY-001', confidence: 'high'
  });
  assert.deepEqual(suggestProductForAd({ name: 'Mở bán áo sơ mi lụa' }, products), {
    product_id: 2, reason: 'tên sản phẩm Áo sơ mi lụa', confidence: 'high'
  });
  assert.equal(suggestProductForAd({ name: 'Quảng cáo chung toàn shop' }, products), null);
});

test('Marketing API dùng Bearer token, phân trang và chuẩn hoá creative', async () => {
  const calls = [];
  const pages = [
    {
      data: [{
        id: '1001', name: 'VAY-001 sale', status: 'ACTIVE', effective_status: 'ACTIVE',
        creative: { id: 'c1', name: 'Creative váy', thumbnail_url: 'https://img.example/vay.jpg', object_type: 'VIDEO' }
      }],
      paging: { cursors: { after: 'cursor-1' }, next: 'https://graph.facebook.com/next' }
    },
    { data: [{ id: '1002', name: 'Ads 2', status: 'PAUSED', creative: { id: 'c2' } }] }
  ];
  const fetchImpl = async (input, init) => {
    const url = new URL(input);
    calls.push({ url, init });
    return Response.json(pages[calls.length - 1]);
  };
  const result = await fetchFacebookAds({
    accountId: '123', accessToken: 'secret-token', version: 'v26.0', fetchImpl
  });
  assert.equal(result.account_id, 'act_123');
  assert.equal(result.ads.length, 2);
  assert.equal(result.ads[0].cover_url, 'https://img.example/vay.jpg');
  assert.equal(result.ads[0].creative_id, 'c1');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url.pathname, '/v26.0/act_123/ads');
  assert.equal(calls[0].url.searchParams.has('access_token'), false);
  assert.equal(calls[1].url.searchParams.get('after'), 'cursor-1');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer secret-token');
});

test('tự tìm Ad Account khi token chỉ truy cập đúng một tài khoản', async () => {
  const calls = [];
  const fetchImpl = async (input, init) => {
    const url = new URL(input);
    calls.push({ url, init });
    if (url.pathname.endsWith('/me/adaccounts')) {
      return Response.json({ data: [{ id: 'act_555', name: 'Shop chính', account_status: 1 }] });
    }
    return Response.json({ data: [{ id: 'ad-1', name: 'Ads đầu tiên', status: 'ACTIVE' }] });
  };
  const result = await fetchFacebookAds({ accessToken: 'secret-token', fetchImpl });
  assert.equal(result.account_id, 'act_555');
  assert.equal(result.ads[0].id, 'ad-1');
  assert.equal(calls[0].url.pathname, '/v26.0/me/adaccounts');
  assert.equal(calls[1].url.pathname, '/v26.0/act_555/ads');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer secret-token');
});

test('không tự chọn khi token truy cập nhiều Ad Account', async () => {
  const fetchImpl = async () => Response.json({ data: [
    { id: 'act_1', name: 'Shop A' }, { id: 'act_2', name: 'Shop B' }
  ] });
  await assert.rejects(fetchFacebookAds({ accessToken: 'secret-token', fetchImpl }), /nhiều Ad Account.*FB_AD_ACCOUNT_ID/);
});

test('Marketing API trả lỗi rõ ràng và không làm lộ token', async () => {
  const fetchImpl = async () => Response.json({ error: { message: 'Missing ads_read permission' } }, { status: 403 });
  await assert.rejects(
    fetchFacebookAds({ accountId: '123', accessToken: 'top-secret', fetchImpl }),
    (error) => /Missing ads_read permission/.test(error.message) && !/top-secret/.test(error.message)
  );
});
