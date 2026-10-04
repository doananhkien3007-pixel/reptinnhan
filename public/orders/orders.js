(() => {
  const $ = id => document.getElementById(id);
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);
  const statuses = { new:'Đơn mới', processing:'Đang xử lý', shipped:'Đang giao', completed:'Hoàn thành', cancelled:'Đã hủy' };
  const fields = { customer_name:'Tên người nhận', phone:'SĐT', address:'Địa chỉ đầy đủ', product:'Sản phẩm', size:'Size' };
  let data = { orders:[],pending:[],total:0,page:0,limit:50 }, page = 0, selected = null, busy = false;
  const date = value => new Date(value).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'});
  const notice = (text, error = false) => { $('notice').textContent = text; $('notice').dataset.error = String(error); };
  async function api(action, body, token = '') {
    const response = await fetch('/api/products?' + new URLSearchParams({ action, page, status:$('status-filter').value }), {
      method:body ? 'POST':'GET', headers:{ ...(token ? {Authorization:'Bearer ' + token}:{}), ...(body ? {'Content-Type':'application/json'}:{}) },
      ...(body ? { body:JSON.stringify(body) } : {}), cache:'no-store'
    });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error || 'Không xử lý được yêu cầu.');
    return value;
  }
  function render() {
    const query = $('search').value.trim().toLocaleLowerCase('vi');
    const rows = data.orders.filter(o => [o.order_code,o.customer_name,o.phone,o.product_name].join(' ').toLocaleLowerCase('vi').includes(query));
    $('order-total').textContent = data.total; $('pending-total').textContent = data.pending.length;
    $('automation-state').textContent = data.enabled ? 'Tự tạo đơn: Đang bật' : 'Tự tạo đơn: Chưa bật';
    $('sync-time').textContent = 'Đồng bộ lúc ' + new Date().toLocaleTimeString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'});
    $('order-rows').innerHTML = rows.map(o => `<tr><td><strong>${escape(o.order_code)}</strong><small>${escape(date(o.created_at))}</small>${o.review_request ? '<small class="review-flag">Cần kiểm tra sửa/hủy</small>':''}</td><td><strong>${escape(o.customer_name)}</strong>${escape(o.phone)}${o.name_source==='facebook'?'<small>Dùng tên Facebook</small>':''}</td><td><strong>${escape(o.product_name)}</strong>Size ${escape(o.size)}${o.color?' · '+escape(o.color):''}<small>Số lượng: ${escape(o.quantity)}</small></td><td class="address-cell">${escape(o.address)}</td><td><span class="badge ${escape(o.status)}">${escape(statuses[o.status]||o.status)}</span></td><td><button class="btn" data-order="${escape(o.id)}">Chi tiết ↗</button></td></tr>`).join('');
    $('empty').hidden = rows.length > 0;
    $('empty').querySelector('h3').textContent = query ? 'Không tìm thấy trên trang này' : 'Chưa có đơn hàng';
    $('page-info').textContent = `Trang ${page+1} / ${Math.max(1,Math.ceil(data.total/data.limit))} · ${data.total} đơn`;
    $('previous').disabled = page === 0; $('next').disabled = (page+1)*data.limit >= data.total;
    document.querySelectorAll('[data-order]').forEach(button => button.addEventListener('click',()=>openDetail(button.dataset.order)));
    $('pending-list').innerHTML = data.pending.length ? data.pending.map(item => {
      const s = item.state;
      return `<article class="pending-card"><h3>${escape(s.customer_name||'Chưa có tên người nhận')}</h3><p>${escape(s.product?.name||'Chưa chọn sản phẩm')} · Size ${escape(s.size||'—')}</p><p>${escape(s.phone||'Chưa có SĐT')}<br>${escape(s.address||'Chưa có địa chỉ')}</p><div class="missing">${s.needs_review?'<span>Nhiều món/thông tin cần shop kiểm tra</span>':(s.missing||[]).map(k=>'<span>Thiếu '+escape(fields[k]||k)+'</span>').join('')}</div></article>`;
    }).join('') : '<p class="pending-none">Không có hội thoại đang chờ hoàn thiện đơn.</p>';
  }
  async function load(silent = false) {
    if (busy) return;
    busy = true; $('refresh').disabled = true; $('status-filter').disabled = true;
    try {
      const result = await api('orders_list');
      data = result; render(); notice('');
    } catch(error) { notice(error.message,true); }
    finally { busy = false; $('refresh').disabled = false; $('status-filter').disabled = false; }
  }
  function openDetail(id) {
    selected = data.orders.find(o=>o.id===id); if (!selected) return;
    const o = selected; $('detail-title').textContent = o.order_code;
    const values = [['Người nhận',o.customer_name],['Nguồn tên',o.name_source==='facebook'?'Tên Facebook':'Khách cung cấp'],['SĐT',o.phone],['Địa chỉ',o.address],['Sản phẩm',o.product_name],['Size / màu',o.size+(o.color?' / '+o.color:'')],['Số lượng',o.quantity],['Tiền hàng',(o.quantity*o.unit_price).toLocaleString('vi-VN')+' ₫ (chưa tính vận chuyển)'],['Yêu cầu sửa/hủy',o.review_request||'Không có'],['Thời gian',date(o.created_at)]];
    $('detail-content').innerHTML = '<dl>'+values.map(([k,v])=>'<dt>'+escape(k)+'</dt><dd>'+escape(v)+'</dd>').join('')+'</dl>';
    $('detail-status').value = o.status; $('status-token').value = ''; $('detail-notice').textContent = ''; $('detail').showModal();
  }
  $('refresh').addEventListener('click',()=>load());
  $('status-filter').addEventListener('change',()=>{if(busy)return;page=0;load();});
  $('search').addEventListener('input',render);
  $('previous').addEventListener('click',()=>{if(!busy&&page>0){page--;load();}});
  $('next').addEventListener('click',()=>{if(!busy){page++;load();}});
  $('close-detail').addEventListener('click',()=>$('detail').close());
  $('detail').addEventListener('close',()=>{$('status-token').value='';});
  $('status-form').addEventListener('submit',async e=>{
    e.preventDefault(); if (!selected) return;
    if (!confirm('Cập nhật đơn '+selected.order_code+' thành “'+statuses[$('detail-status').value]+'”?')) return;
    $('save-status').disabled=true;
    const token = $('status-token').value.trim(); $('status-token').value = '';
    try { await api('orders_status',{id:selected.id,status:$('detail-status').value,updated_at:selected.updated_at},token);$('detail').close();await load();notice('Đã cập nhật trạng thái đơn.'); }
    catch(error){$('detail-notice').textContent=error.message;}
    finally{$('save-status').disabled=false;}
  });
  notice('Đang tải danh sách đơn hàng…');
  load();
  setInterval(()=>{if(!document.hidden&&!$('detail').open)load(true);},15000);
})();
