import { describe, expect, test } from "vitest";
import type { GraphData } from "./api";
import {
  getConnectedLineage,
  getDescendants,
  layoutConversationGraph,
  layoutKnowledgeTree,
} from "./conversationMapLayout";

const graph: GraphData = {
  nodes: [
    { id: "root", label: "Root", preview: "Root preview", status: "active", created_at: "2026-01-01T00:00:00Z" },
    { id: "newer", label: "Newer", preview: "Newer preview", status: "active", created_at: "2026-01-03T00:00:00Z" },
    { id: "older", label: "Older", preview: "Older preview", status: "active", created_at: "2026-01-02T00:00:00Z" },
    { id: "deep", label: "Deep", preview: "Deep preview", status: "active", created_at: "2026-01-04T00:00:00Z" },
  ],
  edges: [
    { source: "root", target: "newer", chunk_id: "root#c2" },
    { source: "root", target: "older", chunk_id: "root#c1" },
    { source: "older", target: "deep", chunk_id: "older#c1" },
  ],
};

describe("layoutConversationGraph", () => {
  test("flows parent-child relationships from left to right", () => {
    const positions = layoutConversationGraph(graph);
    expect(positions.get("older")!.x).toBeGreaterThan(positions.get("root")!.x);
    expect(positions.get("deep")!.x).toBeGreaterThan(positions.get("older")!.x);
  });

  test("places older sibling branches above newer branches", () => {
    const positions = layoutConversationGraph(graph);
    expect(positions.get("older")!.y).toBeLessThan(positions.get("newer")!.y);
  });
});

test("focuses ancestors and descendants without including sibling branches", () => {
  const lineage = getConnectedLineage(graph, "older");
  expect([...lineage]).toEqual(expect.arrayContaining(["root", "older", "deep"]));
  expect(lineage.has("newer")).toBe(false);
});

test("collapses only the selected node's descendant subtree", () => {
  expect([...getDescendants(graph, "older")]).toEqual(["deep"]);
  expect([...getDescendants(graph, "root")]).toEqual(
    expect.arrayContaining(["older", "newer", "deep"]),
  );
});

test("grows the knowledge tree upward from centered roots", () => {
  const positions = layoutKnowledgeTree(graph);
  expect(positions.get("older")!.y).toBeLessThan(positions.get("root")!.y);
  expect(positions.get("deep")!.y).toBeLessThan(positions.get("older")!.y);
  expect(positions.get("root")!.x).toBe(
    (positions.get("older")!.x + positions.get("newer")!.x) / 2,
  );
});
