import { createClient } from '@supabase/supabase-js';
import { fail } from './settings.js';

export class SupabaseLabStore {
  constructor(client) { this.client = client; }
  async result(query) {
    const { data, error } = await query;
    if (error) {
      if (error.code === 'P0002') fail(404, 'Không tìm thấy hội thoại trong phiên Lab này.');
      if (error.code === '40001' || error.code === '55P03') fail(409, 'Hội thoại vừa thay đổi hoặc đang xử lý. Tải lại hội thoại rồi thử lại.');
      fail(503, 'Không lưu/đọc được dữ liệu Lab từ Supabase. Kiểm tra biến môi trường và migration emi_lab.');
    }
    return data;
  }
  list(sessionId) {
    return this.result(this.client.from('emi_lab_conversations').select('id,title,revision,created_at,updated_at').eq('session_id', sessionId).order('updated_at', { ascending: false }).limit(100));
  }
  async get(sessionId, id) {
    const row = await this.result(this.client.from('emi_lab_conversations').select('id,title,state,revision,last_request_id,created_at,updated_at').eq('session_id', sessionId).eq('id', id).maybeSingle());
    if (!row) fail(404, 'Không tìm thấy hội thoại trong phiên Lab này.');
    return row;
  }
  create(sessionId, record) {
    return this.result(this.client.from('emi_lab_conversations').insert({ ...record, session_id: sessionId }).select('id,title,state,revision,last_request_id,created_at,updated_at').single());
  }
  claim(sessionId, id, requestId, token, revision) {
    return this.result(this.client.rpc('emi_lab_claim_turn', { p_session_id: sessionId, p_conversation_id: id, p_request_id: requestId, p_lock_token: token, p_revision: revision }));
  }
  commit(sessionId, id, requestId, token, revision, state) {
    return this.result(this.client.rpc('emi_lab_finish_turn', { p_session_id: sessionId, p_conversation_id: id, p_request_id: requestId, p_lock_token: token, p_revision: revision, p_state: state }));
  }
  release(sessionId, id, token) {
    return this.result(this.client.rpc('emi_lab_release_turn', { p_session_id: sessionId, p_conversation_id: id, p_lock_token: token }));
  }
}

export function createLabStore() {
  const url = process.env.EMI_LAB_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.EMI_LAB_SUPABASE_SECRET_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) fail(503, 'Thiếu SUPABASE_URL hoặc SUPABASE_SECRET_KEY phía server.');
  return new SupabaseLabStore(createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }));
}
