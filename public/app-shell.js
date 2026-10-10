(() => {
  const paths = {
    chat: '<path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5Z"/><path d="M8 11h8M8 15h5"/>',
    box: '<path d="m12 3 9 5v8l-9 5-9-5V8l9-5Zm0 9v9M3 8l9 5 9-5M7.5 5.5l9 5V15"/>',
    ads: '<path d="m3 10 17-6v16L3 14v-4Zm4 5 2 6h4l-2-5M20 9h2m-2 6h2"/>',
    spark: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3ZM20 2v4m-2-2h4"/>',
    log: '<path d="M4 4h16v16H4zM8 8h8M8 12h8M8 16h5"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    arrow: '<path d="m9 5 7 7-7 7"/>',
    refresh: '<path d="M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12-1l2 3M4 15l2 3a7 7 0 0 0 12-1"/>',
    close: '<path d="m6 6 12 12M6 18 18 6"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    back: '<path d="m14 6-6 6 6 6"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m8 12 3 3 5-6"/>',
    sidebar: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16m7-11-3 3 3 3"/>'
  };
  window.appIcon = (name) => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (paths[name] || paths.chat) + '</svg>';
  window.paintIcons = (root = document) => root.querySelectorAll('[data-icon]').forEach(el => { el.innerHTML = appIcon(el.dataset.icon); });
  const page = document.body.dataset.page || 'inbox';
  const nav = [['inbox', '/', 'chat', 'Hộp thư'], ['products', '/products', 'box', 'Sản phẩm'], ['orders', '/orders', 'log', 'Quản lý đơn'], ['ads', '/ads', 'ads', 'Quảng cáo']];
  const preferenceKey = 'leafchat.sidebar.collapsed';
  let collapsed = false;
  try { collapsed = window.localStorage.getItem(preferenceKey) === 'true'; } catch { /* Layout works without storage. */ }
  document.body.classList.toggle('sidebar-collapsed', collapsed);
  document.body.insertAdjacentHTML('afterbegin', `<aside class="app-sidebar" id="app-sidebar">
    <a class="app-brand" href="/" aria-label="LeafChat — Trang chủ"><span class="brand-symbol">${appIcon('chat')}</span><span class="brand-name">LeafChat<span class="brand-period">.</span></span></a>
    <div class="workspace-label"><span class="workspace-avatar">W</span><div class="sidebar-copy"><strong>Workspace của bạn</strong><small>Facebook Messenger</small></div><span class="workspace-dot"></span></div>
    <span class="nav-caption">KHÔNG GIAN LÀM VIỆC</span>
    <nav class="app-nav" aria-label="Điều hướng chính">${nav.map(([id, href, icon, label]) => `<a href="${href}" aria-label="${label}" data-tooltip="${label}" ${page === id ? 'aria-current="page"' : ''}>${appIcon(icon)}<span class="nav-label">${label}</span>${page === id ? '<span class="nav-active-dot"></span>' : ''}</a>`).join('')}</nav>
    <div class="sidebar-bottom"><div class="sidebar-note">${appIcon('spark')}<strong>Trợ lý của bạn,<br>luôn sẵn sàng.</strong><p>Một không gian cho mọi kết nối với khách hàng.</p></div><div class="workspace-account"><span class="account-avatar">Q</span><div class="sidebar-copy"><strong>Quản trị viên</strong><small>Quản lý workspace</small></div></div></div>
  </aside><div class="sidebar-backdrop" id="sidebar-backdrop" aria-hidden="true"></div><header class="app-topbar"><div class="breadcrumb"><button type="button" class="icon-button sidebar-toggle" id="menu-toggle" aria-label="Thu gọn thanh bên" aria-expanded="true" aria-controls="app-sidebar">${appIcon('sidebar')}</button><span class="breadcrumb-workspace">Workspace</span><span class="breadcrumb-separator">${appIcon('arrow')}</span><strong>${nav.find(n => n[0] === page)?.[3] || 'Hộp thư'}</strong></div><div class="topbar-right"><span class="channel-label"><b>f</b> Messenger</span><span class="account-avatar small" aria-label="Quản trị viên">Q</span></div></header>`);
  const sidebar = document.getElementById('app-sidebar');
  const toggle = document.getElementById('menu-toggle');
  const mobile = window.matchMedia('(max-width: 760px)');
  const syncSidebar = () => {
    const open = document.body.classList.contains('menu-open');
    const expanded = mobile.matches ? open : !collapsed;
    const label = mobile.matches ? (open ? 'Đóng menu' : 'Mở menu') : (collapsed ? 'Mở rộng thanh bên' : 'Thu gọn thanh bên');
    toggle.setAttribute('aria-expanded', String(expanded));
    toggle.setAttribute('aria-label', label);
    toggle.title = label;
    sidebar.inert = mobile.matches && !open;
    document.querySelectorAll('body > main').forEach(el => { el.inert = mobile.matches && open; });
  };
  const closeMenu = () => {
    document.body.classList.remove('menu-open');
    syncSidebar();
    toggle.focus();
  };
  toggle.addEventListener('click', () => {
    if (mobile.matches) {
      const open = document.body.classList.toggle('menu-open');
      syncSidebar();
      if (open) sidebar.querySelector('[aria-current="page"]')?.focus();
    } else {
      collapsed = !collapsed;
      document.body.classList.toggle('sidebar-collapsed', collapsed);
      try { window.localStorage.setItem(preferenceKey, String(collapsed)); } catch { /* Keep the session preference. */ }
      syncSidebar();
    }
  });
  document.getElementById('sidebar-backdrop').addEventListener('click', closeMenu);
  document.addEventListener('keydown', event => {
    if (!mobile.matches || !document.body.classList.contains('menu-open')) return;
    if (event.key === 'Escape') closeMenu();
    if (event.key === 'Tab') {
      const focusable = [toggle, ...sidebar.querySelectorAll('a')];
      const index = focusable.indexOf(document.activeElement);
      const next = (index + (event.shiftKey ? -1 : 1) + focusable.length) % focusable.length;
      event.preventDefault();
      focusable[next].focus();
    }
  });
  mobile.addEventListener('change', () => {
    const hadFocus = sidebar.contains(document.activeElement);
    document.body.classList.remove('menu-open');
    syncSidebar();
    if (mobile.matches && hadFocus) toggle.focus();
  });
  syncSidebar();
  paintIcons();
})();
