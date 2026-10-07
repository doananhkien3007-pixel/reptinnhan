import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

async function soundHarness({ preference, supported = true, storageThrows = false, resumeFails = false, initialAudioState = 'suspended' } = {}) {
  const elements = new Map();
  const listeners = {};
  const intervals = [];
  const tones = [];
  const audioContexts = [];
  const storage = new Map(preference ? [['leafchat.inbox.sound', preference]] : []);
  let messages = [{ senderId: 'customer-1', direction: 'inbound', text: 'Tin cũ', time: '10:00:00' }];
  let fetchFails = false;
  class MockAudioContext {
    constructor() { this.state = initialAudioState; this.currentTime = 10; this.destination = {}; audioContexts.push(this); }
    async resume() {
      if (resumeFails) throw new Error('Audio unavailable');
      this.state = 'running';
      this.onstatechange?.();
    }
    createOscillator() {
      const tone = { frequency: { setValueAtTime(value) { tone.pitch = value; } }, connect() {}, disconnect() {}, start(time) { tone.startTime = time; }, stop(time) { tone.stopTime = time; } };
      tones.push(tone);
      return tone;
    }
    createGain() { return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, disconnect() {} }; }
  }
  const context = vm.createContext({
    document: {
      hidden: true,
      getElementById(id) {
        if (!elements.has(id)) elements.set(id, {
          innerHTML: '', textContent: '', value: '', disabled: false, dataset: {},
          scrollTop: 0, scrollHeight: 0, clientHeight: 0, attributes: {}, listeners: {},
          addEventListener(type, listener) { this.listeners[type] = listener; },
          setAttribute(name, value) { this.attributes[name] = value; },
          querySelectorAll() { return []; }, classList: { add() {}, remove() {} }
        });
        return elements.get(id);
      },
      querySelectorAll() { return []; },
      addEventListener(type, listener) { listeners[type] = listener; }
    },
    window: {
      AudioContext: supported ? MockAudioContext : undefined,
      localStorage: {
        getItem(key) { if (storageThrows) throw new Error('Storage blocked'); return storage.get(key); },
        setItem(key, value) { if (storageThrows) throw new Error('Storage blocked'); storage.set(key, value); }
      }
    },
    appIcon: () => '',
    fetch: async url => {
      if (String(url).includes('get_messages')) {
        if (fetchFails) throw new Error('Offline');
        return Response.json(messages);
      }
      return Response.json({ enabled: true });
    },
    setInterval(callback, delay) { intervals.push({ callback, delay }); }
  });
  vm.runInContext(fs.readFileSync(new URL('../public/inbox.js', import.meta.url), 'utf8'), context);
  await new Promise(resolve => setImmediate(resolve));
  return {
    context, elements, listeners, intervals, tones, audioContexts, storage,
    setMessages(value) { messages = value; },
    setFetchFails(value) { fetchFails = value; },
    async gesture(type = 'click') { await listeners[type](); await new Promise(resolve => setImmediate(resolve)); }
  };
}

test('âm báo phát hai tiếng ting cho tin khách mới, bỏ qua lịch sử, AI và thay đổi hồ sơ', async () => {
  const h = await soundHarness();
  const old = { senderId: 'customer-1', direction: 'inbound', text: 'Tin cũ', time: '10:00:00' };
  assert.equal(h.tones.length, 0);
  assert.equal(h.audioContexts.length, 1);
  await h.gesture();
  assert.equal(h.audioContexts[0].state, 'running');
  assert.equal(h.elements.has('sound-toggle'), false);
  assert.equal(h.tones.length, 0);
  h.setMessages([{ ...old, customerName: 'Lan', profilePic: 'https://example.com/photo.png', adId: 'ad-1' },
    { ...old, direction: 'outbound', text: 'AI trả lời' }]);
  await h.context.fetchMessages();
  assert.equal(h.tones.length, 0);
  const incoming = { senderId: 'customer-2', direction: 'inbound', text: 'Xin giá', time: '10:01:00' };
  h.setMessages([old, incoming, { ...incoming, direction: 'outbound', text: 'AI đã trả lời ngay' }]);
  // The regular timer still polls when the tab is hidden.
  await h.intervals.find(item => item.delay === 3000).callback();
  assert.equal(h.tones.length, 6);
  assert.equal(h.tones[0].pitch, 1318.51);
  assert.equal(h.tones[3].pitch, 1567.98);
  assert.ok(Math.abs(h.tones[3].startTime - h.tones[0].startTime - 0.22) < 0.0001);
  assert.ok(h.tones.every(tone => tone.stopTime > tone.startTime));
  await h.context.fetchMessages();
  assert.equal(h.tones.length, 6);
  // A rolling window can replace an old row without increasing the total.
  h.setMessages([incoming, { ...incoming, text: 'Còn hàng không?', time: '10:02:00' }]);
  await h.context.fetchMessages();
  assert.equal(h.tones.length, 12);
  h.setMessages([incoming, incoming]);
  await h.context.fetchMessages();
  assert.equal(h.tones.length, 18, 'identical inbound rows still count as separate messages');
  h.setMessages([]);
  await h.context.fetchMessages();
  h.setMessages([old, incoming, incoming]);
  h.setFetchFails(true);
  await h.context.fetchMessages();
  h.setFetchFails(false);
  await h.context.fetchMessages();
  assert.equal(h.tones.length, 18, 'recovery must not replay previously seen messages');
});

