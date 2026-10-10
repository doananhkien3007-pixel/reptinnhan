import { randomUUID } from 'node:crypto';
import { generateBrain, validateModel } from '../brain.js';
import { applyMemory, validateBrain } from '../schema.js';
import { catalog, settings, defaultModel, now, checkedText, fail, uuid } from './settings.js';

export class CloudLabService {
  constructor(store, brain = generateBrain) { Object.assign(this, { store, brain }); }
  async create(sessionId, body) {
    const product = catalog.products.find(p => p.id === body.product_id);
    if (!product) fail(400, 'Chọn một sản phẩm test trong Lab.');
    const customer = { id: randomUUID(), name: checkedText(body.customer_name || 'Chị khách test', 'Tên khách', 100), profile: '' };
    return this.store.create(sessionId, {
      id: randomUUID(), title: `${customer.name} · ${product.name}`,
      state: { customer, catalog, entry: { product_id: product.id, ad_id: null }, history: [], memory: [], last_run: null }, revision: 0
    });
  }
  async turn(sessionId, id, body) {
    uuid(id); uuid(body.request_id);
    const message = checkedText(body.message, 'Tin nhắn');
    if (!Number.isSafeInteger(body.revision) || body.revision < 0) fail(400, 'Revision không hợp lệ.');
    const model = validateModel(body.model || defaultModel());
    const token = randomUUID();
    const claim = await this.store.claim(sessionId, id, body.request_id, token, body.revision);
    if (claim.replayed) return { conversation: claim.conversation, replayed: true };
    try {
      const conversation = claim.conversation;
      const state = conversation.state;
      if (state.history.length + 2 > settings.max_history_messages) fail(400, 'Hội thoại đã đủ 160 tin. Tạo cuộc trò chuyện mới để tiếp tục; lịch sử cũ vẫn được giữ.');
      const incoming = { id: randomUUID(), role: 'user', text: message };
      const input = { catalog: state.catalog, customer: state.customer, entry: state.entry, history: state.history.map(({ id, role, text }) => ({ id, role, text })), memory: state.memory, messages: [incoming] };
      if (JSON.stringify(input).length > 180000) fail(400, 'Ngữ cảnh đã quá dài. Mở một hội thoại mới; hội thoại cũ vẫn được lưu.');
      const started = Date.now();
      const result = await this.brain(input, model, settings);
      validateBrain(result.output, input);
      const run = { id: randomUUID(), output: result.output, model: result.actual_model || model, usage: result.usage, versions: result.versions, response_id: result.response_id, duration_ms: Date.now() - started, created_at: now() };
      const updated = { ...state, history: [...state.history, { ...incoming, created_at: now() }, { id: randomUUID(), role: 'assistant', text: run.output.suggested_reply, run, created_at: now() }], memory: applyMemory(state.memory, run.output.memory_updates), last_run: run };
      const saved = await this.store.commit(sessionId, id, body.request_id, token, conversation.revision, updated);
      return { conversation: saved, replayed: false };
    } catch (error) {
      await this.store.release(sessionId, id, token).catch(() => {});
      throw error;
    }
  }
}
