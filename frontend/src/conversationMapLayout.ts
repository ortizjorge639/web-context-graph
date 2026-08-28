import type { GraphData } from "./api";

export function getConnectedLineage(graph: GraphData, nodeId: string): Set<string> {
  const parents = new Map(graph.edges.map((edge) => [edge.target, edge.source]));
  const children = new Map<string, string[]>();
  for (const edge of graph.edges) {
    children.set(edge.source, [...(children.get(edge.source) ?? []), edge.target]);
  }

  const connected = new Set([nodeId]);
  let parent = parents.get(nodeId);
  while (parent) {
    connected.add(parent);
    parent = parents.get(parent);
  }
  const queue = [...(children.get(nodeId) ?? [])];
  while (queue.length > 0) {
    const child = queue.shift()!;
    if (connected.has(child)) continue;
    connected.add(child);
    queue.push(...(children.get(child) ?? []));
  }
  return connected;
}

export function getDescendants(graph: GraphData, nodeId: string): Set<string> {
  const children = new Map<string, string[]>();
  for (const edge of graph.edges) {
    children.set(edge.source, [...(children.get(edge.source) ?? []), edge.target]);
  }
  const descendants = new Set<string>();
  const queue = [...(children.get(nodeId) ?? [])];
  while (queue.length > 0) {
    const child = queue.shift()!;
    if (descendants.has(child)) continue;
    descendants.add(child);
    queue.push(...(children.get(child) ?? []));
  }
  return descendants;
}

export function layoutConversationGraph(graph: GraphData, compact = false) {
  const horizontalGap = compact ? 190 : 300;
  const verticalGap = compact ? 116 : 160;
  const children = new Map<string, string[]>();
  const targets = new Set(graph.edges.map((edge) => edge.target));
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));

  for (const edge of graph.edges) {
    const branch = children.get(edge.source) ?? [];
    branch.push(edge.target);
    children.set(edge.source, branch);
  }
  for (const branch of children.values()) {
    branch.sort((left, right) =>
      (byId.get(left)?.created_at ?? "").localeCompare(byId.get(right)?.created_at ?? "")
    );
  }

  const roots = graph.nodes
    .filter((node) => !targets.has(node.id))
    .sort((left, right) => left.created_at.localeCompare(right.created_at));
  const positions = new Map<string, { x: number; y: number }>();
  const visited = new Set<string>();
  let leafRow = 0;

  function place(threadId: string, depth: number): number {
    if (visited.has(threadId)) return positions.get(threadId)?.y ?? leafRow * verticalGap;
    visited.add(threadId);
    const branch = (children.get(threadId) ?? []).filter((id) => byId.has(id));
    let y: number;
    if (branch.length === 0) {
      y = leafRow * verticalGap;
      leafRow += 1;
    } else {
      const childRows = branch.map((childId) => place(childId, depth + 1));
      y = (childRows[0] + childRows[childRows.length - 1]) / 2;
    }
    positions.set(threadId, { x: depth * horizontalGap, y });
    return y;
  }

  for (const root of roots) {
    if (leafRow > 0) leafRow += 1;
    place(root.id, 0);
  }
  for (const node of graph.nodes) {
    if (!visited.has(node.id)) {
      if (leafRow > 0) leafRow += 1;
      place(node.id, 0);
    }
  }

  return positions;
}

export function layoutKnowledgeTree(graph: GraphData) {
  const horizontalGap = 230;
  const verticalGap = 180;
  const children = new Map<string, string[]>();
  const targets = new Set(graph.edges.map((edge) => edge.target));
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));

  for (const edge of graph.edges) {
    children.set(edge.source, [...(children.get(edge.source) ?? []), edge.target]);
  }
  for (const branch of children.values()) {
    branch.sort((left, right) =>
      (byId.get(left)?.created_at ?? "").localeCompare(byId.get(right)?.created_at ?? "")
    );
  }

  const roots = graph.nodes
    .filter((node) => !targets.has(node.id))
    .sort((left, right) => left.created_at.localeCompare(right.created_at));
  const positions = new Map<string, { x: number; y: number }>();
  const visited = new Set<string>();
  let leafColumn = 0;

  function place(threadId: string, depth: number): number {
    if (visited.has(threadId)) return positions.get(threadId)?.x ?? leafColumn * horizontalGap;
    visited.add(threadId);
    const branch = (children.get(threadId) ?? []).filter((id) => byId.has(id));
    let x: number;
    if (branch.length === 0) {
      x = leafColumn * horizontalGap;
      leafColumn += 1;
    } else {
      const childColumns = branch.map((childId) => place(childId, depth + 1));
      x = (childColumns[0] + childColumns[childColumns.length - 1]) / 2;
    }
    positions.set(threadId, { x, y: -depth * verticalGap });
    return x;
  }

  for (const root of roots) {
    if (leafColumn > 0) leafColumn += 1;
    place(root.id, 0);
  }
  for (const node of graph.nodes) {
    if (!visited.has(node.id)) {
      if (leafColumn > 0) leafColumn += 1;
      place(node.id, 0);
    }
  }

  const xs = [...positions.values()].map((position) => position.x);
  const center = xs.length > 0 ? (Math.min(...xs) + Math.max(...xs)) / 2 : 0;
  for (const [id, position] of positions) {
    positions.set(id, { x: position.x - center, y: position.y });
  }
  return positions;
}
