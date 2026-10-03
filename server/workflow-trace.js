import crypto from 'node:crypto';
import { getSupabase } from './supabase.js';

export const WORKFLOW_NODES = [
  'facebook_webhook',
  'parse_message',
  'detect_ad',
  'find_product',
  'check_auto_reply',
  'ai_agent',
  'business_logic',
  'send_messenger',
  'completed'
];

function noopTracer(executionId = null) {
  const noop = async () => {};
  return { executionId, enabled: false, nodeStarted: noop, nodeCompleted: noop, edgeTransfer: noop, nodeError: noop, complete: noop, patch: noop };
}

export async function createWorkflowTrace({ customerId, message, adId = null }) {
  const supabase = getSupabase();
  const executionId = `exec_${crypto.randomUUID()}`;
  if (!supabase) return noopTracer(executionId);

  const now = new Date().toISOString();
  const state = { currentNode: null, visited: [], activeEdge: null };
  try {
    const { error: executionError } = await supabase.from('workflow_executions').insert({
      id: executionId,
      customer_id: String(customerId),
      message: String(message || '').slice(0, 500),
      ad_id: adId ? String(adId) : null,
      status: 'running',
      started_at: now,
      updated_at: now,
      visited_nodes: []
    });
    if (executionError) return noopTracer(executionId);
    const { error: eventError } = await supabase.from('workflow_events').insert({
      execution_id: executionId,
      event_type: 'workflow_started',
      status: 'running',
      payload: { customer_id: String(customerId), message: String(message || '').slice(0, 500), ad_id: adId }
    });
    if (eventError) return noopTracer(executionId);
  } catch {
    // Telemetry is best-effort and must never block Messenger replies.
    return noopTracer(executionId);
  }

  async function writeEvent(eventType, values = {}) {
    try {
      const timestamp = new Date().toISOString();
      const { error } = await supabase.from('workflow_events').insert({
        execution_id: executionId,
        event_type: eventType,
        node: values.node || null,
        source_node: values.source || null,
        target_node: values.target || null,
        status: values.status || null,
        payload: values.payload || {},
        created_at: timestamp
      });
      if (error) return;
      const patch = { updated_at: timestamp };
      if (values.node) patch.current_node = values.node;
      if (values.executionStatus) patch.status = values.executionStatus;
      if (values.error) patch.error = String(values.error).slice(0, 1000);
      if (values.completed) patch.completed_at = timestamp;
      if (values.productId !== undefined) patch.product_id = values.productId;
      if (values.productName !== undefined) patch.product_name = values.productName;
      if (values.adId !== undefined) patch.ad_id = values.adId;
      patch.visited_nodes = state.visited;
      patch.active_edge = state.activeEdge;
      await supabase.from('workflow_executions').update(patch).eq('id', executionId);
    } catch {
      // Realtime visibility is non-critical; the customer flow continues.
    }
  }

  return {
    executionId,
    enabled: true,
    async nodeStarted(node, payload = {}) {
      if (!WORKFLOW_NODES.includes(node)) return;
      state.currentNode = node;
      state.activeEdge = null;
      if (!state.visited.includes(node)) state.visited.push(node);
      await writeEvent('node_started', { node, status: 'running', executionStatus: 'running', payload });
    },
    async nodeCompleted(node, payload = {}) {
      if (!WORKFLOW_NODES.includes(node)) return;
      await writeEvent('node_completed', { node, status: 'completed', executionStatus: 'running', payload });
    },
    async edgeTransfer(source, target, payload = {}) {
      if (!WORKFLOW_NODES.includes(source) || !WORKFLOW_NODES.includes(target)) return;
      state.activeEdge = `${source}->${target}`;
      await writeEvent('edge_transfer', { source, target, status: 'running', executionStatus: 'running', payload });
    },
    async patch(values = {}) {
      try {
        const update = { updated_at: new Date().toISOString() };
        if (values.product_id !== undefined) update.product_id = values.product_id;
        if (values.product_name !== undefined) update.product_name = values.product_name;
        if (values.ad_id !== undefined) update.ad_id = values.ad_id;
        await supabase.from('workflow_executions').update(update).eq('id', executionId);
      } catch {
        // Best-effort metadata only.
      }
    },
    async nodeError(node, error, payload = {}) {
      state.currentNode = node || state.currentNode;
      state.activeEdge = null;
      await writeEvent('node_error', {
        node: state.currentNode,
        status: 'error',
        executionStatus: 'error',
        error: error?.message || error,
        payload: { ...payload, error: error?.message || String(error) }
      });
    },
    async complete(payload = {}) {
      state.activeEdge = null;
      state.currentNode = 'completed';
      if (!state.visited.includes('completed')) state.visited.push('completed');
      await writeEvent('workflow_completed', {
        node: 'completed',
        status: 'completed',
        executionStatus: 'completed',
        completed: true,
        payload
      });
    }
  };
}
