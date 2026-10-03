'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  type EdgeTypes,
  type NodeTypes
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Activity, Bot, CheckCircle2, Clock3, Radio, Zap } from 'lucide-react';
import { ExecutionEdge } from './execution-edge';
import { LiveExecutions } from './live-executions';
import { WorkflowNode } from './workflow-node';
import { createEdges, createNodes, workflowPairs } from '@/lib/workflow-definition';
import { getBrowserSupabase } from '@/lib/supabase';
import type { WorkflowEvent, WorkflowExecution, WorkflowNodeId } from '@/lib/types';

const nodeTypes: NodeTypes = { workflow: WorkflowNode };
const edgeTypes: EdgeTypes = { execution: ExecutionEdge };

const demoExecutions: WorkflowExecution[] = [
  {
    id: 'exec_demo_7f39c2a1', customer_id: '748201563904', message: 'Mẫu váy này còn màu đen không shop?',
    ad_id: '120218937441', product_id: 7, product_name: 'Váy hoa thiết kế', current_node: 'ai_agent',
    active_edge: 'check_auto_reply->ai_agent', visited_nodes: ['facebook_webhook', 'parse_message', 'detect_ad', 'find_product', 'check_auto_reply', 'ai_agent'],
    status: 'running', error: null, started_at: new Date(Date.now() - 3400).toISOString(), updated_at: new Date().toISOString(), completed_at: null
  },
  {
    id: 'exec_demo_61ba84de', customer_id: '619338256120', message: 'Chị 52kg cao 1m58',
    ad_id: null, product_id: 7, product_name: 'Váy hoa thiết kế', current_node: 'completed', active_edge: null,
    visited_nodes: ['facebook_webhook', 'parse_message', 'detect_ad', 'find_product', 'check_auto_reply', 'ai_agent', 'business_logic', 'send_messenger', 'completed'],
    status: 'completed', error: null, started_at: new Date(Date.now() - 15_600).toISOString(), updated_at: new Date(Date.now() - 10_100).toISOString(), completed_at: new Date(Date.now() - 10_100).toISOString()
  }
];

function upsertExecution(list: WorkflowExecution[], next: WorkflowExecution) {
  return [next, ...list.filter((item) => item.id !== next.id)]
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
    .slice(0, 50);
}

