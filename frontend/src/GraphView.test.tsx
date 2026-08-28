import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { GraphView } from "./GraphView";

vi.mock("./ConversationMap", () => ({
  ConversationMap: ({ graph }: { graph: { nodes: Array<{ label: string }> } }) => (
    <div>{graph.nodes.map((node) => node.label).join(", ")}</div>
  ),
}));

test("updates the map when refreshed graph data arrives", () => {
  const first = {
    nodes: [{
      id: "thread",
      label: "Original title",
      status: "active",
      preview: "",
      created_at: "2026-08-28T00:00:00Z",
    }],
    edges: [],
  };
  const refreshed = {
    ...first,
    nodes: [{ ...first.nodes[0], label: "Renamed title" }],
  };
  const { rerender } = render(<GraphView initialGraph={first} />);

  expect(screen.getByText("Original title")).toBeInTheDocument();
  rerender(<GraphView initialGraph={refreshed} />);

  expect(screen.getByText("Renamed title")).toBeInTheDocument();
  expect(screen.queryByText("Original title")).not.toBeInTheDocument();
});
