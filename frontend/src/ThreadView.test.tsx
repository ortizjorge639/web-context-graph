import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { vi, test, expect } from "vitest";
import { ThreadView } from "./ThreadView";
import * as api from "./api";

test("renders chunks returned by getThread", async () => {
  vi.spyOn(api, "getThread").mockResolvedValue({
    chunks: [{ id: "t1#c0", kind: "block", order: 0, text: "Hello world" }],
  } as any);
  render(<ThreadView threadId="t1" />);
  expect(await screen.findByText("Hello world")).toBeInTheDocument();
});

test("reasoning trace is collapsed by default and expands on click", async () => {
  vi.spyOn(api, "getThread").mockResolvedValue({
    chunks: [
      { id: "t1#c0", kind: "block", order: 0, text: "Hello", trace: ["step one", "step two"] },
    ],
  } as any);
  render(<ThreadView threadId="t1" />);
  expect(await screen.findByText("2 steps")).toBeInTheDocument();
  expect(screen.queryByText("step one")).not.toBeInTheDocument();
  screen.getByText("2 steps").click();
  expect(await screen.findByText("step one")).toBeInTheDocument();
});

test("streams a response and renders persisted message metrics", async () => {
  const metrics = {
    model: "gpt-test",
    input_tokens: 10,
    output_tokens: 4,
    total_tokens: 14,
    elapsed_ms: 1250,
    timestamp: "2026-08-28T00:00:00Z",
    first_chunk_order: 2,
    last_chunk_order: 2,
  };
  vi.spyOn(api, "getThread")
    .mockResolvedValueOnce({
      id: "t1",
      title: "Streaming",
      chunks: [],
      lineage_depth: 0,
    })
    .mockResolvedValueOnce({
      id: "t1",
      title: "Streaming",
      chunks: [{
        id: "t1#c2",
        kind: "block",
        order: 2,
        text: "**assistant:** Hello there",
        metrics,
      }],
      lineage_depth: 0,
    });
  vi.spyOn(api, "streamMessage").mockImplementation(async (_threadId, _content, onEvent) => {
    onEvent({ type: "delta", content: "Hello" });
    onEvent({ type: "delta", content: " there" });
    onEvent({ type: "complete", metrics });
    return metrics;
  });

  render(<ThreadView threadId="t1" />);
  const input = await screen.findByLabelText("Message");
  fireEvent.change(input, { target: { value: "Say hello" } });
  fireEvent.click(screen.getByLabelText("Send message"));

  await waitFor(() => expect(screen.getByText("Hello there")).toBeInTheDocument());
  expect(screen.getByText("gpt-test")).toBeInTheDocument();
  expect(screen.getByText("1.3s")).toBeInTheDocument();
  expect(screen.getByText("4 tokens")).toBeInTheDocument();
});

test("surfaces agent and tool activity while waiting for output", async () => {
  const metrics = {
    model: "gpt-test",
    input_tokens: 10,
    output_tokens: 2,
    total_tokens: 12,
    elapsed_ms: 900,
    timestamp: "2026-08-28T00:00:00Z",
    first_chunk_order: 2,
    last_chunk_order: 2,
  };
  vi.spyOn(api, "getThread").mockResolvedValue({
    id: "t1",
    title: "Activity",
    chunks: [],
    lineage_depth: 0,
  });
  let finishStream: ((value: typeof metrics) => void) | undefined;
  vi.spyOn(api, "streamMessage").mockImplementation(async (_threadId, _content, onEvent) => {
    onEvent({
      type: "activity",
      id: "startup",
      kind: "status",
      label: "Starting Copilot",
      state: "running",
    });
    onEvent({
      type: "activity",
      id: "tool-1",
      kind: "tool",
      label: "Searching the workspace",
      detail: "Find related files",
      state: "running",
    });
    return new Promise((resolve) => {
      finishStream = resolve;
    });
  });

  render(<ThreadView threadId="t1" />);
  fireEvent.change(await screen.findByLabelText("Message"), { target: { value: "Investigate" } });
  fireEvent.click(screen.getByLabelText("Send message"));

  expect(await screen.findByLabelText("Agent activity")).toBeInTheDocument();
  expect(screen.getAllByText("Searching the workspace").length).toBeGreaterThan(0);
  expect(screen.getByText("Find related files")).toBeInTheDocument();

  finishStream?.(metrics);
  await waitFor(() => expect(screen.queryByLabelText("Agent activity")).not.toBeInTheDocument());
});

test("creates a branch only after the branch prompt is submitted", async () => {
  vi.spyOn(api, "getThread").mockResolvedValue({
    id: "parent",
    title: "Parent",
    chunks: [{
      id: "parent#c1",
      kind: "block",
      order: 1,
      text: "**assistant:** Source thought",
      owner_thread_id: "parent",
      is_ancestor: false,
    }],
    lineage_depth: 0,
  });
  const forkThread = vi.spyOn(api, "forkThread").mockResolvedValue({
    id: "child",
    title: "Explore another angle",
    status: "active",
    updated_at: "2026-08-28T00:00:00Z",
    forked_from: { thread_id: "parent", chunk_id: "parent#c1" },
  });
  const onForked = vi.fn();

  render(<ThreadView threadId="parent" onForked={onForked} />);
  fireEvent.click(await screen.findByLabelText("Branch from this chunk"));

  expect(forkThread).not.toHaveBeenCalled();
  expect(screen.getByText("Branching from")).toBeInTheDocument();

  fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Explore another angle" } });
  fireEvent.click(screen.getByLabelText("Create branch"));

  await waitFor(() => expect(forkThread).toHaveBeenCalledWith(
    "parent",
    "parent#c1",
    "Explore another angle",
  ));
  expect(onForked).toHaveBeenCalledWith("child", "Explore another angle");
});

test("dims ancestor context and exposes actions only on the current branch", async () => {
  vi.spyOn(api, "getThread").mockResolvedValue({
    id: "child",
    title: "Child",
    chunks: [
      {
        id: "parent#c1",
        kind: "block",
        order: 1,
        text: "**assistant:** Ancestor thought",
        owner_thread_id: "parent",
        is_ancestor: true,
      },
      {
        id: "child#c2",
        kind: "block",
        order: 2,
        text: "**assistant:** Current thought",
        owner_thread_id: "child",
        is_ancestor: false,
      },
    ],
    lineage_depth: 1,
  });

  const { container } = render(<ThreadView threadId="child" />);

  expect(await screen.findByText("Ancestor thought")).toBeInTheDocument();
  expect(screen.getByText("Current branch")).toBeInTheDocument();
  expect(container.querySelectorAll(".ancestor-chunk .message-actions")).toHaveLength(0);
  expect(screen.getAllByLabelText("Branch from this chunk")).toHaveLength(1);
});
