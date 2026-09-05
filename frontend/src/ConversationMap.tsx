import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactFlow, {
  applyNodeChanges,
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  Panel,
  Position,
  useNodesInitialized,
} from "reactflow";
import type { Edge, Node, NodeProps, ReactFlowInstance } from "reactflow";
import { toPng } from "html-to-image";
import type { GraphData } from "./api";
import { saveGraphLayout } from "./api";
import { ChevronIcon, GraphIcon, ThreadIcon } from "./Icons";
import {
  getConnectedLineage,
  getDescendants,
  layoutConversationGraph,
  layoutKnowledgeTree,
} from "./conversationMapLayout";

type MapMode = "lineage" | "tree";
const MAP_MODE_KEY = "wcg_map_mode";

type ThreadNodeData = {
  title: string;
  preview: string;
  active: boolean;
  selected: boolean;
  dimmed: boolean;
  compact: boolean;
  tree: boolean;
  hasChildren: boolean;
  collapsed: boolean;
  onOpen?: (id: string) => void;
  onFocus?: (id: string) => void;
  onToggle?: (id: string) => void;
};

const NODE_TYPES = { threadCard: ThreadCardNode };
const EDGE_TYPES = {};
const handleGraphError = (code: string, message: string) => {
  if (code !== "002") console.warn(`[React Flow] ${message}`);
};

function MapReadiness({ onChange }: { onChange: (ready: boolean) => void }) {
  const ready = useNodesInitialized();
  useEffect(() => onChange(ready), [onChange, ready]);
  return null;
}

function graphDistances(graph: GraphData, originId: string, maxDepth = 2): Map<string, number> {
  const neighbors = new Map<string, string[]>();
  for (const edge of graph.edges) {
    neighbors.set(edge.source, [...(neighbors.get(edge.source) ?? []), edge.target]);
    neighbors.set(edge.target, [...(neighbors.get(edge.target) ?? []), edge.source]);
  }
  const distances = new Map([[originId, 0]]);
  const queue = [originId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const depth = distances.get(current)!;
    if (depth >= maxDepth) continue;
    for (const neighbor of neighbors.get(current) ?? []) {
      if (distances.has(neighbor)) continue;
      distances.set(neighbor, depth + 1);
      queue.push(neighbor);
    }
  }
  return distances;
}

function ThreadCardNode({ id, data }: NodeProps<ThreadNodeData>) {
  return (
    <div className={[
      "thread-map-card",
      data.active ? "active" : "",
      data.selected ? "selected" : "",
      data.dimmed ? "dimmed" : "",
      data.compact ? "compact" : "",
    ].filter(Boolean).join(" ")}>
      <Handle type="target" position={data.tree ? Position.Bottom : Position.Left} className="thread-map-handle" />
      <span className="thread-map-label">{data.active ? "Current thread" : "Thread"}</span>
      <strong>{data.title}</strong>
      <p>{data.preview}</p>
      {!data.compact && (
        <div className="thread-map-actions nodrag nopan">
          {data.hasChildren && (
            <button
              onClick={(event) => {
                event.stopPropagation();
                data.onToggle?.(id);
              }}
              aria-label={`${data.collapsed ? "Expand" : "Collapse"} branches for ${data.title}`}
              title={data.collapsed ? "Expand branches" : "Collapse branches"}
            >
              <ChevronIcon className={data.collapsed ? "collapsed" : ""} />
            </button>
          )}
          <button
            onClick={(event) => {
              event.stopPropagation();
              data.onFocus?.(id);
            }}
            aria-label={`Focus lineage for ${data.title}`}
            title="Focus lineage"
          >
            <GraphIcon />
          </button>
          <button
            onClick={(event) => {
              event.stopPropagation();
              data.onOpen?.(id);
            }}
            aria-label={`Open ${data.title}`}
            title="Open conversation"
          >
            <ThreadIcon />
          </button>
        </div>
      )}
      <Handle type="source" position={data.tree ? Position.Top : Position.Right} className="thread-map-handle" />
    </div>
  );
}

