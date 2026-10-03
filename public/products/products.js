let products = [];
    let adMappings = [];
    let editingId = null;
    let uploading = false;
    let saving = false;
    let dirty = false;
    let activeFilter = 'all';
    let productsLoaded = false;
    let mappingsLoaded = false;
    const completedUploads = new WeakMap();

    const $ = (id) => document.getElementById(id);
    const setStatus = (message, error = false) => {
      $('status').textContent = message;
      $('status').dataset.kind = error ? 'error' : 'success';
      $('editor-status').textContent = message;
      $('editor-status').dataset.kind = error ? 'error' : 'success';
    };

    function escapeHtml(value) {
      return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
    }

    function addVariantRow(variant = {}) {
      const row = document.createElement('div');
      row.className = 'variant-row';
      row.innerHTML = `<label>Tên màu<input placeholder="Ví dụ: Đen, xanh lá…" class="variant-color" value="${escapeHtml(variant.color)}"></label>
        <button type="button" class="btn danger remove-variant" aria-label="Xóa màu">Xoá màu</button>
        <div class="color-image-tools">
          <label class="image-file-label">Ảnh của màu này<input class="color-image-files" type="file" accept="image/*" multiple></label>
          <label style="flex-direction:row; align-items:center; gap:5px; font-weight:normal;"><input class="color-image-primary" type="checkbox" style="width:auto"> Ảnh đầu tiên là ảnh chính</label>
          <button type="button" class="btn secondary upload-color-images">Tải ảnh lên ngay</button>
          <span class="muted color-upload-status">${editingId ? 'Chọn ảnh để upload thêm cho màu này.' : 'Lưu sản phẩm trước rồi upload ảnh.'}</span>
        </div>`;
      row.querySelector('.remove-variant').addEventListener('click', () => {
        if (uploading || saving) return;
        row.remove(); dirty = true;
      });
      row.querySelector('.upload-color-images').addEventListener('click', () => { if (!saving) uploadImagesForColor(row); });
      $('variants').appendChild(row);
    }

    function readVariants() {
      return [...document.querySelectorAll('.variant-row')].map((row) => ({
        color: row.querySelector('.variant-color').value.trim()
      })).filter((variant) => variant.color);
    }

    function readProductForm() {
      return {
        name: $('name').value.trim(), price: Number($('price').value || 0),
        material: $('material').value.trim(), size_guide: $('size-guide').value.trim()
      };
    }

    function clearForm() {
      if (uploading) return;
      editingId = null;
      $('product-form').reset();
      $('form-title').textContent = 'Thêm sản phẩm';
      $('cancel-edit').hidden = false;
      $('editor-status').textContent = '';
      $('saved-images').innerHTML = '';
      dirty = false;
      $('variants').innerHTML = '';
      $('product-video-files').value = '';
      $('upload-product-videos').disabled = true;
      $('product-video-status').textContent = 'Lưu sản phẩm để upload video.';
      $('product-videos').innerHTML = '';
      $('product-attachment-ids').innerHTML = '<span class="muted">Lưu hoặc chọn sửa sản phẩm để xem ID.</span>';
      addVariantRow();
    }

    function editProduct(product) {
      if (uploading || saving || !product) return;
      editingId = product.id;
      $('form-title').textContent = `Sửa sản phẩm: ${product.name}`;
      for (const [id, value] of Object.entries({ name: product.name, price: product.price, material: product.material, 'size-guide': product.size_guide })) $(id).value = value ?? '';
      $('variants').innerHTML = '';
      (product.variants || []).forEach(addVariantRow);
      if (!product.variants?.length) addVariantRow();
      $('cancel-edit').hidden = false;
      $('product-video-files').value = '';
      $('upload-product-videos').disabled = false;
      $('product-video-status').textContent = 'Có thể upload thêm video ngay cho sản phẩm này.';
      renderProductAttachmentIds(product);
      renderProductVideos(product);
      renderSavedImages(product);
      dirty = false;
      $('editor-status').textContent = '';
      if (!$('product-dialog').open) $('product-dialog').showModal();
    }

    function renderProductAttachmentIds(product) {
      const media = (product?.images || []).filter((item) => String(item.facebook_attachment_id || '').trim());
      $('product-attachment-ids').innerHTML = media.length
        ? media.map((item) => {
            const type = item.media_type === 'video' ? 'Video' : 'Ảnh';
            const color = item.color ? ` · Màu ${escapeHtml(item.color)}` : '';
            return `<div class="attachment-row"><b>${type}${color}</b><br><code>${escapeHtml(item.facebook_attachment_id)}</code></div>`;
          }).join('')
        : '<span class="muted">Sản phẩm chưa có attachment ID.</span>';
    }

    function renderProductVideos(product) {
      const videos = (product?.images || []).filter((item) => item.media_type === 'video');
      $('product-videos').innerHTML = videos.length
        ? videos.map((video) => `<div class="video-item">Video đã lưu trên Facebook<br><span class="muted">ID: ${escapeHtml(video.facebook_attachment_id)}</span></div>`).join('')
        : '<span class="muted">Sản phẩm chưa có video.</span>';
    }

    function productColors(product) {
      return [...new Set((product.colors || product.variants?.map(variant => variant.color) || []).filter(Boolean))];
    }
    function missingFields(product) {
      const fields = [];
      if (!(product.images || []).some(item => item.media_type !== 'video' && item.image_url)) fields.push('ảnh');
      if (!product.material?.trim()) fields.push('chất liệu');
      if (!product.size_guide?.trim()) fields.push('bảng size');
      if (!productColors(product).length) fields.push('màu');
      return fields;
    }
    function isActive(product) { return !product.status || product.status === 'active'; }
    function productIcon(name) { return window.appIcon ? window.appIcon(name) : ''; }
    function renderMetrics() {
      $('total-products').textContent = productsLoaded ? products.length : '—';
      $('active-products').textContent = productsLoaded ? products.filter(isActive).length : '—';
      $('incomplete-products').textContent = productsLoaded ? products.filter(product => missingFields(product).length).length : '—';
      $('linked-ads').textContent = mappingsLoaded ? adMappings.length : '—';
      $('catalog-count').textContent = productsLoaded ? products.length : '—';
      $('tab-all').textContent = products.length;
    }
    function filteredProducts() {
      const query = $('product-search').value.trim().toLocaleLowerCase('vi');
      const filtered = products.filter(product => {
        if (activeFilter === 'active' && !isActive(product)) return false;
        if (activeFilter === 'inactive' && isActive(product)) return false;
        if (activeFilter === 'incomplete' && !missingFields(product).length) return false;
        return [product.name, product.sku, product.id, product.material, ...productColors(product)].join(' ').toLocaleLowerCase('vi').includes(query);
      });
      const sort = $('product-sort').value;
      if (sort === 'name') filtered.sort((a, b) => a.name.localeCompare(b.name, 'vi'));
      if (sort === 'price-low') filtered.sort((a, b) => Number(a.price) - Number(b.price));
      if (sort === 'price-high') filtered.sort((a, b) => Number(b.price) - Number(a.price));
      return filtered;
    }
    function renderSavedImages(product) {
      $('saved-images').innerHTML = (product?.images || []).filter(item => item.media_type !== 'video' && item.image_url).map(image =>
        '<figure><img src="' + escapeHtml(image.image_url) + '" alt="' + escapeHtml(image.color || 'Ảnh sản phẩm') + '" loading="lazy"><figcaption>' + escapeHtml(image.color || 'Ảnh sản phẩm') + (image.is_primary ? ' · Ảnh chính' : '') + '</figcaption></figure>').join('');
    }
    function renderProducts() {
      renderMetrics();
      const visible = filteredProducts();
      $('result-count').textContent = 'Hiển thị ' + visible.length + ' / ' + products.length + ' sản phẩm';
      $('products').innerHTML = visible.length ? visible.map(product => {
        const media = product.images || [];
        const photos = media.filter(item => item.media_type !== 'video');
        const cover = photos.find(item => item.is_primary && item.image_url) || photos.find(item => item.image_url);
        const videos = media.filter(item => item.media_type === 'video').length;
        const colors = productColors(product);
        const missing = missingFields(product);
        const active = isActive(product);
        const linked = adMappings.filter(item => Number(item.product_id) === Number(product.id)).length;
        return `<article class="product-card">
          <div class="product-cover">${cover ? `<img src="${escapeHtml(cover.image_url)}" alt="${escapeHtml(product.name)}" loading="lazy">` : `<div class="cover-placeholder">${productIcon('box')}<span>Chưa có ảnh sản phẩm</span></div>`}
            <span class="product-state ${active ? '' : 'inactive'}"><i></i>${active ? 'Đang bán' : 'Tạm ẩn'}</span>
            <span class="media-count">${photos.length} ảnh${videos ? ' · ' + videos + ' video' : ''}</span>
          </div>
          <div class="product-content"><div class="product-code">${escapeHtml(product.sku || 'SP-' + product.id)}<span>${mappingsLoaded ? linked + ' quảng cáo' : '— quảng cáo'}</span></div>
            <h3>${escapeHtml(product.name)}</h3><p class="product-material">${escapeHtml(product.material || 'Chưa có thông tin chất liệu')}</p>
            <div class="product-price">${Number(product.price || 0).toLocaleString('vi-VN')}<span>₫</span></div>
            <div class="product-colors">${colors.slice(0, 3).map(color => '<span>' + escapeHtml(color) + '</span>').join('') || '<span class="no-color">Chưa thêm màu</span>'}${colors.length > 3 ? '<span>+' + (colors.length - 3) + '</span>' : ''}</div>
            <div class="readiness ${missing.length ? 'needs-info' : ''}">${productIcon(missing.length ? 'spark' : 'check')}<span>${missing.length ? 'Bổ sung ' + escapeHtml(missing.join(', ')) : 'Đủ thông tin tư vấn'}</span></div>
          </div>
          <footer class="product-card-footer"><button type="button" class="btn edit-button" data-edit="${product.id}">${productIcon('box')}Chỉnh sửa</button>
            <button type="button" class="text-button" data-toggle="${product.id}" data-status="${active ? 'active' : 'inactive'}" aria-label="${active ? 'Tạm ẩn' : 'Mở bán'} ${escapeHtml(product.name)}">${active ? 'Tạm ẩn' : 'Mở bán'}</button>
            <button type="button" class="delete-button" data-delete="${product.id}" aria-label="Xóa ${escapeHtml(product.name)}" title="Xóa sản phẩm"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7m4-7v7"/></svg></button>
          </footer></article>`;
      }).join('') : '<div class="catalog-empty">' + productIcon('box') + '<h3>' + (products.length ? 'Không tìm thấy sản phẩm' : 'Bắt đầu với sản phẩm đầu tiên') + '</h3><p>' + (products.length ? 'Thử từ khóa khác hoặc đổi bộ lọc.' : 'Thêm thông tin và hình ảnh để trợ lý bắt đầu tư vấn cho khách.') + '</p><button class="btn btn-primary" type="button" id="empty-action">' + (products.length ? 'Xóa bộ lọc' : '+ Thêm sản phẩm') + '</button></div>';
      $('empty-action')?.addEventListener('click', () => {
        if (!products.length) openNewProduct();
        else { $('product-search').value = ''; setFilter('all'); }
      });
      document.querySelectorAll('[data-edit]').forEach(button => button.addEventListener('click', () => editProduct(products.find(p => p.id === Number(button.dataset.edit)))));
      document.querySelectorAll('[data-toggle]').forEach(button => button.addEventListener('click', () => runCardAction(button, () => toggleProduct(Number(button.dataset.toggle), button.dataset.status))));
      document.querySelectorAll('[data-delete]').forEach(button => button.addEventListener('click', () => runCardAction(button, () => deleteProduct(Number(button.dataset.delete)))));
    }

    function renderMappingProducts() {
      $('mapping-product-id').innerHTML = products.length
        ? products.map((product) => `<option value="${product.id}">${escapeHtml(product.name)} · ID ${product.id}</option>`).join('')
        : '<option value="">Chưa có sản phẩm</option>';
    }

    function renderAdMappings() {
      $('ad-mappings').innerHTML = adMappings.length
        ? adMappings.map((mapping) => {
            const product = products.find((item) => Number(item.id) === Number(mapping.product_id));
            return `<div class="mapping-row"><code>${escapeHtml(mapping.ad_id)}</code><span>${escapeHtml(product?.name || `Sản phẩm ID ${mapping.product_id}`)}</span><button type="button" class="btn danger" data-delete-mapping="${escapeHtml(mapping.ad_id)}">Xoá</button></div>`;
          }).join('')
        : '<span class="muted">Chưa có quảng cáo nào được mapping.</span>';
      document.querySelectorAll('[data-delete-mapping]').forEach((button) => button.addEventListener('click', () => runCardAction(button, () => deleteAdMapping(button.dataset.deleteMapping))));
    }

    async function loadProducts() {
      const response = await fetch('/api/products?action=list');
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Không thể tải sản phẩm.');
      if (!Array.isArray(data)) throw new Error('Dữ liệu sản phẩm không hợp lệ.');
      products = data;
      productsLoaded = true;
      renderProducts();
      renderMappingProducts();
      renderAdMappings();
    }

    async function loadAdMappings() {
      const response = await fetch('/api/products?action=ad_mappings');
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Không thể tải mapping quảng cáo.');
      if (!Array.isArray(data)) throw new Error('Dữ liệu liên kết không hợp lệ.');
      adMappings = data;
      mappingsLoaded = true;
      renderAdMappings();
      renderMetrics();
      if (productsLoaded) renderProducts();
    }

    async function saveAdMapping(event) {
      event.preventDefault();
      $('save-mapping').disabled = true;
      try {
      const response = await fetch('/api/products?action=save_ad_mapping', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ad_id: $('mapping-ad-id').value.trim(), product_id: Number($('mapping-product-id').value) })
      });
      const data = await response.json();
      if (!response.ok) { $('mapping-status').textContent = data.error || 'Không thể lưu mapping.'; return; }
      $('mapping-ad-id').value = '';
      $('mapping-status').textContent = `Đã mapping Ads ID ${data.ad_id}.`;
      await loadAdMappings();
      } catch (error) { $('mapping-status').textContent = error.message; }
      finally { $('save-mapping').disabled = false; }
    }

    async function deleteAdMapping(adId) {
      if (!confirm('Gỡ liên kết quảng cáo ' + adId + ' khỏi sản phẩm?')) return;
      const response = await fetch('/api/products?action=delete_ad_mapping', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ad_id: adId })
      });
      const data = await response.json();
      if (!response.ok) { $('mapping-status').textContent = data.error || 'Không thể xoá mapping.'; return; }
      $('mapping-status').textContent = `Đã xoá mapping Ads ID ${adId}.`;
      await loadAdMappings();
    }

    async function saveProduct(event) {
      event.preventDefault();
      if (uploading || saving) { setStatus('Đợi thao tác hiện tại hoàn tất trước khi lưu.', true); return; }
      saving = true;
      $('save-product').disabled = true;
      $('save-product').textContent = 'Đang lưu…';
      $('editor-status').textContent = '';
      try {
        const colorRows = [...document.querySelectorAll('.variant-row')];
        const response = await fetch(`/api/products?action=${editingId ? 'update' : 'create'}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: editingId, product: readProductForm(), variants: readVariants() }) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Không thể lưu sản phẩm.');
        const productId = Number(data.id);
        editingId = productId;
        $('upload-product-videos').disabled = false;
        const rowsWithImages = colorRows.filter((row) => row.querySelector('.color-image-files').files.length);
        for (const row of rowsWithImages) {
          if (!await uploadImagesForColor(row, productId, false)) throw new Error('Lưu sản phẩm được nhưng upload ảnh/video thất bại.');
        }
        const hasVideos = $('product-video-files').files.length > 0;
        if (hasVideos && !await uploadProductVideos(productId, false)) throw new Error('Đã lưu sản phẩm nhưng upload video thất bại.');
        setStatus(rowsWithImages.length || hasVideos ? 'Đã lưu sản phẩm và ảnh/video.' : 'Đã lưu sản phẩm.');
        dirty = false;
        clearForm();
        $('product-dialog').close();
        await loadProducts();
      } catch (error) { setStatus(error.message, true); }
      finally { saving = false; $('save-product').disabled = false; $('save-product').textContent = 'Lưu sản phẩm'; }
    }

    async function toggleProduct(id, currentStatus) {
      const response = await fetch('/api/products?action=toggle', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, status: currentStatus === 'active' ? 'inactive' : 'active' }) });
      if (!response.ok) setStatus('Không thể đổi trạng thái.', true); else await loadProducts();
    }

    async function deleteProduct(id) {
      const product = products.find(item => item.id === id);
      if (!confirm('Xóa sản phẩm “' + (product?.name || id) + '”? Thao tác này không thể hoàn tác từ giao diện.')) return;
      const response = await fetch('/api/products?action=delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
      if (!response.ok) setStatus('Không thể xoá sản phẩm.', true); else { await Promise.all([loadProducts(), loadAdMappings()]); setStatus('Đã xóa sản phẩm.'); }
    }

    function readFileAsDataUrl(file) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); }); }
    async function uploadImagesForColor(row, productId = editingId, refresh = true) {
      const color = row.querySelector('.variant-color').value.trim();
      const files = [...row.querySelector('.color-image-files').files];
      const status = row.querySelector('.color-upload-status');
      const isPrimary = row.querySelector('.color-image-primary').checked;
      const firstImageIndex = files.findIndex((file) => file.type.startsWith('image/'));
      if (uploading) { status.textContent = 'Đang upload, vui lòng đợi hoàn tất.'; return false; }
      if (!productId || !color || !files.length) { status.textContent = 'Hãy lưu sản phẩm, nhập màu và chọn ảnh/video.'; return false; }
      uploading = true;
      try {
        for (const [index, file] of files.entries()) {
          if (completedUploads.get(file) === productId) continue;
          status.textContent = `Đang upload ${index + 1}/${files.length}...`;
          if (!file.type.startsWith('image/')) throw new Error('Chọn ảnh ở mục này; video có mục upload riêng bên dưới.');
          const response = await fetch('/api/products?action=upload_image', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ product_id: Number(productId), color, filename: file.name, data: await readFileAsDataUrl(file), is_primary: index === firstImageIndex && isPrimary, sort_order: index }) });
          const data = await response.json();
          if (!response.ok) throw new Error(data.error || 'Upload thất bại.');
          completedUploads.set(file, productId);
        }
        status.textContent = 'Upload thành công.';
        row.querySelector('.color-image-files').value = '';
        row.querySelector('.color-image-primary').checked = false;
        if (refresh) {
          await loadProducts();
          const product = products.find(item => item.id === productId);
          renderSavedImages(product); renderProductAttachmentIds(product);
        }
        return true;
      } catch (error) { status.textContent = error.message; return false; }
      finally { uploading = false; }
    }

    async function uploadProductVideos(productId = editingId, refresh = true) {
      const status = $('product-video-status');
      const files = [...$('product-video-files').files];
      if (uploading) { status.textContent = 'Đang upload, vui lòng đợi hoàn tất.'; return false; }
      if (!productId || !files.length) { status.textContent = 'Hãy lưu sản phẩm và chọn video trước khi upload.'; return false; }
      uploading = true;
      $('upload-product-videos').disabled = true;
      try {
        for (const [index, file] of files.entries()) {
          if (completedUploads.get(file) === productId) continue;
          if (file.type !== 'video/mp4' && !/\.mp4$/i.test(file.name)) throw new Error('Chỉ hỗ trợ video MP4.');
          await uploadVideo(file, productId, '', index, status);
          completedUploads.set(file, productId);
        }
        $('product-video-files').value = '';
        status.textContent = 'Đã upload video lên Facebook.';
        if (refresh) {
          await loadProducts();
          renderProductVideos(products.find((product) => product.id === productId));
          renderProductAttachmentIds(products.find((product) => product.id === productId));
        }
        return true;
      } catch (error) { status.textContent = error.message; return false; }
      finally { uploading = false; $('upload-product-videos').disabled = !editingId; }
    }

    async function uploadVideo(file, productId, color, sortOrder, status) {
      if (!file.size) throw new Error('Video MP4 không được để trống.');
      status.textContent = `Đang chuẩn bị tải ${file.name}...`;
      const prepareResponse = await fetch('/api/products?action=prepare_video_upload', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_id: Number(productId), filename: file.name })
      });
      const prepared = await prepareResponse.json().catch(() => ({}));
      if (!prepareResponse.ok || !prepared.signed_url || !prepared.path) {
        throw new Error(prepared.error || 'Không thể chuẩn bị đường dẫn upload video.');
      }
      status.textContent = `Đang tải ${file.name} lên kho lưu trữ...`;
      const form = new FormData();
      form.append('cacheControl', '3600');
      form.append('', file);
      const storageResponse = await fetch(prepared.signed_url, { method: 'PUT', body: form });
      if (!storageResponse.ok) {
        const storageError = await storageResponse.json().catch(() => ({}));
        throw new Error(storageError.message || storageError.error || `Kho lưu trữ từ chối video (HTTP ${storageResponse.status}).`);
      }
      status.textContent = `Đang lấy attachment ID Facebook cho ${file.name}...`;
      const response = await fetch('/api/products?action=finalize_video_upload', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_id: Number(productId), path: prepared.path, color, sort_order: Number(sortOrder)
        })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Không thể upload video lên Facebook. Hãy thử lại.');
      return data;
    }

    $('product-form').addEventListener('submit', saveProduct);
    $('mapping-form').addEventListener('submit', saveAdMapping);
    $('add-variant').addEventListener('click', () => { if (!uploading && !saving) { addVariantRow(); dirty = true; } });
    $('cancel-edit').addEventListener('click', closeEditor);
    $('upload-product-videos').addEventListener('click', () => { if (!saving) uploadProductVideos(); });
    function openNewProduct() {
      if (saving || uploading) return;
      clearForm();
      $('product-dialog').showModal();
    }
    function closeEditor() {
      if (uploading || saving) { setStatus('Đang lưu hoặc tải tệp. Vui lòng đợi hoàn tất.', true); return; }
      if (dirty && !confirm('Bạn có thay đổi chưa lưu. Đóng và bỏ các thay đổi này?')) return;
      $('product-dialog').close();
      clearForm();
    }
    async function runCardAction(button, action) {
      button.disabled = true;
      try { await action(); } catch (error) { setStatus(error.message, true); $('mapping-status').textContent = error.message; }
      finally { button.disabled = false; }
    }
    function setFilter(filter) {
      activeFilter = filter;
      document.querySelectorAll('[data-filter]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.filter === filter)));
      renderProducts();
    }
    async function refreshCatalog() {
      $('refresh-products').disabled = true;
      $('status').textContent = '';
      const results = await Promise.allSettled([loadProducts(), loadAdMappings()]);
      const errors = results.filter(result => result.status === 'rejected').map(result => result.reason.message);
      if (errors.length) {
        setStatus(errors.join(' '), true);
        if (results[1].status === 'rejected') $('mapping-status').textContent = results[1].reason.message;
        if (!productsLoaded) $('products').innerHTML = '<div class="catalog-empty"><h3>Chưa tải được danh mục</h3><p>Kiểm tra kết nối và bấm Làm mới để thử lại.</p></div>';
      }
      $('refresh-products').disabled = false;
    }
    $('new-product').addEventListener('click', openNewProduct);
    $('close-editor').addEventListener('click', closeEditor);
    $('product-dialog').addEventListener('cancel', event => { event.preventDefault(); closeEditor(); });
    $('product-form').addEventListener('input', () => { dirty = true; });
    $('product-form').addEventListener('change', () => { dirty = true; });
    $('open-mappings').addEventListener('click', () => $('mapping-dialog').showModal());
    $('close-mappings').addEventListener('click', () => $('mapping-dialog').close());
    $('product-search').addEventListener('input', renderProducts);
    $('product-sort').addEventListener('change', renderProducts);
    $('refresh-products').addEventListener('click', refreshCatalog);
    $('show-incomplete').addEventListener('click', () => { $('product-search').value = ''; setFilter('incomplete'); });
    document.querySelectorAll('[data-filter]').forEach(button => button.addEventListener('click', () => setFilter(button.dataset.filter)));
    clearForm();
    refreshCatalog();
