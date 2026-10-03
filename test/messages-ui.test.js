import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

test('giao diện gom mọi tin nhắn của cùng khách vào một nhãn hội thoại', async () => {
  const elements = new Map();
  const element = () => ({
    innerHTML: '', textContent: '', value: '', className: '', disabled: false,
    dataset: {}, style: {}, scrollTop: 0, scrollHeight: 0, clientHeight: 0,
    addEventListener() {}, setAttribute() {}, querySelectorAll() { return []; },
    classList: { toggle() {}, add() {}, remove() {} }
  });
  const messages = [
    { senderId: 'customer-1', customerName: 'Nguyễn Lan', profilePic: 'https://img.example/lan.jpg', adId: 'ad-10', direction: 'outbound', text: 'Chào chị', time: '10:00:00' },
    { senderId: 'customer-1', adId: 'ad-10', direction: 'inbound', text: 'Còn màu đen không?', time: '10:01:00' },
    { senderId: 'customer-2', adId: null, direction: 'inbound', text: 'Xin giá', time: '10:02:00' }
  ];
  const context = vm.createContext({
    console,
    document: {
      getElementById(id) { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); },
      querySelectorAll() { return []; }, addEventListener() {}
    },
    appIcon: () => '',
    fetch: async (url) => {
      if (String(url).includes('get_messages')) return Response.json(messages);
      if (String(url).includes('get_task_logs')) return Response.json([]);
      if (String(url).includes('get_system_prompt')) return Response.json({ prompt: '' });
      if (String(url).includes('auto_reply_status')) return Response.json({ enabled: true });
      return Response.json({});
    },
    setInterval() { return 1; }
  });
  const script = fs.readFileSync(new URL('../public/inbox.js', import.meta.url), 'utf8');
  vm.runInContext(script, context);
  await new Promise((resolve) => setImmediate(resolve));
  const grouped = context.groupMessagesByCustomer(messages);
  assert.equal(grouped.length, 2);
  assert.equal(grouped[0].messages.length, 2);
  assert.deepEqual([...grouped[0].adIds], ['ad-10']);
  const list = elements.get('conversation-list').innerHTML;
  assert.equal((list.match(/data-customer="customer-1"/g) || []).length, 1);
  assert.match(list, /https:\/\/img\.example\/lan\.jpg/);
  assert.match(list, /2 tin/);
  assert.equal(elements.get('metric-customers').textContent, 2);
  assert.equal(elements.get('metric-pending').textContent, 2);
  assert.equal(elements.get('metric-replies').textContent, 1);
  // Select one customer: never mix another customer's messages into the thread.
  vm.runInContext("selectedId = 'customer-1'; renderDetail();", context);
  const rendered = elements.get('chat-box').innerHTML;
  assert.match(rendered, /Trợ lý AI · 10:00:00/);
  assert.match(rendered, /Nguyễn Lan · 10:01:00/);
  assert.doesNotMatch(rendered, /Xin giá/);
  // Searching narrows the list and moves selection to a visible customer.
  elements.get('conversation-search').value = 'Xin giá';
  context.renderConversations();
  assert.doesNotMatch(elements.get('conversation-list').innerHTML, /customer-1/);
  assert.match(elements.get('chat-box').innerHTML, /Xin giá/);
  elements.get('conversation-search').value = '';
  vm.runInContext("activeFilter = 'replied'; renderConversations();", context);
  assert.match(elements.get('conversation-list').innerHTML, /Không có hội thoại phù hợp/);
  assert.doesNotMatch(elements.get('chat-box').innerHTML, /Xin giá/);
  // An unchanged refresh preserves the reader's scroll and current DOM.
  vm.runInContext("activeFilter = 'all'; selectedId = 'customer-1'; renderConversations();", context);
  elements.get('chat-box').scrollTop = 42;
  const unchanged = elements.get('chat-box').innerHTML;
  await context.fetchMessages();
  assert.equal(elements.get('chat-box').scrollTop, 42);
  assert.equal(elements.get('chat-box').innerHTML, unchanged);
  assert.equal(context.escapeHtml('<img onerror="alert(1)">'), '&lt;img onerror=&quot;alert(1)&quot;&gt;');
});
