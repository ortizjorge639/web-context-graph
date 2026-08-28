import { useEffect, useState } from "react";
import { getGraph } from "./api";
import type { GraphData } from "./api";
import { ConversationMap } from "./ConversationMap";
import { GraphIcon, ProductMark } from "./Icons";
import "reactflow/dist/style.css";

export function GraphView({
  activeThreadId,
  initialGraph,
  onOpenThread,
}: {
  activeThreadId?: string | null;
  initialGraph?: GraphData;
  onOpenThread?: (id: string) => void;
}) {
  const [graph, setGraph] = useState<GraphData>(initialGraph ?? { nodes: [], edges: [] });
  const [isLoading, setIsLoading] = useState(!initialGraph);
  const [error, setError] = useState("");
  useEffect(() => {
    if (initialGraph) return;
    getGraph()
      .then(setGraph)
      .catch((graphError: unknown) => {
        setError(graphError instanceof Error ? graphError.message : "Could not load the map.");
      })
      .finally(() => setIsLoading(false));
  }, [initialGraph]);
  const displayedGraph = initialGraph ?? graph;
  const displayedError = initialGraph ? "" : error;

  if (!initialGraph && isLoading) {
    return (
      <div className="workspace-loading">
        <span className="loading-mark"><ProductMark /></span>
        <p>Drawing your map...</p>
      </div>
    );
  }

  return (
    <div className="graph-view">
      <header className="graph-header">
        <div>
          <span className="eyebrow">Spatial view</span>
          <h1>Your conversation map</h1>
          <p>Arrange your lineage, grow a knowledge tree, and export the map you own.</p>
        </div>
        <div className="graph-count">
          <GraphIcon />
          <span>{displayedGraph.nodes.length} {displayedGraph.nodes.length === 1 ? "thread" : "threads"}</span>
        </div>
      </header>

      {displayedError ? (
        <div className="inline-error graph-error" role="alert">
          <strong>The map could not be drawn.</strong>
          <span>{displayedError}</span>
        </div>
      ) : displayedGraph.nodes.length === 0 ? (
        <div className="graph-empty">
          <span className="empty-mark"><GraphIcon /></span>
          <h2>Your map starts with a thought</h2>
          <p>Create a conversation, then branch from any response to watch it grow.</p>
        </div>
      ) : (
        <div className="graph-canvas">
          <ConversationMap
            graph={displayedGraph}
            activeThreadId={activeThreadId}
            onOpenThread={onOpenThread}
          />
        </div>
      )}
    </div>
  );
}
