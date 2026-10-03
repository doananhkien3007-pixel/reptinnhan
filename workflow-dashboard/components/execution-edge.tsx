'use client';

import { BaseEdge, getSmoothStepPath, type Edge, type EdgeProps } from '@xyflow/react';
import type { WorkflowEdgeData } from '@/lib/workflow-definition';

type ExecutionEdge = Edge<WorkflowEdgeData, 'execution'>;

export function ExecutionEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, data }: EdgeProps<ExecutionEdge>) {
  const [edgePath] = getSmoothStepPath({
    sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, borderRadius: 18
  });
  const active = Boolean(data?.active);
  const visited = Boolean(data?.visited);
  const selected = Boolean(data?.selected);
  return (
    <g className={`execution-edge ${active ? 'edge-active' : ''} ${visited ? 'edge-visited' : ''} ${selected ? 'edge-selected' : ''}`}>
      <BaseEdge id={id} path={edgePath} markerEnd={markerEnd} className="edge-base" />
      {(active || selected) && <BaseEdge id={`${id}-glow`} path={edgePath} className="edge-glow" />}
      {active && (
        <>
          <circle r="4.5" className="edge-particle-core">
            <animateMotion dur="0.9s" repeatCount="indefinite" path={edgePath} />
          </circle>
          <circle r="10" className="edge-particle-halo">
            <animateMotion dur="0.9s" repeatCount="indefinite" path={edgePath} />
          </circle>
        </>
      )}
      {active && (data?.transferCount || 0) > 1 && (
        <text x={(sourceX + targetX) / 2} y={(sourceY + targetY) / 2 - 12} className="edge-count">×{data?.transferCount}</text>
      )}
    </g>
  );
}
