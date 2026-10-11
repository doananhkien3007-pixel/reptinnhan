import { randomUUID } from 'node:crypto';
import { generateBrain, validateModel } from '../brain.js';
import { applyMemory, validateBrain } from '../schema.js';
import { settings, defaultModel, now, checkedText, fail, uuid } from './settings.js';
import { loadProductCatalog } from './catalog.js';

export class CloudLabService {
  constructor(store, brain = generateBrain, catalogProvider = () => loadProductCatalog(store.client)) { Object.assign(this, { store, brain, catalogProvider }); }
  async create(sessionId, body) {
    const catalog = await this.catalogProvider();
    const adId = checkedText(body.ad_id, 'Ads ID', 64);
    if (!/^\d+$/.test(adId)) fail(400, 'Ads ID chỉ được chứa chữ số.');
    const ad = catalog.ads.find(item => item.id === adId);
    if (!ad) fail(400, 'Ads ID chưa được gắn với sản phẩm đang hoạt động trong Supabase.');
    const product = catalog.products.find(item => item.id === ad.product_id);
    if (!product) fail(400, 'Không tìm thấy sản phẩm đang hoạt động của Ads ID này.');
    const rawConfig = body.assistant_config ?? {};
    if (!rawConfig || Array.isArray(rawConfig) || typeof rawConfig !== 'object') fail(400, 'Cấu hình trợ lý không hợp lệ.');
    if (rawConfig.custom_instructions != null && typeof rawConfig.custom_instructions !== 'string') fail(400, 'Hướng dẫn bổ sung không hợp lệ.');
    const customInstructions = rawConfig.custom_instructions?.trim() || '';
    if (customInstructions.length > 8000) fail(400, 'Hướng dẫn bổ sung tối đa 8000 ký tự.');
    const assistantConfig = { model: validateModel(rawConfig.model || defaultModel()), custom_instructions: customInstructions };
    const customer = { id: randomUUID(), name: checkedText(body.customer_name || 'Chị khách test', 'Tên khách', 100), profile: '' };
    return this.store.create(sessionId, {
      id: randomUUID(), title: `${customer.name} · ${product.name} · Ads ${ad.id}`,
      state: { customer, catalog: structuredClone(catalog), entry: { product_id: product.id, ad_id: ad.id }, assistant_config: assistantConfig, history: [], memory: [], last_run: null }, revision: 0
    });
  }
  async turn(sessionId, id, body) {
    uuid(id); uuid(body.request_id);
    const message = checkedText(body.message, 'Tin nhắn');
    if (!Number.isSafeInteger(body.revision) || body.revision < 0) fail(400, 'Revision không hợp lệ.');
    const token = randomUUID();
    const claim = await this.store.claim(sessionId, id, body.request_id, token, body.revision);
    if (claim.replayed) return { conversation: claim.conversation, replayed: true };
    try {
      const conversation = claim.conversation;
      const state = conversation.state;
      const activeCatalog = await this.catalogProvider();
      const activeAd = activeCatalog.ads.find(ad => ad.id === state.entry.ad_id);
      if (!activeAd) fail(409, 'Ads ID của hội thoại không còn được gắn với sản phẩm đang hoạt động. Hãy tạo cuộc trò chuyện mới.');
      const activeEntry = { product_id: activeAd.product_id, ad_id: activeAd.id };
      const assistantConfig = state.assistant_config || { model: validateModel(body.model || defaultModel()), custom_instructions: '' };
      const model = validateModel(assistantConfig.model);
      if (state.history.length + 2 > settings.max_history_messages) fail(400, 'Hội thoại đã đủ 160 tin. Tạo cuộc trò chuyện mới để tiếp tục; lịch sử cũ vẫn được giữ.');
      const incoming = { id: randomUUID(), role: 'user', text: message };
      const input = { catalog: activeCatalog, customer: state.customer, entry: activeEntry, history: state.history.map(({ id, role, text, media_ids }) => ({ id, role, text, ...(role === 'assistant' ? { media_ids: media_ids || [] } : {}) })), memory: state.memory, messages: [incoming] };
      if (JSON.stringify(input).length > 180000) fail(400, 'Ngữ cảnh đã quá dài. Mở một hội thoại mới; hội thoại cũ vẫn được lưu.');
      const started = Date.now();
      const result = await this.brain(input, model, settings, { customInstructions: assistantConfig.custom_instructions || '' });
      validateBrain(result.output, input);
      const run = { id: randomUUID(), output: result.output, model: result.actual_model || model, usage: result.usage, versions: result.versions, response_id: result.response_id, duration_ms: Date.now() - started, created_at: now() };
      if (state.history.length + 1 + run.output.messages.length > settings.max_history_messages) fail(400, 'Hội thoại đã đủ 160 tin. Tạo cuộc trò chuyện mới để tiếp tục; lịch sử cũ vẫn được giữ.');
      const replies = run.output.messages.map((message, index) => ({ id: randomUUID(), role: 'assistant', text: message,
        media_ids: index === 0 ? run.output.media_ids : [], ...(index === run.output.messages.length - 1 ? { run } : {}), created_at: now() }));
      const updated = { ...state, catalog: activeCatalog, entry: activeEntry, history: [...state.history, { ...incoming, created_at: now() }, ...replies], memory: applyMemory(state.memory, run.output.memory_updates), last_run: run };
      const saved = await this.store.commit(sessionId, id, body.request_id, token, conversation.revision, updated);
      return { conversation: saved, replayed: false };
    } catch (error) {
      await this.store.release(sessionId, id, token).catch(() => {});
      throw error;
    }
  }
}
