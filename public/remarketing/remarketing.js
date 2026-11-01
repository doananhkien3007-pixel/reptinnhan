(() => {
  const $ = id => document.getElementById(id);
  const controls = () => [$('remarketing-dry-run'), $('remarketing-enable'), $('remarketing-disable'), $('remarketing-max-steps')];
  let config = null;
  let busy = false;

  async function api(action, options = {}) {
    const response = await fetch('/api/webhook?action=' + encodeURIComponent(action), { cache:'no-store', ...options });
    const raw = await response.text();
    let value;
    try { value = raw ? JSON.parse(raw) : {}; } catch { value = { error: raw }; }
    if (!response.ok) throw new Error(value.error || 'Không xử lý được yêu cầu.');
    return value;
  }

  function modeOf(value) {
    if (!value?.available) return { label:'Chưa sẵn sàng', badge:'Chưa cài', className:'off' };
    if (!value.enabled) return { label:'Đang tắt', badge:'Đã tắt', className:'off' };
    if (value.dry_run) return { label:'Dry-run', badge:'DRY-RUN', className:'dry' };
    return { label:'Đang gửi thật', badge:'ĐANG HOẠT ĐỘNG', className:'live' };
  }

  function render() {
    const mode = modeOf(config);
    $('metric-mode').textContent = mode.label;
    $('metric-availability').textContent = config?.available ? 'Mô-đun đã kết nối Supabase' : 'Mô-đun chưa được bật trên bản triển khai';
    $('metric-scheduled').textContent = String(Number(config?.scheduled_count || 0));
    $('metric-claimed').textContent = String(Number(config?.claimed_count || 0));
    $('metric-uncertain').textContent = String(Number(config?.uncertain_count || 0));
    $('mode-badge').textContent = mode.badge;
    $('mode-badge').className = 'mode-badge ' + mode.className;
    if (config?.max_steps) $('remarketing-max-steps').value = String(config.max_steps);
    controls().forEach(control => { control.disabled = busy || !config?.available; });
    if (!config?.available) {
      setNotice('Bản triển khai hiện tại chưa bật mô-đun Remarketing. Hộp thư vẫn hoạt động bình thường.', true);
    } else if (!busy) {
      setNotice(mode.label + ' · Tối đa ' + Number(config.max_steps || 1) + ' lần nhắc · Cập nhật ' + new Date().toLocaleTimeString('vi-VN', { timeZone:'Asia/Ho_Chi_Minh' }));
    }
  }

  function setNotice(message, error = false) {
    $('remarketing-status').textContent = message;
    $('remarketing-status').dataset.error = String(error);
  }

  async function load() {
    if (busy) return;
    busy = true;
    $('refresh-remarketing').disabled = true;
    setNotice('Đang tải trạng thái…');
    try { config = await api('remarketing_status'); }
    catch (error) { config = { available:false }; setNotice(error.message, true); }
    finally { busy = false; $('refresh-remarketing').disabled = false; render(); }
  }

  async function save(enabled, dryRun) {
    if (busy || !config?.available) return;
    const token = $('remarketing-admin-token').value.trim();
    if (!token) { setNotice('Nhập mã quản trị trước khi thay đổi cấu hình.', true); $('remarketing-admin-token').focus(); return; }
    if (enabled && !dryRun && !window.confirm('Bật gửi thật sẽ cho phép hệ thống gửi tin Remarketing tới khách đủ điều kiện. Bạn chắc chắn muốn tiếp tục?')) return;
    busy = true;
    controls().forEach(control => { control.disabled = true; });
    $('refresh-remarketing').disabled = true;
    setNotice('Đang cập nhật cấu hình…');
    try {
      config = await api('remarketing_config', {
        method:'POST',
        headers:{ 'Content-Type':'application/json', Authorization:'Bearer ' + token },
        body:JSON.stringify({ enabled, dry_run:dryRun, max_steps:Number($('remarketing-max-steps').value) === 2 ? 2 : 1 })
      });
      $('remarketing-admin-token').value = '';
    } catch (error) { setNotice(error.message, true); }
    finally { busy = false; $('refresh-remarketing').disabled = false; render(); }
  }

  $('refresh-remarketing').addEventListener('click', load);
  $('remarketing-dry-run').addEventListener('click', () => save(true, true));
  $('remarketing-enable').addEventListener('click', () => save(true, false));
  $('remarketing-disable').addEventListener('click', () => save(false, true));
  load();
  window.setInterval(() => { if (!document.hidden && !busy) load(); }, 30000);
})();
