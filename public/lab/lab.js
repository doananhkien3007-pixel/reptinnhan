const $ = id => document.getElementById(id);
const state = { boot: null, conversation: null, run: null, busy: false, retry: null };
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const date = value => new Date(value).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
function preference(key, value) {
  try { if (value === undefined) return window.sessionStorage.getItem(key); window.sessionStorage.setItem(key, value); } catch { /* Chat works without browser storage. */ }
}
function status(text, error = false) { $('status').textContent = text; $('status').classList.toggle('error', error); }
async function api(action, body, id) {
  const query = new URLSearchParams({ action, ...(id ? { id } : {}) });
  const response = await fetch(`/api/lab?${query}`, { cache: 'no-store', ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
  let data;
  try { data = await response.json(); } catch { throw new Error('Server chưa trả dữ liệu Lab. Kiểm tra cấu hình Vercel rồi thử lại.'); }
  if (!response.ok) throw Object.assign(new Error(data.error || 'Không xử lý được yêu cầu Lab.'), { status: response.status });
  return data;
}
function controls() {
  const unavailable = !state.boot || !state.boot.openai_ready;
  for (const id of ['send', 'message']) $(id).disabled = state.busy || unavailable;
  for (const id of ['new-chat', 'model']) $(id).disabled = state.busy || !state.boot;
  for (const id of ['customer-name', 'product']) $(id).disabled = state.busy || !state.boot || !!state.conversation;
  $('messages').setAttribute('aria-busy', String(state.busy));
  $('composer').setAttribute('aria-busy', String(state.busy));
  $('send').innerHTML = state.busy ? 'Đang trả lời…' : 'Gửi tin <span aria-hidden="true">↗</span>';
  document.querySelectorAll('[data-conversation]').forEach(button => { button.disabled = state.busy; });
}
function renderList() {
  const records = state.boot?.conversations || [];
  $('conversation-list').innerHTML = records.length ? records.map(c => `<button type="button" data-conversation="${esc(c.id)}" aria-current="${c.id === state.conversation?.id}"><strong>${esc(c.title)}</strong><small>${esc(date(c.updated_at))} · ${c.revision} lượt</small></button>`).join('') : '<p class="muted">Những cuộc trò chuyện của bạn sẽ ở đây.</p>';
  controls();
}
function productFacts() {
  const products = state.conversation?.state.catalog.products || state.boot?.products || [];
  const product = products.find(p => p.id === $('product').value);
  $('product-facts').textContent = product ? JSON.stringify(product, null, 2) : 'Chọn một sản phẩm để xem dữ liệu test.';
}
function renderChat() {
  const history = state.conversation?.state.history || [];
  $('chat-name').textContent = state.conversation?.state.customer.name || 'Một cuộc trò chuyện mới';
  $('chat-count').textContent = state.busy ? 'Emi đang trả lời…' : history.length ? `${history.length} tin · ${state.conversation.revision} lượt` : 'Chưa có tin nhắn';
  $('messages').innerHTML = history.length ? history.map(m => `<div class="message-row ${m.role === 'user' ? 'user' : 'assistant'}"><span class="message-label">${m.role === 'user' ? 'KHÁCH TEST' : 'EMI HOUSE'}</span><div class="bubble">${esc(m.text)}</div>${m.run ? `<button type="button" class="analysis-link" data-run="${esc(m.run.id)}" aria-pressed="${m.run.id === state.run?.id}">Xem Emi hiểu khách ở lượt này ↗</button>` : ''}</div>`).join('') : '<div class="empty-state"><span class="empty-icon">“</span><h3>Bắt đầu bằng lời của khách</h3><p>Hỏi giá, kể nhu cầu hoặc nhắc mẫu trước đó.<br>Emi sẽ đọc ngữ cảnh để tiếp tục tư vấn.</p></div>';
  if (state.busy) $('messages').insertAdjacentHTML('beforeend', '<div class="thinking" role="status">Emi đang đọc ngữ cảnh hội thoại…</div>');
  $('messages').scrollTop = $('messages').scrollHeight;
}
function renderAnalysis() {
  const o = state.run?.output;
  if (!o) { $('analysis').innerHTML = '<div class="empty-state"><span class="empty-icon">✧</span><h3>Mỗi câu trả lời có ngữ cảnh</h3><p>Nhu cầu, thông tin đã biết và điều cần hỏi<br>sẽ xuất hiện sau mỗi lượt chat.</p></div>'; return; }
  const card = (title, content, cls = '') => `<article class="analysis-card ${cls}"><h3>${esc(title)}</h3>${content}</article>`;
  const list = values => values.length ? `<ul>${values.map(v => `<li>${esc(v)}</li>`).join('')}</ul>` : '<p>Chưa có.</p>';
  $('analysis').innerHTML = card('Khách đang muốn gì?', `<p>${esc(o.understanding)}</p>`, 'understanding') +
    card('Thông tin mới từ khách', list(o.new_facts.map(f => `${f.kind === 'fact' ? 'Khách đã nói' : 'Chưa xác nhận'} · ${f.subject} · ${f.key}: ${f.value}`))) +
    card('Nhu cầu và băn khoăn', `<p>${esc(o.purchase_intent.description)}</p>${o.concerns.length ? list(o.concerns) : ''}`) +
    card('Điều Emi cần làm tiếp', `<p>${esc(o.next_best_action)}</p>`) +
    (o.missing_information.length ? card('Thông tin còn thiếu', list(o.missing_information)) : '') +
    (o.uncertainties.length ? card('Điều chưa chắc chắn', list(o.uncertainties)) : '') +
    `<div class="run-meta"><span>${esc(state.run.model)}</span><span>${(state.run.duration_ms / 1000).toFixed(1)} giây</span><span>${esc(date(state.run.created_at))}</span></div>`;
}
function setConversation(c) {
  state.conversation = c; state.run = c.state.last_run; state.retry = null;
  preference('emi.lab.conversation', c.id);
  $('customer-name').value = c.state.customer.name;
  $('product').value = c.state.entry.product_id;
  renderList(); renderChat(); renderAnalysis(); productFacts(); controls();
}
async function refreshList() {
  const boot = await api('bootstrap'); state.boot = boot;
  renderList();
}
async function loadConversation(id) {
  if (state.busy) return;
  state.busy = true; controls();
  try {
    const data = await api('conversation', undefined, id); setConversation(data.conversation);
    status('Đã mở hội thoại đã lưu. Emi sẽ đọc toàn bộ lịch sử khi bạn gửi tin tiếp.');
  } finally { state.busy = false; controls(); }
}
function newConversation() {
  if (state.busy) return;
  state.conversation = null; state.run = null; state.retry = null;
  preference('emi.lab.conversation', ''); $('message').value = '';
  renderList(); renderChat(); renderAnalysis(); productFacts(); controls();
  status('Chọn sản phẩm và gửi lời đầu tiên của khách để bắt đầu.'); $('customer-name').focus();
}
function guarded(fn) { return async event => { try { await fn(event); } catch (error) { status(error.message, true); } }; }
$('composer').addEventListener('submit', guarded(async event => {
  event.preventDefault();
  const message = $('message').value.trim();
  if (state.busy || !message || !state.boot?.openai_ready) return;
  state.busy = true; controls();
  try {
    if (!state.conversation) {
      const data = await api('create', { customer_name: $('customer-name').value, product_id: $('product').value });
      setConversation(data.conversation); await refreshList();
    }
    const old = state.retry;
    const request = old && old.message === message && old.conversation_id === state.conversation.id ? old : { conversation_id: state.conversation.id, request_id: crypto.randomUUID(), revision: state.conversation.revision, message, model: $('model').value.trim() };
    state.retry = request; renderChat(); status('Emi đang đọc persona, sản phẩm và lịch sử để trả lời…');
    const data = await api('turn', request); setConversation(data.conversation);
    $('message').value = '';
    status('Đã lưu lượt chat vào Supabase. Bạn có thể tiếp tục trò chuyện hoặc xem lại từng lượt.');
    await refreshList();
  } catch (error) {
    if (error.status === 409 && state.conversation) {
      const current = await api('conversation', undefined, state.conversation.id);
      setConversation(current.conversation);
    }
    throw error;
  } finally { state.busy = false; controls(); renderChat(); }
}));
$('message').addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); $('composer').requestSubmit(); } });
$('new-chat').addEventListener('click', newConversation);
$('product').addEventListener('change', productFacts);
$('conversation-list').addEventListener('click', guarded(async event => {
  const button = event.target.closest('[data-conversation]'); if (!button || state.busy) return;
  await loadConversation(button.dataset.conversation);
}));
$('messages').addEventListener('click', event => {
  const button = event.target.closest('[data-run]'); if (!button) return;
  state.run = state.conversation.state.history.find(m => m.run?.id === button.dataset.run)?.run;
  renderChat(); renderAnalysis();
  $('analysis-title').scrollIntoView({ behavior: 'smooth', block: 'start' });
});
controls();
guarded(async () => {
  state.boot = await api('bootstrap');
  $('model').value = state.boot.default_model;
  $('persona').textContent = state.boot.persona;
  $('product').innerHTML = state.boot.products.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
  renderList(); productFacts(); controls();
  const previous = preference('emi.lab.conversation');
  if (previous && state.boot.conversations.some(c => c.id === previous)) await loadConversation(previous);
  else status('Sẵn sàng. Chọn sản phẩm và gửi tin nhắn như một khách hàng.');
  if (!state.boot.openai_ready) status('Database đã kết nối. Cần đặt OPENAI_API_KEY trong Environment Variables của project Vercel hiện tại để bắt đầu chat.', true);
})();
