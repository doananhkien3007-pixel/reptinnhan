import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

test('giao diện gom mọi tin nhắn của cùng khách vào một nhãn hội thoại', async () => {
  const elements = new Map();
  const element = () => ({
    innerHTML: '', textContent: '', value: '', className: '', disabled: false,
    style: {}, scrollTop: 0, scrollHeight: 0, addEventListener() {}, classList: { toggle() {} }
  });
  const messages = [
    { senderId: 'customer-1', adId: 'ad-10', direction: 'outbound', text: 'Chào chị', time: '10:00:00' },
    { senderId: 'customer-1', adId: 'ad-10', direction: 'inbound', text: 'Còn màu đen không?', time: '10:01:00' },
    { senderId: 'customer-2', adId: null, direction: 'inbound', text: 'Xin giá', time: '10:02:00' }
  ];
  const context = vm.createContext({
    console,
    document: { getElementById(id) { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); } },
    fetch: async (url) => {
      if (String(url).includes('get_messages')) return Response.json(messages);
      if (String(url).includes('get_task_logs')) return Response.json([]);
      if (String(url).includes('get_system_prompt')) return Response.json({ prompt: '' });
      if (String(url).includes('auto_reply_status')) return Response.json({ enabled: true });
      return Response.json({});
    },
    setInterval() { return 1; }
  });
  const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], context);
  await new Promise((resolve) => setImmediate(resolve));
  const grouped = context.groupMessagesByCustomer(messages);
  assert.equal(grouped.length, 2);
  assert.equal(grouped[0].messages.length, 2);
  assert.deepEqual([...grouped[0].adIds], ['ad-10']);
  const rendered = elements.get('chat-box').innerHTML;
  assert.equal((rendered.match(/Khách · ID customer-1/g) || []).length, 1);
  assert.match(rendered, /2 tin/);
  assert.match(rendered, /Bot gửi · 10:00:00/);
  assert.match(rendered, /Khách gửi · 10:01:00/);
});