export function ConversationMap({
  graph,
  activeThreadId,
  onOpenThread,
  compact = false,
  focusThreadId,
  finale = false,
}: {
  graph: GraphData;
  activeThreadId?: string | null;
  onOpenThread?: (id: string) => void;
  compact?: boolean;
  focusThreadId?: string;
  finale?: boolean;
}) {
  const [instance, setInstance] = useState<ReactFlowInstance | null>(null);
  const [nodesInitialized, setNodesInitialized] = useState(false);
  const [mode, setMode] = useState<MapMode>(() => {
    if (compact) return "lineage";
    const stored = window.localStorage.getItem(MAP_MODE_KEY);
    return stored === "tree" ? "tree" : "lineage";
  });
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(
    compact ? null : activeThreadId ?? null,
  );
  const [collapsedNodeIds, setCollapsedNodeIds] = useState<Set<string>>(new Set());
  const [layoutStatus, setLayoutStatus] = useState("");
  const [isExporting, setIsExporting] = useState(false);
  const basePositions = useMemo(
    () => mode === "tree"
      ? layoutKnowledgeTree(graph)
      : layoutConversationGraph(graph, compact),
    [compact, graph, mode],
  );
  const selectedLineage = useMemo(
    () => selectedNodeId ? getConnectedLineage(graph, selectedNodeId) : null,
    [graph, selectedNodeId],
  );
  const distances = useMemo(
    () => new Map(graph.nodes.map((node) => [node.id, graphDistances(graph, node.id)])),
    [graph],
  );
  const lastDragPosition = useRef<{ id: string; x: number; y: number } | null>(null);
  const nodesRef = useRef<Node<ThreadNodeData>[]>([]);
  const flowRef = useRef<HTMLDivElement>(null);
  const hasFitView = useRef(false);
  const previousMode = useRef(mode);
  const nodesWithChildren = useMemo(
    () => new Set(graph.edges.map((edge) => edge.source)),
    [graph.edges],
  );
  const hiddenNodeIds = useMemo(() => {
    const hidden = new Set<string>();
    for (const nodeId of collapsedNodeIds) {
      for (const descendant of getDescendants(graph, nodeId)) hidden.add(descendant);
    }
    return hidden;
  }, [collapsedNodeIds, graph]);

  const requestFocus = useCallback((id: string) => {
    setSelectedNodeId(id);
    hasFitView.current = true;
    const lineage = getConnectedLineage(graph, id);
    window.requestAnimationFrame(() => {
      void instance?.fitView({
        nodes: nodesRef.current.filter((node) => lineage.has(node.id) && !node.hidden),
        duration: 650,
        padding: 0.45,
        maxZoom: 1.05,
      });
    });
  }, [graph, instance]);
  const toggleBranches = useCallback((id: string) => {
    const isCollapsing = !collapsedNodeIds.has(id);
    if (
      isCollapsing
      && selectedNodeId
      && getDescendants(graph, id).has(selectedNodeId)
    ) {
      setSelectedNodeId(id);
    }
    setCollapsedNodeIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, [collapsedNodeIds, graph, selectedNodeId]);

  const calculatedNodes = useMemo<Node<ThreadNodeData>[]>(() => graph.nodes.map((node) => ({
    id: node.id,
    type: "threadCard",
    data: {
      title: node.label,
      preview: node.preview,
      active: node.id === activeThreadId,
      selected: node.id === selectedNodeId,
      dimmed: Boolean(selectedLineage && !selectedLineage.has(node.id)),
      compact,
      tree: mode === "tree",
      hasChildren: nodesWithChildren.has(node.id),
      collapsed: collapsedNodeIds.has(node.id),
      onOpen: onOpenThread,
      onFocus: requestFocus,
      onToggle: toggleBranches,
    },
    position: graph.layouts?.[mode]?.[node.id] ?? basePositions.get(node.id) ?? { x: 0, y: 0 },
    hidden: hiddenNodeIds.has(node.id),
    draggable: !compact,
    selectable: !compact,
  })), [
    activeThreadId,
    basePositions,
    compact,
    collapsedNodeIds,
    graph.layouts,
    graph.nodes,
    hiddenNodeIds,
    mode,
    nodesWithChildren,
    onOpenThread,
    requestFocus,
    selectedLineage,
    selectedNodeId,
    toggleBranches,
  ]);
  const [nodes, setNodes] = useState(calculatedNodes);

  useEffect(() => {
    const modeChanged = previousMode.current !== mode;
    previousMode.current = mode;
    const frame = window.requestAnimationFrame(() => {
      setNodes((current) => {
        const currentById = new Map(current.map((node) => [node.id, node]));
        const next = calculatedNodes.map((node) => ({
          ...node,
          position: modeChanged
            ? node.position
            : currentById.get(node.id)?.position ?? node.position,
        }));
        nodesRef.current = next;
        if (modeChanged) hasFitView.current = false;
        return next;
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [calculatedNodes, mode]);

  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  const edges = useMemo<Edge[]>(() => graph.edges.map((edge) => {
    const inSelectedLineage = Boolean(
      selectedLineage?.has(edge.source) && selectedLineage.has(edge.target),
    );
    const active = edge.target === activeThreadId;
    return {
      id: `${edge.source}-${edge.target}`,
      source: edge.source,
      target: edge.target,
      type: mode === "tree" ? "bezier" : "smoothstep",
      animated: !compact && (inSelectedLineage || active),
      markerEnd: mode === "tree" ? undefined : {
        type: MarkerType.ArrowClosed,
        width: compact ? 8 : 12,
        height: compact ? 8 : 12,
        color: inSelectedLineage || active ? "var(--app-accent)" : "var(--graph-edge)",
      },
      style: {
        opacity: selectedLineage && !inSelectedLineage ? 0.18 : 1,
        stroke: inSelectedLineage || active ? "var(--app-accent)" : "var(--graph-edge)",
        strokeWidth: mode === "tree"
          ? inSelectedLineage || active ? 2.2 : 1.45
          : inSelectedLineage || active ? 1.8 : 1.2,
      },
      className: compact && active ? "tutorial-active-edge" : undefined,
      hidden: hiddenNodeIds.has(edge.source) || hiddenNodeIds.has(edge.target),
    };
  }), [activeThreadId, compact, graph.edges, hiddenNodeIds, mode, selectedLineage]);

  useEffect(() => {
    if (!instance || !nodesInitialized || nodes.length === 0) return;
    if (focusThreadId && !finale) {
      const focusedNode = nodes.find((node) => node.id === focusThreadId);
      if (focusedNode) {
        void instance.fitView({
          nodes: [focusedNode],
          duration: 700,
          padding: 1.7,
          maxZoom: 0.92,
        });
      }
      return;
    }
    if (hasFitView.current) return;
    hasFitView.current = true;
    void instance.fitView({
      duration: finale ? 1000 : 0,
      padding: compact ? 0.18 : 0.24,
    });
  }, [compact, finale, focusThreadId, instance, nodes, nodesInitialized]);

  const persistLayout = useCallback(async (nextNodes: Node<ThreadNodeData>[]) => {
    if (compact) return;
    setLayoutStatus("Saving layout...");
    try {
      await saveGraphLayout(mode, Object.fromEntries(
        nextNodes.map((node) => [node.id, {
          x: Math.round(node.position.x * 10) / 10,
          y: Math.round(node.position.y * 10) / 10,
        }]),
      ));
      setLayoutStatus("Layout saved");
    } catch (error) {
      setLayoutStatus(error instanceof Error ? error.message : "Could not save layout");
    }
  }, [compact, mode]);

  const resetLayout = useCallback(() => {
    const resetNodes = nodesRef.current.map((node) => ({
      ...node,
      position: basePositions.get(node.id) ?? node.position,
    }));
    setNodes(resetNodes);
    nodesRef.current = resetNodes;
    void persistLayout(resetNodes);
    window.requestAnimationFrame(() => {
      void instance?.fitView({ duration: 550, padding: 0.24 });
    });
  }, [basePositions, instance, persistLayout]);

  const changeMode = useCallback((nextMode: MapMode) => {
    if (nextMode === mode) return;
    setLayoutStatus("");
    setMode(nextMode);
    window.localStorage.setItem(MAP_MODE_KEY, nextMode);
  }, [mode]);

  const exportMap = useCallback(async () => {
    const flowElement = flowRef.current?.querySelector<HTMLElement>(".react-flow");
    if (!flowElement || !instance || isExporting) return;
    const previousViewport = instance.getViewport();
    const visibleNodes = nodesRef.current.filter((node) => !node.hidden);
    setIsExporting(true);
    setLayoutStatus("Preparing PNG...");
    try {
      await instance.fitView({ nodes: visibleNodes, duration: 0, padding: 0.16 });
      await new Promise<void>((resolve) => {
        window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()));
      });
      const dataUrl = await toPng(flowElement, {
        pixelRatio: 2,
        cacheBust: true,
        filter: (element) => !(
          element instanceof HTMLElement
          && (
            element.classList.contains("react-flow__controls")
            || element.classList.contains("map-toolbar")
          )
        ),
      });
      const link = document.createElement("a");
      link.download = `${mode === "tree" ? "knowledge-tree" : "conversation-lineage"}-${new Date().toISOString().slice(0, 10)}.png`;
      link.href = dataUrl;
      link.click();
      setLayoutStatus("PNG exported");
    } catch (error) {
      const message = error instanceof Error ? error.message.trim() : "";
      setLayoutStatus(message || "Could not export PNG");
    } finally {
      await instance.setViewport(previousViewport, { duration: 0 });
      setIsExporting(false);
    }
  }, [instance, isExporting, mode]);

  return (
    <div className="conversation-map-shell" ref={flowRef}>
      <ReactFlow
      className={`conversation-map map-${mode}`}
      nodes={nodes}
      edges={edges}
      minZoom={compact ? 0.35 : 0.2}
      maxZoom={compact ? 1 : 1.75}
      nodesDraggable={!compact}
      nodesConnectable={false}
      elementsSelectable={!compact}
      panOnDrag={!compact}
      zoomOnScroll={!compact}
      zoomOnPinch={!compact}
      zoomOnDoubleClick={!compact}
      preventScrolling={!compact}
      nodeTypes={NODE_TYPES}
      edgeTypes={EDGE_TYPES}
      onError={handleGraphError}
      onInit={setInstance}
      onNodesChange={(changes) => {
        setNodes((current) => {
          const next = applyNodeChanges(changes, current).map((node) => {
            const anchor = basePositions.get(node.id);
            if (!anchor || compact) return node;
            return {
              ...node,
              position: {
                x: mode === "tree"
                  ? node.position.x
                  : Math.max(anchor.x - 180, Math.min(anchor.x + 180, node.position.x)),
                y: mode === "tree"
                  ? Math.max(anchor.y - 120, Math.min(anchor.y + 120, node.position.y))
                  : node.position.y,
              },
            };
          });
          nodesRef.current = next;
          return next;
        });
      }}
      onNodeDragStart={(_, node) => {
        lastDragPosition.current = { id: node.id, x: node.position.x, y: node.position.y };
      }}
      onNodeDrag={(_, node) => {
        const previous = lastDragPosition.current;
        if (!previous || previous.id !== node.id) {
          lastDragPosition.current = { id: node.id, x: node.position.x, y: node.position.y };
          return;
        }
        const deltaX = node.position.x - previous.x;
        const deltaY = node.position.y - previous.y;
        lastDragPosition.current = { id: node.id, x: node.position.x, y: node.position.y };
        if (Math.abs(deltaX) < 0.1 && Math.abs(deltaY) < 0.1) return;
        const linked = distances.get(node.id);
        setNodes((current) => {
          const next = current.map((candidate) => {
            const distance = linked?.get(candidate.id);
            if (!distance || candidate.id === node.id) return candidate;
            const pull = distance === 1 ? 0.2 : 0.07;
            return {
              ...candidate,
              position: {
                x: candidate.position.x + (mode === "tree" ? deltaX * pull : 0),
                y: candidate.position.y + (mode === "tree" ? 0 : deltaY * pull),
              },
            };
          });
          nodesRef.current = next;
          return next;
        });
      }}
      onNodeDragStop={() => {
        lastDragPosition.current = null;
        void persistLayout(nodesRef.current);
      }}
      onNodeClick={compact ? undefined : (_, node) => setSelectedNodeId(node.id)}
      onNodeDoubleClick={compact ? undefined : (_, node) => onOpenThread?.(node.id)}
      onPaneClick={compact ? undefined : () => setSelectedNodeId(null)}
      proOptions={{ hideAttribution: true }}
    >
      <MapReadiness onChange={setNodesInitialized} />
      <Background
        id={compact ? "tutorial-grid" : "conversation-grid"}
        variant={BackgroundVariant.Lines}
        color="var(--graph-grid)"
        gap={compact ? 24 : 44}
        size={compact ? 0.55 : 0.4}
      />
      {!compact && (
        <>
          <Controls showInteractive={false} />
          <Panel position="top-right" className="map-toolbar">
            <div className="map-mode-switch" role="group" aria-label="Map orientation">
              <button
                className={mode === "lineage" ? "active" : ""}
                onClick={() => changeMode("lineage")}
                aria-pressed={mode === "lineage"}
              >
                Lineage
              </button>
              <button
                className={mode === "tree" ? "active" : ""}
                onClick={() => changeMode("tree")}
                aria-pressed={mode === "tree"}
              >
                Tree
              </button>
            </div>
            <button onClick={resetLayout}>Reset layout</button>
            <button onClick={() => void exportMap()} disabled={isExporting}>
              {isExporting ? "Exporting..." : "Export PNG"}
            </button>
            {layoutStatus && (
              <span
                className="map-layout-status"
                role={layoutStatus.includes("Could not") ? "alert" : "status"}
              >
                {layoutStatus}
              </span>
            )}
          </Panel>
        </>
      )}
      </ReactFlow>
    </div>
  );
}
