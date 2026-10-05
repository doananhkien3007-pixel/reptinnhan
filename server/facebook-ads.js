const DEFAULT_GRAPH_VERSION = 'v26.0';
const MAX_PAGES = 10;

export function normalizeAdAccountId(value) {
  const raw = String(value || '').trim();
  const numericId = raw.replace(/^act_/i, '');
  if (!/^\d+$/.test(numericId)) {
    throw new Error('FB_AD_ACCOUNT_ID phải là dãy số hoặc có dạng act_123456789.');
  }
  return `act_${numericId}`;
}

async function resolveAdAccountId({ accountId, accessToken, version, fetchImpl }) {
  if (String(accountId || '').trim()) return normalizeAdAccountId(accountId);
  const url = new URL(`https://graph.facebook.com/${version}/me/adaccounts`);
  url.searchParams.set('fields', 'id,name,account_status');
  url.searchParams.set('limit', '100');
  const response = await fetchImpl(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.error) {
    throw new Error(`Không thể tự tìm Ad Account: ${result.error?.message || `HTTP ${response.status}`}. Hãy cấu hình FB_AD_ACCOUNT_ID.`);
  }
  const accounts = Array.isArray(result.data) ? result.data : [];
  if (accounts.length === 1) return normalizeAdAccountId(accounts[0].id);
  if (!accounts.length) throw new Error('Token không truy cập được Ad Account nào. Hãy kiểm tra quyền ads_read hoặc cấu hình FB_AD_ACCOUNT_ID.');
  const labels = accounts.slice(0, 5).map((account) => `${account.id}${account.name ? ` (${account.name})` : ''}`).join(', ');
  throw new Error(`Token truy cập nhiều Ad Account: ${labels}. Hãy chọn một tài khoản bằng FB_AD_ACCOUNT_ID.`);
}

function firstNonEmpty(...values) {
  return values.find((value) => typeof value === 'string' && value.trim())?.trim() || null;
}

export function getCreativeCover(creative = {}) {
  const story = creative.object_story_spec || {};
  const linkData = story.link_data || story.template_data || {};
  const videoData = story.video_data || {};
  const firstAssetImage = creative.asset_feed_spec?.images?.find((image) => image?.url)?.url;
  return firstNonEmpty(
    creative.image_url,
    creative.thumbnail_url,
    linkData.picture,
    videoData.image_url,
    firstAssetImage
  );
}

export function getCreativeDestination(creative = {}) {
  const story = creative.object_story_spec || {};
  const linkData = story.link_data || story.template_data || {};
  const videoData = story.video_data || {};
  const callToActionLink = videoData.call_to_action?.value?.link;
  const assetLink = creative.asset_feed_spec?.link_urls?.find((item) => item?.website_url)?.website_url;
  return firstNonEmpty(linkData.link, callToActionLink, assetLink);
}

export function normalizeFacebookAd(ad = {}) {
  const creative = ad.creative || {};
  return {
    id: String(ad.id || ''),
    name: String(ad.name || 'Quảng cáo chưa đặt tên'),
    status: String(ad.status || 'UNKNOWN'),
    effective_status: String(ad.effective_status || ad.status || 'UNKNOWN'),
    created_time: ad.created_time || null,
    updated_time: ad.updated_time || null,
    creative_id: creative.id ? String(creative.id) : null,
    creative_name: creative.name || null,
    creative_type: creative.object_type || null,
    cover_url: getCreativeCover(creative),
    destination_url: getCreativeDestination(creative)
  };
}

function normalizeSearchText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('vi-VN')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function containsToken(haystack, needle) {
  if (!needle) return false;
  return ` ${haystack} `.includes(` ${needle} `);
}

export function suggestProductForAd(ad, products = []) {
  const source = normalizeSearchText([
    ad.name,
    ad.creative_name,
    ad.destination_url
  ].filter(Boolean).join(' '));

  const candidates = products.map((product) => {
    const sku = normalizeSearchText(product.sku);
    const name = normalizeSearchText(product.name);
    let score = 0;
    let reason = null;
    if (sku && containsToken(source, sku)) {
      score = 100 + sku.length;
      reason = `SKU ${product.sku}`;
    } else if (name && source.includes(name)) {
      score = 70 + name.length;
      reason = `tên sản phẩm ${product.name}`;
    } else if (name) {
      const meaningfulWords = name.split(' ').filter((word) => word.length >= 4);
      const matchedWords = meaningfulWords.filter((word) => containsToken(source, word));
      if (meaningfulWords.length >= 2 && matchedWords.length >= 2) {
        score = 20 + matchedWords.length;
        reason = `${matchedWords.length} từ khoá tên sản phẩm`;
      }
    }
    return { product, score, reason };
  }).filter((candidate) => candidate.score > 0).sort((a, b) => b.score - a.score);

  if (!candidates.length) return null;
  return {
    product_id: candidates[0].product.id,
    reason: candidates[0].reason,
    confidence: candidates[0].score >= 70 ? 'high' : 'medium'
  };
}

export async function fetchFacebookAds({ accountId, accessToken, version = DEFAULT_GRAPH_VERSION, fetchImpl = fetch }) {
  if (!accessToken) throw new Error('Thiếu FB_MARKETING_ACCESS_TOKEN riêng có quyền ads_read. Không dùng PAGE_ACCESS_TOKEN của Messenger.');
  const graphVersion = /^v\d+\.\d+$/.test(String(version)) ? String(version) : DEFAULT_GRAPH_VERSION;
  const normalizedAccountId = await resolveAdAccountId({
    accountId, accessToken, version: graphVersion, fetchImpl
  });
  const fields = [
    'id', 'name', 'status', 'effective_status', 'created_time', 'updated_time',
    'creative{id,name,thumbnail_url,image_url,object_type,object_story_spec,asset_feed_spec}'
  ].join(',');
  const ads = [];
  let after = null;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const url = new URL(`https://graph.facebook.com/${graphVersion}/${normalizedAccountId}/ads`);
    url.searchParams.set('fields', fields);
    url.searchParams.set('limit', '100');
    if (after) url.searchParams.set('after', after);
    const response = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.error) {
      const message = result.error?.message || `HTTP ${response.status}`;
      throw new Error(`Facebook Marketing API từ chối yêu cầu: ${message}`);
    }
    const activeAds = (Array.isArray(result.data) ? result.data : [])
      .map(normalizeFacebookAd)
      .filter((ad) => ad.effective_status === 'ACTIVE');
    ads.push(...activeAds);
    after = result.paging?.cursors?.after || null;
    if (!after || !result.paging?.next) break;
  }

  return { account_id: normalizedAccountId, ads };
}
