const $ = (id) => document.getElementById(id);
let conversations = [];
let selectedId = null;
let activeFilter = 'all';
let messageSignature = null;
let detailSignature = null;
let fetching = false;
let autoReplyEnabled = null;
let togglingReply = false;
let promptLoaded = false;
let previewSenderId = null;
let previewHistory = [];
let previewVersion = 0;
let audioContext = null;
let soundEnabled = true;
let soundError = false;
let seenIncomingMessages = null;
const soundPreferenceKey = 'leafchat.inbox.sound';
const AudioContextClass = window.AudioContext || window.webkitAudioContext;
try { soundEnabled = window.localStorage.getItem(soundPreferenceKey) !== 'off'; } catch {}

function updateSoundControl() {
  const button = $('sound-toggle');
  const ready = soundEnabled && audioContext?.state === 'running' && !soundError;
  button.disabled = !AudioContextClass;
  button.setAttribute('aria-pressed', String(!!ready));
  button.textContent = !AudioContextClass ? 'Âm báo không khả dụng' : !soundEnabled ? 'Âm báo: tắt' : ready ? 'Âm báo: bật' : 'Bật âm báo';
  button.title = !AudioContextClass ? 'Trình duyệt chưa hỗ trợ âm báo.' : ready ? 'Tắt tiếng ping ping khi có tin mới.' : 'Bấm để bật và nghe thử tiếng ping ping.';
}

async function unlockNotificationAudio() {
  if (!soundEnabled || !AudioContextClass) return;
  try {
    if (!audioContext || audioContext.state === 'closed') {
      audioContext = new AudioContextClass();
      audioContext.onstatechange = updateSoundControl;
    }
    if (audioContext.state !== 'running') await audioContext.resume();
    soundError = false;
  } catch { soundError = true; }
  updateSoundControl();
}

function playMessagePing() {
  if (!soundEnabled || audioContext?.state !== 'running') return;
  try {
    const start = audioContext.currentTime + 0.01;
    [0, 0.23].forEach(offset => {
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      const time = start + offset;
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(1046.5, time);
      gain.gain.setValueAtTime(0, time);
      gain.gain.linearRampToValueAtTime(0.18, time + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.001, time + 0.18);
      oscillator.connect(gain);
      gain.connect(audioContext.destination);
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
      oscillator.start(time);
      oscillator.stop(time + 0.2);
    });
  } catch { soundError = true; updateSoundControl(); }
}

