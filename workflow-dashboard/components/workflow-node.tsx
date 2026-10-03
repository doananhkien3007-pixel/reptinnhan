'use client';

import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { Bot, Braces, Check, CircleCheck, MessageSquareText, PackageSearch, RadioTower, ScanSearch, Send, Sparkles, ToggleRight, X } from 'lucide-react';
import type { WorkflowNodeData } from '@/lib/workflow-definition';

const icons = {
  webhook: RadioTower,
  message: MessageSquareText,
  scan: ScanSearch,
  package: PackageSearch,
  toggle: ToggleRight,
  sparkles: Sparkles,
  braces: Braces,
  send: Send,
  check: CircleCheck,
  bot: Bot
};

type WorkflowNode = Node<WorkflowNodeData, 'workflow'>;

export function WorkflowNode({ data, sourcePosition = Position.Right, targetPosition = Position.Left }: NodeProps<WorkflowNode>) {
  const Icon = icons[data.icon as keyof typeof icons] || Bot;
  return (
    <div className={`workflow-node node-${data.status} ${data.selected ? 'node-selected' : ''}`}>
      <Handle type="target" position={targetPosition} isConnectable={false} className="workflow-handle" />
      <div className="node-icon-wrap"><Icon size={19} strokeWidth={1.8} /></div>
      <div className="node-copy">
        <span className="node-eyebrow">{data.eyebrow}</span>
        <strong>{data.label}{data.runningCount > 1 ? ` ×${data.runningCount}` : ''}</strong>
      </div>
      <div className="node-state" aria-label={data.status}>
        {data.status === 'running' && <><span className="running-dot" />RUNNING</>}
        {data.status === 'success' && <><Check size={14} strokeWidth={3} />DONE</>}
        {data.status === 'error' && <><X size={14} strokeWidth={3} />ERROR</>}
        {data.status === 'idle' && <span className="idle-dot" />}
      </div>
      <Handle type="source" position={sourcePosition} isConnectable={false} className="workflow-handle" />
    </div>
  );
}
