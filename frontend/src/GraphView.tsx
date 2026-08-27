import { useEffect, useState } from "react";
import ReactFlow, { Background } from "reactflow";
import type { Node, Edge } from "reactflow";
import "reactflow/dist/style.css";

const BASE = import.meta.env.VITE_API_BASE || "http://localhost:8000";

// Graph View color semantics: AGENT PROPOSAL per spec, not user-confirmed --
// approve/adjust before treating as final. Coral = active path, willow-green
// = rest of tree, charcoal-brown = canvas background.
const COLORS = {
  active: "#fe5f55",
  normal: "#bcd979",
  background: "#1f271b",
  text: "#f7f7ff",
};

export function GraphView({ onOpenThread }: { onOpenThread?: (id: string) => void }) {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);

  useEffect(() => {
    fetch(`${BASE}/graph`).then((r) => r.json()).then((data) => {
      setNodes(
        data.nodes.map((n: any, i: number) => ({
          id: n.id,
          data: { label: n.label },
          position: { x: (i % 5) * 200, y: Math.floor(i / 5) * 120 },
          style: { background: COLORS.normal, color: "#1a1a1a", borderRadius: 8 },
        }))
      );
      setEdges(
        data.edges.map((e: any) => ({
          id: `${e.source}-${e.target}`,
          source: e.source,
          target: e.target,
          label: e.chunk_id,
        }))
      );
    });
  }, []);

  return (
    <div style={{ height: "100vh", background: COLORS.background }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        fitView
        onNodeClick={(_, node) => onOpenThread?.(node.id)}
      >
        <Background color={COLORS.text} gap={16} />
      </ReactFlow>
    </div>
  );
}
