import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8');

test('Remarketing là công cụ riêng trong thanh điều hướng bên trái', () => {
  const shell = read('../public/app-shell.js');
  const page = read('../public/remarketing/index.html');
  assert.match(shell, /\['remarketing', '\/remarketing', 'repeat', 'Remarketing'\]/);
  assert.match(page, /<body data-page="remarketing">/);
  assert.match(page, /Không can thiệp luồng rep tin nhắn/);
  assert.match(page, /id="remarketing-admin-token"/);
  assert.match(page, /id="remarketing-dry-run"/);
  assert.match(page, /id="remarketing-enable"/);
  assert.match(page, /id="remarketing-disable"/);
});

test('Hộp thư không còn điều khiển cấu hình Remarketing', () => {
  const inboxHtml = read('../public/index.html');
  const inboxScript = read('../public/inbox.js');
  assert.doesNotMatch(inboxHtml, /id="remarketing-(?:max-steps|dry-run|enable|disable|status)"/);
  assert.doesNotMatch(inboxScript, /remarketing_config|saveRemarketingConfig|loadRemarketingStatus/);
  assert.match(inboxHtml, /href="\/remarketing"/);
});

test('công cụ Remarketing chỉ gọi API trạng thái và cấu hình riêng', () => {
  const script = read('../public/remarketing/remarketing.js');
  assert.match(script, /api\('remarketing_status'\)/);
  assert.match(script, /api\('remarketing_config'/);
  assert.doesNotMatch(script, /toggle_auto_reply|preview_reply|messages|sendMessage/);
});
