import { MarkerType, Position, type Edge, type Node } from '@xyflow/react';
import type { VisualNodeStatus, WorkflowNodeId } from './types';

export type WorkflowNodeData = {
  label: string;
  eyebrow: string;
  icon: string;
  status: VisualNodeStatus;
  runningCount: number;
  selected: boolean;
};

export type WorkflowEdgeData = {
  active: boolean;
  visited: boolean;
  selected: boolean;
  transferCount: number;
};

type Definition = {
  id: WorkflowNodeId;
  label: string;
  eyebrow: string;
  icon: string;
  position: { x: number; y: number };
  sourcePosition: Position;
  targetPosition: Position;
};

export const definitions: Definition[] = [
  { id: 'facebook_webhook', label: 'Facebook Webhook', eyebrow: 'INBOUND', icon: 'webhook', position: { x: 30, y: 42 }, sourcePosition: Position.Right, targetPosition: Position.Left },
  { id: 'parse_message', label: 'Parse Message', eyebrow: 'NORMALIZE', icon: 'message', position: { x: 330, y: 42 }, sourcePosition: Position.Right, targetPosition: Position.Left },
  { id: 'detect_ad', label: 'Detect Ad', eyebrow: 'ATTRIBUTION', icon: 'scan', position: { x: 630, y: 42 }, sourcePosition: Position.Right, targetPosition: Position.Left },
  { id: 'find_product', label: 'Find Product', eyebrow: 'DATABASE', icon: 'package', position: { x: 930, y: 42 }, sourcePosition: Position.Left, targetPosition: Position.Top },
  { id: 'check_auto_reply', label: 'Check Auto Reply', eyebrow: 'CONTROL', icon: 'toggle', position: { x: 630, y: 274 }, sourcePosition: Position.Left, targetPosition: Position.Right },
  { id: 'ai_agent', label: 'Product Introduction', eyebrow: 'SCRIPT', icon: 'sparkles', position: { x: 330, y: 274 }, sourcePosition: Position.Left, targetPosition: Position.Right },
  { id: 'business_logic', label: 'Business Logic', eyebrow: 'POLICY', icon: 'braces', position: { x: 30, y: 274 }, sourcePosition: Position.Bottom, targetPosition: Position.Right },
  { id: 'send_messenger', label: 'Send Messenger', eyebrow: 'OUTBOUND', icon: 'send', position: { x: 330, y: 506 }, sourcePosition: Position.Right, targetPosition: Position.Left },
  { id: 'completed', label: 'Completed', eyebrow: 'DONE', icon: 'check', position: { x: 630, y: 506 }, sourcePosition: Position.Right, targetPosition: Position.Left }
];

export const workflowPairs: Array<[WorkflowNodeId, WorkflowNodeId]> = [
  ['facebook_webhook', 'parse_message'],
  ['parse_message', 'detect_ad'],
  ['detect_ad', 'find_product'],
  ['find_product', 'check_auto_reply'],
  ['check_auto_reply', 'ai_agent'],
  ['ai_agent', 'business_logic'],
  ['business_logic', 'send_messenger'],
  ['send_messenger', 'completed']
];

export const nodeLabels = Object.fromEntries(definitions.map((node) => [node.id, node.label])) as Record<WorkflowNodeId, string>;

export function createNodes(getState: (id: WorkflowNodeId) => Pick<WorkflowNodeData, 'status' | 'runningCount' | 'selected'>): Node<WorkflowNodeData>[] {
  return definitions.map((definition) => ({
    id: definition.id,
    type: 'workflow',
    position: definition.position,
    sourcePosition: definition.sourcePosition,
    targetPosition: definition.targetPosition,
    draggable: false,
    selectable: false,
    deletable: false,
    data: { ...definition, ...getState(definition.id) }
  }));
}

export function createEdges(getState: (source: WorkflowNodeId, target: WorkflowNodeId) => WorkflowEdgeData): Edge<WorkflowEdgeData>[] {
  return workflowPairs.map(([source, target]) => ({
    id: `${source}->${target}`,
    source,
    target,
    type: 'execution',
    deletable: false,
    selectable: false,
    markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18, color: '#455065' },
    data: getState(source, target)
  }));
}
