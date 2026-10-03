export type WorkflowNodeId =
  | 'facebook_webhook'
  | 'parse_message'
  | 'detect_ad'
  | 'find_product'
  | 'check_auto_reply'
  | 'ai_agent'
  | 'business_logic'
  | 'send_messenger'
  | 'completed';

export type ExecutionStatus = 'running' | 'completed' | 'error';

export type WorkflowExecution = {
  id: string;
  customer_id: string;
  message: string | null;
  ad_id: string | null;
  product_id: number | null;
  product_name: string | null;
  current_node: WorkflowNodeId | null;
  active_edge: string | null;
  visited_nodes: WorkflowNodeId[];
  status: ExecutionStatus;
  error: string | null;
  started_at: string;
  updated_at: string;
  completed_at: string | null;
};

export type WorkflowEvent = {
  id: number;
  execution_id: string;
  event_type: 'workflow_started' | 'node_started' | 'node_completed' | 'edge_transfer' | 'node_error' | 'workflow_completed';
  node: WorkflowNodeId | null;
  source_node: WorkflowNodeId | null;
  target_node: WorkflowNodeId | null;
  status: string | null;
  payload: Record<string, unknown>;
  created_at: string;
};

export type VisualNodeStatus = 'idle' | 'running' | 'success' | 'error';
