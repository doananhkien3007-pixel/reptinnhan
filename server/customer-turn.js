import { createHash, randomUUID } from 'node:crypto';
import { requireSupabase } from './supabase.js';
import { acquireWelcomeClaim, releaseWelcomeClaim } from './welcome-claim.js';

// Reuse the existing server-only settings table; no new deployment function or schema.
// One sender is processed at a time across serverless instances. Busy requests
// receive a retryable response, rather than silently dropping a customer's text.
export async function beginCustomerTurn(senderId, event) {
  const identity = event.message?.mid || event.postback?.mid || (event.timestamp
    ? JSON.stringify([event.timestamp, event.message, event.postback]) : randomUUID());
  const hash = createHash('sha256').update(`${senderId}:${identity}`).digest('hex');
  const key = `ai_turn:${hash}`;
  const lock = await acquireWelcomeClaim(senderId, 'ai_conversation', { reopenComplete: true });
  if (!lock) throw new Error('Hội thoại đang được xử lý. Cần thử lại sự kiện này.');
  try {
    const { data, error } = await requireSupabase().from('app_settings').select('value').eq('key', key).maybeSingle();
    if (error) throw new Error(`Không đọc được lượt hội thoại: ${error.message}`);
    return { key, lock, value: data?.value || {} };
  } catch (error) {
    await releaseWelcomeClaim(lock);
    throw error;
  }
}

export async function checkpointTurn(turn, patch) {
  const value = { ...turn.value, ...patch };
  const { error } = await requireSupabase().from('app_settings').upsert({
    key: turn.key, value, updated_at: new Date().toISOString()
  });
  if (error) throw new Error(`Không lưu được tiến trình hội thoại: ${error.message}`);
  turn.value = value;
}

export async function endCustomerTurn(turn) {
  if (turn?.lock) await releaseWelcomeClaim(turn.lock);
}
