import { REMARKETING_MESSAGE, finishBotOutbound, prepareBotOutbound } from './remarketing.js';
import { requireSupabase } from './supabase.js';

const DEFAULT_BATCH_SIZE = 10;
const MAX_RUNTIME_MS = 20_000;

export function createSupabaseRemarketingStore() {
  const client = requireSupabase();
  return {
    async status() {
      const { data, error } = await client.rpc('remarketing_status');
      if (error) throw new Error(error.message);
      return data;
    },
    async preview(limit) {
      const { data, error } = await client.rpc('remarketing_preview_due', { p_limit: limit });
      if (error) throw new Error(error.message);
      return data || [];
    },
    async claim(limit) {
      const { data, error } = await client.rpc('remarketing_claim_due', {
        p_limit: limit,
        p_lease_seconds: 45
      });
      if (error) throw new Error(error.message);
      return data || [];
    },
    async validate(cycle) {
      const { data, error } = await client.rpc('remarketing_validate_claim', {
        p_cycle_id: cycle.cycle_id,
        p_claim_token: cycle.claim_token
      });
      if (error) throw new Error(error.message);
      return data;
    },
    async complete(cycle, messageId) {
      const { data, error } = await client.rpc('remarketing_complete_attempt', {
        p_cycle_id: cycle.cycle_id,
        p_claim_token: cycle.claim_token,
        p_message_id: messageId
      });
      if (error) throw new Error(error.message);
      return data;
    },
    async fail(cycle, errorClass, errorCode) {
      const { data, error } = await client.rpc('remarketing_fail_attempt', {
        p_cycle_id: cycle.cycle_id,
        p_claim_token: cycle.claim_token,
        p_error_class: errorClass,
        p_error_code: errorCode || null
      });
      if (error) throw new Error(error.message);
      return data;
    },
    prepareOutbound: cycle => prepareBotOutbound({
      customerPsid: cycle.customer_psid,
      source: 'remarketing',
      cycleId: cycle.cycle_id
    }),
    finishOutbound: finishBotOutbound
  };
}

function graphErrorCode(body, status) {
  const code = body?.error?.code;
  const subcode = body?.error?.error_subcode;
  return [status, code, subcode].filter(value => value !== undefined && value !== null).join(':');
}

async function parseJson(response) {
  try { return await response.json(); } catch { return null; }
}

export async function runRemarketingBatch({
  store,
  fetchImpl = fetch,
  pageAccessToken = process.env.PAGE_ACCESS_TOKEN,
  graphApiVersion = process.env.GRAPH_API_VERSION || 'v26.0',
  batchSize = DEFAULT_BATCH_SIZE,
  now = () => Date.now()
}) {
  const startedAt = now();
  const status = await store.status();
  if (!status?.enabled) return { mode: 'disabled', checked: 0, sent: 0 };
  if (status.dry_run) {
    const due = await store.preview(batchSize);
    return { mode: 'dry_run', checked: due.length, sent: 0 };
  }
  if (!pageAccessToken) throw new Error('Thiếu PAGE_ACCESS_TOKEN trên server.');
  const claims = await store.claim(batchSize);
  const result = { mode: 'production', checked: claims.length, sent: 0, skipped: 0, failed: 0, uncertain: 0 };
  for (const cycle of claims) {
    if (now() - startedAt >= MAX_RUNTIME_MS) break;
    const validation = await store.validate(cycle);
    if (!validation?.valid) { result.skipped++; continue; }
    let registration;
    try {
      registration = await store.prepareOutbound(cycle);
      const finalValidation = await store.validate(cycle);
      if (!finalValidation?.valid) {
        await store.finishOutbound(registration, { status: 'failed' });
        result.skipped++;
        continue;
      }
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8_000);
      let response;
      try {
        response = await fetchImpl(
          `https://graph.facebook.com/${graphApiVersion}/me/messages`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${pageAccessToken}` },
            body: JSON.stringify({
              recipient: { id: cycle.customer_psid },
              message_type: 'RESPONSE',
              message: { text: REMARKETING_MESSAGE, metadata: registration.metadata }
            }),
            signal: controller.signal
          }
        );
      } finally {
        clearTimeout(timeout);
      }
      const body = await parseJson(response);
      if (response.ok && body?.message_id) {
        await store.finishOutbound(registration, { status: 'sent', messageId: body.message_id });
        await store.complete(cycle, body.message_id);
        result.sent++;
      } else if (response.status === 429) {
        await store.finishOutbound(registration, { status: 'failed' });
        await store.fail(cycle, 'retryable', graphErrorCode(body, response.status));
        result.failed++;
      } else if (response.status >= 500 || (response.ok && !body?.message_id)) {
        await store.finishOutbound(registration, { status: 'uncertain' });
        await store.fail(cycle, 'uncertain', graphErrorCode(body, response.status));
        result.uncertain++;
      } else {
        await store.finishOutbound(registration, { status: 'failed' });
        await store.fail(cycle, 'permanent', graphErrorCode(body, response.status));
        result.failed++;
      }
    } catch (error) {
      if (registration) await store.finishOutbound(registration, { status: 'uncertain' });
      await store.fail(cycle, 'uncertain', error?.name || 'network_error');
      result.uncertain++;
    }
  }
  return result;
}