test('âm báo luôn bật kể cả lựa chọn tắt cũ, không còn nút điều khiển', async () => {
  for (const initialAudioState of ['suspended', 'running']) {
    const h = await soundHarness({ preference: 'off', initialAudioState });
    assert.equal(h.elements.has('sound-toggle'), false);
    if (initialAudioState === 'suspended') await h.gesture('pointerdown');
    assert.equal(h.tones.length, 0, 'ordinary interactions do not play a preview');
    h.setMessages([{ senderId: 'customer-2', direction: 'inbound', text: 'Tin mới', time: '10:01:00' }]);
    await h.context.fetchMessages();
    assert.equal(h.tones.length, 6);
    await h.gesture('keydown');
    await h.context.fetchMessages();
    assert.equal(h.tones.length, 6);
  }
  assert.doesNotMatch(fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8'), /sound-toggle|Bật âm báo/);
});

test('tin tới trước thao tác đầu tiên hoặc khi audio bị treo vẫn phát một lần sau khi mở khóa', async () => {
  const h = await soundHarness();
  const incoming = { senderId: 'customer-2', direction: 'inbound', text: 'Tin trước khi bấm', time: '10:01:00' };
  h.setMessages([incoming]);
  await h.context.fetchMessages();
  h.setMessages([incoming, { ...incoming, text: 'Tin thứ hai', time: '10:02:00' }]);
  await h.context.fetchMessages();
  assert.equal(h.tones.length, 0);
  await h.gesture();
  assert.equal(h.tones.length, 6, 'pending arrivals play a single chime');
  await h.gesture();
  assert.equal(h.tones.length, 6);
  h.audioContexts[0].state = 'suspended';
  h.setMessages([{ ...incoming, text: 'Tin khi audio treo', time: '10:03:00' }]);
  await h.context.fetchMessages();
  assert.equal(h.tones.length, 6);
  await h.gesture('keydown');
  assert.equal(h.tones.length, 12);
});

test('hộp thư vẫn cập nhật khi âm thanh hoặc localStorage không khả dụng', async () => {
  for (const options of [{ supported: false }, { storageThrows: true }, { resumeFails: true }]) {
    const h = await soundHarness(options);
    await h.gesture();
    h.setMessages([{ senderId: 'customer-2', direction: 'inbound', text: 'Tin mới', time: '10:01:00' }]);
    await h.context.fetchMessages();
    assert.match(h.elements.get('chat-box').innerHTML, /Tin mới/);
    if (options.supported === false || options.resumeFails) {
      assert.equal(h.tones.length, 0);
    }
  }
});

test('giao diện gom mọi tin nhắn của cùng khách vào một nhãn hội thoại', async () => {
  const elements = new Map();
  const element = () => {
    const listeners = {};
    return {
      innerHTML: '', textContent: '', value: '', className: '', disabled: false,
      dataset: {}, style: {}, scrollTop: 0, scrollHeight: 0, clientHeight: 0,
      listeners,
      addEventListener(type, listener) { listeners[type] = listener; },
      setAttribute() {}, querySelectorAll() { return []; },
      classList: { toggle() {}, add() {}, remove() {} }
    };
  };
  const fetchCalls = [];
  const messages = [
    { senderId: 'customer-1', customerName: 'Nguyễn Lan', profilePic: 'https://img.example/lan.jpg', adId: 'ad-10', direction: 'outbound', text: 'Chào chị', time: '10:00:00' },
    { senderId: 'customer-1', adId: 'ad-10', direction: 'inbound', text: 'Còn màu đen không?', time: '10:01:00' },
    { senderId: 'customer-2', adId: null, direction: 'inbound', text: 'Xin giá', time: '10:02:00' }
  ];
  const context = vm.createContext({
    console,
    window: {},
    document: {
      getElementById(id) { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); },
      querySelectorAll() { return []; }, addEventListener() {}
    },
    appIcon: () => '',
    fetch: async (url, options) => {
      fetchCalls.push({ url: String(url), options });
      if (String(url).includes('get_messages')) return Response.json(messages);
      if (String(url).includes('get_task_logs')) return Response.json([]);
      if (String(url).includes('get_system_prompt')) return Response.json({ prompt: '' });
      if (String(url).includes('auto_reply_status')) return Response.json({ enabled: true });
      if (String(url).includes('toggle_auto_reply')) return Response.json({ enabled: false });
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

  await elements.get('reply-toggle').listeners.click();
  const toggleCall = fetchCalls.find(call => call.url.includes('toggle_auto_reply'));
  assert.equal(toggleCall.options.method, 'POST');
  assert.equal(toggleCall.options.headers['Content-Type'], 'application/json');
  assert.equal(toggleCall.options.body, '{}');
  assert.equal(elements.get('reply-status').textContent, 'Đã tạm dừng');
});
