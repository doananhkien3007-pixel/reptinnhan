import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

test('giao diện ads có đồng bộ, ảnh creative, bộ lọc và thao tác ghép sản phẩm', () => {
  const html = fs.readFileSync(new URL('../public/ads/index.html', import.meta.url), 'utf8');
  assert.match(html, /fetch\('\/api\/facebook-ads'\)/);
  assert.match(html, /data-product-select/);
  assert.match(html, /save_ad_mapping/);
  assert.match(html, /ad\.cover_url/);
  assert.match(html, /Ads ID/);
  assert.match(html, /mapping-filter/);
  assert.match(html, /ad\.effective_status === 'ACTIVE'/);
  assert.doesNotMatch(html, /id="status-filter"|Đã tạm dừng/);
  assert.doesNotMatch(html, /FB_MARKETING_ACCESS_TOKEN|access_token=/);
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);
  assert.doesNotThrow(() => new vm.Script(script));
});