function DashboardSurface() {
  const [executions, setExecutions] = useState<WorkflowExecution[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pulseEdges, setPulseEdges] = useState<Record<string, number>>({});
  const [connection, setConnection] = useState<'connecting' | 'live' | 'offline' | 'demo'>('connecting');
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => {
      const current = Date.now();
      setNow(current);
      setPulseEdges((edges) => Object.fromEntries(Object.entries(edges).filter(([, until]) => until > current)));
    }, 250);
    return () => window.clearInterval(timer);
  }, []);

  const pulseEdge = useCallback((edgeId: string) => {
    setPulseEdges((edges) => ({ ...edges, [edgeId]: Date.now() + 1200 }));
  }, []);

  useEffect(() => {
    const supabase = getBrowserSupabase();
    if (!supabase) {
      setExecutions(demoExecutions);
      setConnection('demo');
      pulseEdge('check_auto_reply->ai_agent');
      return;
    }

    let mounted = true;
    void supabase.from('workflow_executions').select('*').order('updated_at', { ascending: false }).limit(50)
      .then(({ data, error }) => {
        if (!mounted) return;
        if (error) setConnection('offline');
        else setExecutions((data || []) as WorkflowExecution[]);
      });

    const channel = supabase.channel('messenger-workflow-dashboard')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'workflow_events' }, (payload) => {
        const event = payload.new as WorkflowEvent;
        if (event.event_type === 'edge_transfer' && event.source_node && event.target_node) {
          pulseEdge(`${event.source_node}->${event.target_node}`);
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'workflow_executions' }, (payload) => {
        if (payload.eventType === 'DELETE') {
          const id = String((payload.old as { id?: string }).id || '');
          setExecutions((items) => items.filter((item) => item.id !== id));
          return;
        }
        setExecutions((items) => upsertExecution(items, payload.new as WorkflowExecution));
      })
      .subscribe((status) => {
        if (!mounted) return;
        if (status === 'SUBSCRIBED') setConnection('live');
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setConnection('offline');
      });

    return () => {
      mounted = false;
      void supabase.removeChannel(channel);
    };
  }, [pulseEdge]);

  const selectedExecution = executions.find((item) => item.id === selectedId) || null;
  const running = executions.filter((item) => item.status === 'running');
  const nodeRunningCounts = useMemo(() => {
    const counts = new Map<WorkflowNodeId, number>();
    for (const execution of running) {
      if (execution.current_node) counts.set(execution.current_node, (counts.get(execution.current_node) || 0) + 1);
    }
    return counts;
  }, [running]);

  const nodes = useMemo(() => createNodes((id) => {
    const runningCount = nodeRunningCounts.get(id) || 0;
    if (selectedExecution) {
      const isCurrent = selectedExecution.current_node === id;
      const status = isCurrent && selectedExecution.status === 'error'
        ? 'error'
        : isCurrent && selectedExecution.status === 'running'
          ? 'running'
          : selectedExecution.visited_nodes?.includes(id)
            ? 'success'
            : 'idle';
      return { status, runningCount: isCurrent ? Math.max(1, runningCount) : 0, selected: selectedExecution.visited_nodes?.includes(id) };
    }
    if (runningCount) return { status: 'running', runningCount, selected: false };
    const hasError = executions.some((execution) => execution.status === 'error' && execution.current_node === id);
    const passedByActive = running.some((execution) => execution.visited_nodes?.includes(id));
    return { status: hasError ? 'error' : passedByActive ? 'success' : 'idle', runningCount: 0, selected: false };
  }), [executions, nodeRunningCounts, running, selectedExecution]);

  const edges = useMemo(() => createEdges((source, target) => {
    const edgeId = `${source}->${target}`;
    const transferCount = running.filter((execution) => execution.active_edge === edgeId).length;
    const selectedVisited = Boolean(selectedExecution?.visited_nodes?.includes(source) && selectedExecution?.visited_nodes?.includes(target));
    return {
      active: Boolean(pulseEdges[edgeId] > now || transferCount),
      visited: selectedExecution ? selectedVisited : running.some((execution) => execution.visited_nodes?.includes(source) && execution.visited_nodes?.includes(target)),
      selected: selectedVisited,
      transferCount
    };
  }), [now, pulseEdges, running, selectedExecution]);

  const completed = executions.filter((item) => item.status === 'completed');
  const averageLatency = completed.length
    ? completed.reduce((sum, item) => sum + Math.max(0, new Date(item.completed_at || item.updated_at).getTime() - new Date(item.started_at).getTime()), 0) / completed.length
    : 0;
  const connectionLabel = connection === 'live' ? 'Realtime connected' : connection === 'demo' ? 'Demo data' : connection === 'offline' ? 'Realtime offline' : 'Connecting';

  return (
    <main className="dashboard-shell">
      <header className="app-header">
        <div className="brand-lockup"><div className="brand-icon"><Bot size={20} /></div><div><span>MESSENGER OPS</span><strong>Live Workflow</strong></div></div>
        <div className={`connection-pill connection-${connection}`}><Radio size={14} /><span>{connectionLabel}</span></div>
      </header>

      <section className="dashboard-intro">
        <div><p className="section-kicker">SYSTEM OBSERVABILITY</p><h1>Chatbot execution map</h1><p>The graph is locked. Every pulse is a real message moving through the production workflow.</p></div>
        <div className="metrics-strip">
          <div><Activity size={16} /><span>Running</span><strong>{running.length}</strong></div>
          <div><CheckCircle2 size={16} /><span>Completed</span><strong>{completed.length}</strong></div>
          <div><Clock3 size={16} /><span>Avg. latency</span><strong>{averageLatency ? `${(averageLatency / 1000).toFixed(1)}s` : '—'}</strong></div>
        </div>
      </section>

      <section className="dashboard-grid">
        <div className="graph-panel">
          <div className="graph-toolbar"><div><Zap size={15} /><span>Fixed production workflow</span></div><span>{workflowPairs.length + 1} nodes · {workflowPairs.length} transfers</span></div>
          <div className="flow-canvas" aria-label="Sơ đồ workflow chatbot cố định">
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              nodesDraggable={false}
              nodesConnectable={false}
              elementsSelectable={false}
              selectionOnDrag={false}
              deleteKeyCode={null}
              panOnDrag
              zoomOnDoubleClick={false}
              minZoom={0.28}
              maxZoom={1.25}
              fitView
              fitViewOptions={{ padding: 0.12, maxZoom: 1 }}
              proOptions={{ hideAttribution: true }}
            >
              <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="#252d3b" />
              <Controls showInteractive={false} position="bottom-left" />
            </ReactFlow>
          </div>
          <div className="graph-legend"><span><i className="legend-running" />Running</span><span><i className="legend-success" />Completed</span><span><i className="legend-error" />Error</span><span className="legend-hint">Click an execution to isolate its path</span></div>
        </div>
        <LiveExecutions executions={executions} selectedId={selectedId} onSelect={setSelectedId} now={now} />
      </section>
    </main>
  );
}

export function WorkflowDashboard() {
  return <ReactFlowProvider><DashboardSurface /></ReactFlowProvider>;
}
