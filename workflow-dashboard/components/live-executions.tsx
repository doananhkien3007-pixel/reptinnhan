'use client';

import { AlertTriangle, CheckCircle2, Clock3, MessageCircleMore, Package, Radio, UserRound } from 'lucide-react';
import { nodeLabels } from '@/lib/workflow-definition';
import type { WorkflowExecution } from '@/lib/types';

function maskCustomer(value: string) {
  if (value.length <= 7) return value;
  return `${value.slice(0, 4)}•••${value.slice(-3)}`;
}

function duration(startedAt: string, completedAt: string | null, now: number) {
  const end = completedAt ? new Date(completedAt).getTime() : now;
  const elapsed = Math.max(0, end - new Date(startedAt).getTime());
  if (elapsed < 1000) return `${elapsed}ms`;
  return `${(elapsed / 1000).toFixed(elapsed < 10_000 ? 1 : 0)}s`;
}

export function LiveExecutions({ executions, selectedId, onSelect, now }: {
  executions: WorkflowExecution[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  now: number;
}) {
  return (
    <aside className="execution-panel">
      <div className="panel-heading">
        <div><span className="section-kicker">ACTIVITY STREAM</span><h2>Live Executions</h2></div>
        <div className="live-chip"><Radio size={13} />LIVE</div>
      </div>
      <div className="execution-list">
        {!executions.length && (
          <div className="empty-executions"><MessageCircleMore size={28} /><strong>Đang chờ tin nhắn</strong><span>Execution mới sẽ xuất hiện ngay khi webhook nhận dữ liệu.</span></div>
        )}
        {executions.map((execution) => (
          <button
            key={execution.id}
            type="button"
            className={`execution-card ${selectedId === execution.id ? 'execution-selected' : ''}`}
            onClick={() => onSelect(selectedId === execution.id ? null : execution.id)}
          >
            <div className="execution-card-top">
              <span className={`execution-status status-${execution.status}`}>
                {execution.status === 'running' && <span className="running-dot" />}
                {execution.status === 'completed' && <CheckCircle2 size={13} />}
                {execution.status === 'error' && <AlertTriangle size={13} />}
                {execution.status}
              </span>
              <span className="execution-time"><Clock3 size={13} />{duration(execution.started_at, execution.completed_at, now)}</span>
            </div>
            <p className="execution-message">“{execution.message || 'Tin nhắn không có nội dung chữ'}”</p>
            <div className="execution-details">
              <span><UserRound size={14} />{maskCustomer(execution.customer_id)}</span>
              <span><Package size={14} />{execution.product_name || (execution.product_id ? `Sản phẩm #${execution.product_id}` : 'Chưa xác định')}</span>
            </div>
            <div className="execution-node"><span>{execution.current_node ? nodeLabels[execution.current_node] : 'Khởi tạo'}</span><code>{execution.id.slice(-8)}</code></div>
            {execution.error && <div className="execution-error">{execution.error}</div>}
          </button>
        ))}
      </div>
    </aside>
  );
}