function notifyIncomingMessages(messages) {
  const counts = new Map();
  for (const message of messages) {
    if (message.direction === 'outbound') continue;
    // Profile and ad updates must not look like new messages. Count identical
    // messages separately because the API's display time has second precision.
    const key = JSON.stringify([message.senderId, message.direction || 'inbound', message.text, message.time]);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  if (seenIncomingMessages === null) { seenIncomingMessages = counts; return; }
  let hasNewIncoming = false;
  for (const [key, count] of counts) {
    if (count > (seenIncomingMessages.get(key) || 0)) {
      hasNewIncoming = true;
      seenIncomingMessages.set(key, count);
    }
  }
  // Retain recent identities across empty responses and the 200-message window.
  while (seenIncomingMessages.size > 2000) seenIncomingMessages.delete(seenIncomingMessages.keys().next().value);
  if (hasNewIncoming) playMessagePing();
}

$('sound-toggle').addEventListener('click', async () => {
  if (soundEnabled && audioContext?.state === 'running' && !soundError) {
    soundEnabled = false;
  } else {
    soundEnabled = true;
    await unlockNotificationAudio();
    playMessagePing();
  }
  try { window.localStorage.setItem(soundPreferenceKey, soundEnabled ? 'on' : 'off'); } catch {}
  updateSoundControl();
});
document.addEventListener('click', event => {
  if (!event.target.closest('#sound-toggle')) unlockNotificationAudio();
});
document.addEventListener('keydown', event => {
  if ((event.key === 'Enter' || event.key === ' ') && !event.target.closest('#sound-toggle')) unlockNotificationAudio();
});
updateSoundControl();

function resetPreview() {
  previewHistory = [];
  previewVersion++;
  $('preview-message').value = '';
  $('preview-result').hidden = true;
  $('preview-memory').textContent = 'Chưa có lượt thử.';
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function groupMessagesByCustomer(messages) {
  const groups = new Map();
  messages.forEach((message, index) => {
    const senderId = String(message.senderId || 'unknown');
    if (!groups.has(senderId)) groups.set(senderId, { senderId, customerName: null, profilePic: null, adIds: new Set(), messages: [], lastIndex: index });
    const conversation = groups.get(senderId);
    if (message.customerName) conversation.customerName = message.customerName;
    if (message.profilePic) conversation.profilePic = message.profilePic;
    if (message.adId) conversation.adIds.add(String(message.adId));
    conversation.messages.push(message);
    conversation.lastIndex = index;
  });
  return [...groups.values()];
}

function customerLabel(conversation) { return conversation.customerName || 'Khách · ' + conversation.senderId.slice(-6); }
function isPending(conversation) { return conversation.messages.at(-1)?.direction !== 'outbound'; }
function avatar(conversation) {
  const initials = customerLabel(conversation).trim().split(/\s+/).slice(-2).map(word => word[0]).join('').toUpperCase();
  const fallback = '<span class="avatar">' + escapeHtml(initials) + '</span>';
  return /^https?:\/\//i.test(conversation.profilePic || '')
    ? '<img class="avatar" src="' + escapeHtml(conversation.profilePic) + '" alt="" referrerpolicy="no-referrer" data-initials="' + escapeHtml(initials) + '">'
    : fallback;
}

function visibleConversations() {
  const query = $('conversation-search').value.trim().toLocaleLowerCase('vi');
  return conversations.filter(conversation => {
    if (activeFilter === 'pending' && !isPending(conversation)) return false;
    if (activeFilter === 'replied' && isPending(conversation)) return false;
    const searchText = [customerLabel(conversation), conversation.senderId, ...conversation.adIds, ...conversation.messages.map(msg => msg.text)].join(' ').toLocaleLowerCase('vi');
    return !query || searchText.includes(query);
  });
}

function renderConversations() {
  const visible = visibleConversations();
  if (!visible.some(item => item.senderId === selectedId)) selectedId = visible[0]?.senderId || null;
  $('list-count').textContent = visible.length;
  const list = $('conversation-list');
  const scroll = list.scrollTop;
  const focusedId = document.activeElement?.closest('[data-customer]')?.dataset.customer;
  list.innerHTML = visible.length ? visible.map(conversation => {
    const last = conversation.messages.at(-1);
    const pending = isPending(conversation);
    return '<button type="button" class="conversation-item" data-customer="' + escapeHtml(conversation.senderId) + '" aria-current="' + (selectedId === conversation.senderId) + '">' +
      '<span class="avatar-wrap">' + avatar(conversation) + '<span class="messenger-mark">f</span></span><span class="conversation-preview">' +
      '<span class="preview-top"><strong>' + escapeHtml(customerLabel(conversation)) + '</strong><time>' + escapeHtml(String(last.time || '').slice(0, 5)) + '</time></span>' +
      '<p>' + (last.direction === 'outbound' ? 'AI: ' : '') + escapeHtml(last.text || 'Tin nhắn đính kèm') + '</p>' +
      '<span class="preview-bottom"><span class="mini-tag ' + (pending ? 'pending' : 'replied') + '">' + (pending ? 'Chờ trả lời' : 'AI đã trả lời') + '</span><span>' + conversation.messages.length + ' tin</span></span></span></button>';
  }).join('') : '<div class="empty-state compact">' + (conversations.length ? 'Không có hội thoại phù hợp.<br>Thử từ khóa hoặc bộ lọc khác.' : 'Chưa có tin nhắn.<br>Hội thoại sẽ xuất hiện khi khách nhắn tới Page.') + '</div>';
  list.scrollTop = scroll;
  if (focusedId) [...list.querySelectorAll('[data-customer]')].find(el => el.dataset.customer === focusedId)?.focus({ preventScroll: true });
  renderDetail();
}

function renderDetail() {
  const conversation = conversations.find(item => item.senderId === selectedId);
  const signature = JSON.stringify(conversation ? [conversation.senderId, conversation.customerName, conversation.profilePic, [...conversation.adIds], conversation.messages] : null);
  if (signature === detailSignature) return;
  const changedCustomer = $('chat-box').dataset.customer !== selectedId;
  detailSignature = signature;
  const box = $('chat-box');
  const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 90;
  const scroll = box.scrollTop;
  box.dataset.customer = selectedId || '';
  if (!conversation) {
    $('chat-heading').innerHTML = '<span class="avatar">?</span><div><strong>Không gian hội thoại</strong><small>Chọn một khách hàng để xem tin nhắn</small></div>';
    box.innerHTML = '<div class="empty-state">' + appIcon('chat') + '<strong>Mỗi tin nhắn là một kết nối</strong><p>Chọn hội thoại trong danh sách khách hàng.</p></div>';
    $('customer-panel').innerHTML = '<div class="customer-placeholder">Thông tin khách hàng hiển thị tại đây.</div>';
    return;
  }
  const name = escapeHtml(customerLabel(conversation));
  const latestAdId = [...conversation.adIds].at(-1);
  $('chat-heading').innerHTML = avatar(conversation) + '<div><strong>' + name + '</strong><small>' + conversation.messages.length + ' tin nhắn · Facebook Messenger</small></div>';
  box.innerHTML = '<div class="history-note"><span>Lịch sử hội thoại gần nhất</span></div>' + conversation.messages.map(message => '<div class="message-row ' + (message.direction === 'outbound' ? 'outbound' : 'inbound') + '"><div class="message">' + escapeHtml(message.text || 'Tin nhắn đính kèm') + '</div><div class="message-meta">' + (message.direction === 'outbound' ? 'Trợ lý AI' : name) + ' · ' + escapeHtml(message.time) + '</div></div>').join('');
  box.scrollTop = changedCustomer || nearBottom ? box.scrollHeight : scroll;
  $('customer-panel').innerHTML = '<h2 class="profile-heading">THÔNG TIN KHÁCH HÀNG</h2><div class="profile-summary">' + avatar(conversation) + '<h3>' + name + '</h3><p>Khách hàng từ Facebook</p><span class="mini-tag ' + (isPending(conversation) ? 'pending' : 'replied') + '">' + (isPending(conversation) ? 'Chờ phản hồi' : 'AI đã trả lời') + '</span></div>' +
    '<section class="profile-block"><h4>Chi tiết liên hệ</h4><dl><dt>ID khách hàng</dt><dd>' + escapeHtml(conversation.senderId) + '</dd><dt>Kênh liên hệ</dt><dd>Facebook Messenger</dd><dt>Tin nhắn đang hiển thị</dt><dd>' + conversation.messages.length + ' tin nhắn</dd></dl></section>' +
    '<section class="profile-block"><h4>Nguồn quảng cáo</h4><dl><dt>Ads ID gần nhất</dt><dd>' + escapeHtml(latestAdId || 'Chưa ghi nhận quảng cáo') + '</dd></dl><a class="profile-link" href="/ads">Xem quảng cáo & sản phẩm ' + appIcon('arrow') + '</a></section><div class="profile-tip">' + appIcon('spark') + '<p>Tên và ảnh đại diện được đồng bộ từ Facebook khi có thông tin.</p></div>';
}

async function api(action, options) {
  const res = await fetch('/api/webhook?action=' + action, options);
  const raw = await res.text();
  let data;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    if (!res.ok) throw new Error(raw || 'Yêu cầu chưa thành công. Vui lòng thử lại.');
    throw new Error('Máy chủ trả về dữ liệu không hợp lệ. Vui lòng thử lại.');
  }
  if (!res.ok) throw new Error(data?.error || 'Yêu cầu chưa thành công. Vui lòng thử lại.');
  return data;
}

async function fetchMessages() {
  if (fetching) return;
  fetching = true;
  $('refresh-messages').disabled = true;
  try {
    const messages = await api('get_messages');
    if (!Array.isArray(messages)) throw new Error('Không đọc được danh sách tin nhắn.');
    notifyIncomingMessages(messages);
    const signature = JSON.stringify(messages);
    if (signature !== messageSignature) {
      messageSignature = signature;
      conversations = groupMessagesByCustomer(messages).sort((a, b) => b.lastIndex - a.lastIndex);
      $('metric-customers').textContent = conversations.length;
      $('metric-pending').textContent = conversations.filter(isPending).length;
      $('metric-replies').textContent = messages.filter(message => message.direction === 'outbound').length;
      renderConversations();
    }
    $('sync-status').classList.remove('error');
    $('sync-label').textContent = 'Đã cập nhật · ' + new Date().toLocaleTimeString('vi-VN');
  } catch (error) {
    $('sync-status').classList.add('error');
    $('sync-label').textContent = 'Mất kết nối · Đang thử lại';
    if (messageSignature === null) $('conversation-list').innerHTML = '<div class="empty-state compact">' + escapeHtml(error.message) + '<br>Nhấn làm mới để thử lại.</div>';
  } finally {
    fetching = false;
    $('refresh-messages').disabled = false;
  }
}

function updateReplyControl() {
  $('reply-status').textContent = autoReplyEnabled ? 'Đang hoạt động' : 'Đã tạm dừng';
  $('reply-description').textContent = autoReplyEnabled ? 'Tự động chăm sóc khách hàng' : 'Đã tắt trả lời tự động';
  $('reply-toggle').setAttribute('aria-checked', String(autoReplyEnabled));
  $('reply-toggle').setAttribute('aria-label', autoReplyEnabled ? 'Tắt trả lời tự động' : 'Bật trả lời tự động');
  $('chat-ai-status').textContent = autoReplyEnabled ? 'Trợ lý AI đang được bật' : 'Trợ lý AI đang tạm dừng';
}

async function loadReplyStatus() {
  if (togglingReply) return;
  try {
    const data = await api('auto_reply_status');
    if (togglingReply) return;
    if (typeof data.enabled !== 'boolean') throw new Error('Trạng thái không hợp lệ');
    autoReplyEnabled = data.enabled;
    updateReplyControl();
    $('reply-toggle').disabled = false;
  } catch {
    if (togglingReply) return;
    $('reply-status').textContent = 'Chưa kết nối';
    $('reply-toggle').disabled = true;
    $('chat-ai-status').textContent = 'Chưa xác định trạng thái trợ lý AI';
  }
}

$('reply-toggle').addEventListener('click', async () => {
  togglingReply = true;
  $('reply-toggle').disabled = true;
  try {
    const data = await api('toggle_auto_reply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    });
    if (typeof data.enabled !== 'boolean') throw new Error('Không đọc được trạng thái mới.');
    autoReplyEnabled = data.enabled;
    updateReplyControl();
  } catch (error) { $('reply-status').textContent = 'Chưa cập nhật'; $('reply-description').textContent = error.message; }
  finally { togglingReply = false; $('reply-toggle').disabled = false; }
});

async function loadSystemPrompt() {
  $('save-prompt').disabled = true;
  $('system-prompt').disabled = true;
  $('prompt-status').textContent = 'Đang tải hướng dẫn…';
  try {
    const data = await api('get_system_prompt');
    $('system-prompt').value = data.prompt || '';
    promptLoaded = true;
    $('prompt-status').textContent = '';
  } catch (error) { $('prompt-status').textContent = error.message + ' Mở lại cửa sổ để thử lại.'; }
  finally { $('save-prompt').disabled = !promptLoaded; $('system-prompt').disabled = !promptLoaded; }
}

$('open-settings').addEventListener('click', () => {
  if (previewSenderId !== selectedId) resetPreview();
  previewSenderId = selectedId;
  const customer = conversations.find(item => item.senderId === previewSenderId);
  $('preview-context').textContent = customer ? 'Ngữ cảnh: ' + customerLabel(customer) + ' và lịch sử hội thoại đã lưu.' : 'Thử với dữ liệu sản phẩm. Chọn khách trong hộp thư để thử cùng ngữ cảnh của khách.';
  $('settings-dialog').showModal();
  if (!promptLoaded) loadSystemPrompt();
});
$('preview-reset').addEventListener('click', resetPreview);
$('preview-reply').addEventListener('click', async () => {
  const result = $('preview-result');
  const message = $('preview-message').value.trim();
  result.hidden = false;
  result.classList.remove('error');
  if (!message) { result.textContent = 'Nhập tin nhắn khách để thử phản hồi.'; return; }
  const version = previewVersion;
  $('preview-reply').disabled = true;
  $('preview-reset').disabled = true;
  result.textContent = 'AI đang đọc ngữ cảnh và soạn trả lời…';
  try {
    const data = await api('preview_reply', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message, sender_id: previewSenderId, preview_history: previewHistory }) });
    if (version !== previewVersion) return;
    previewHistory = [...previewHistory, { direction: 'inbound', text: message }, { direction: 'outbound', text: data.reply }].slice(-20);
    $('preview-memory').textContent = 'Đang nhớ ' + previewHistory.length / 2 + ' lượt thử. Nhập tin tiếp theo để tiếp tục hội thoại.';
    if ($('preview-message').value.trim() === message) $('preview-message').value = '';
    const intents = { greeting: 'Chào hỏi', price: 'Hỏi giá', size: 'Tư vấn size', color: 'Chọn màu', product_info: 'Thông tin sản phẩm', media: 'Xem ảnh/video', order: 'Đặt hàng', shipping: 'Giao hàng', complaint: 'Góp ý / khiếu nại', thanks: 'Cảm ơn', other: 'Trao đổi khác' };
    result.textContent = 'AI hiểu: ' + (intents[data.intent] || 'Trao đổi') + (data.product_name ? ' · ' + data.product_name : '') + '\n\n' + data.reply + (data.media_ids?.length ? '\n\nDự kiến gửi kèm ' + data.media_ids.length + ' ảnh/video.' : '');
  } catch (error) { if (version === previewVersion) { result.classList.add('error'); result.textContent = error.message; } }
  finally {
    $('preview-reply').disabled = false;
    $('preview-reset').disabled = false;
    if ($('settings-dialog').open && version === previewVersion) result.scrollIntoView({ block: 'nearest' });
  }
});
$('save-prompt').addEventListener('click', async () => {
  $('save-prompt').disabled = true;
  $('prompt-status').textContent = 'Đang lưu…';
  try {
    await api('set_system_prompt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: $('system-prompt').value }) });
    $('prompt-status').textContent = 'Đã lưu hướng dẫn.';
  } catch (error) { $('prompt-status').textContent = error.message; }
  finally { $('save-prompt').disabled = false; }
});
$('test-openai').addEventListener('click', async () => {
  $('test-openai').disabled = true;
  $('openai-status').textContent = 'Đang kiểm tra kết nối…';
  try { const data = await api('test_openai'); $('openai-status').textContent = 'Kết nối thành công' + (data.reply ? ': ' + data.reply : '.'); }
  catch (error) { $('openai-status').textContent = error.message; }
  finally { $('test-openai').disabled = false; }
});

async function loadTaskLogs() {
  $('refresh-log').disabled = true;
  try {
    const logs = await api('get_task_logs');
    if (!Array.isArray(logs)) throw new Error('Không đọc được nhật ký.');
    $('task-log').textContent = logs.length ? logs.map(log => '[' + log.time + '] [' + log.action + '] ' + log.detail).join('\n') : 'Chưa có hoạt động được ghi nhận.';
    $('task-log').scrollTop = $('task-log').scrollHeight;
  } catch (error) { $('task-log').textContent = error.message; }
  finally { $('refresh-log').disabled = false; }
}
$('open-logs').addEventListener('click', () => { $('logs-dialog').showModal(); loadTaskLogs(); });
$('refresh-log').addEventListener('click', loadTaskLogs);
$('refresh-messages').addEventListener('click', fetchMessages);
$('conversation-search').addEventListener('input', renderConversations);
document.querySelectorAll('[data-filter]').forEach(button => button.addEventListener('click', () => {
  activeFilter = button.dataset.filter;
  document.querySelectorAll('[data-filter]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
  renderConversations();
}));
$('conversation-list').addEventListener('click', event => {
  const item = event.target.closest('[data-customer]');
  if (!item) return;
  selectedId = item.dataset.customer;
  renderConversations();
  document.querySelector('.inbox-workspace').classList.add('show-conversation');
  document.querySelector('.inbox-workspace').classList.remove('show-profile');
  $('profile-toggle').setAttribute('aria-expanded', 'false');
  if (window.matchMedia('(max-width: 600px)').matches) document.querySelector('.inbox-workspace').scrollIntoView({ block: 'start' });
});
$('back-to-list').addEventListener('click', () => {
  document.querySelector('.inbox-workspace').classList.remove('show-conversation', 'show-profile');
  $('profile-toggle').setAttribute('aria-expanded', 'false');
});
$('profile-toggle').addEventListener('click', () => {
  const open = document.querySelector('.inbox-workspace').classList.toggle('show-profile');
  $('profile-toggle').setAttribute('aria-expanded', String(open));
});
document.addEventListener('error', event => {
  const img = event.target;
  if (img.tagName === 'IMG' && img.dataset.initials) {
    const replacement = document.createElement('span');
    replacement.className = 'avatar';
    replacement.textContent = img.dataset.initials;
    img.replaceWith(replacement);
  }
}, true);

fetchMessages();
loadReplyStatus();
setInterval(fetchMessages, 3000);
setInterval(() => { if (!document.hidden) loadReplyStatus(); }, 10000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { fetchMessages(); loadReplyStatus(); } });
