import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { vi, test, expect, afterEach } from "vitest";
import { ThreadView } from "./ThreadView";
import * as api from "./api";

afterEach(() => vi.restoreAllMocks());

function mockTableThread() {
  const header = "| Command | Purpose |\n| :--- | ---: |";
  const table = `${header}\n| /help | Help |\n| /plan | Plan |\n| /diff | Diff |`;
  const rows = ["/help | Help", "/plan | Plan", "/diff | Diff"].map((text, index) => ({
    id: `t1#c1.row${index}`, table_index: 0, row_index: index,
    text: `${header}\n| ${text} |`, end_offset: 0,
  }));
  vi.spyOn(api, "getThread").mockResolvedValue({
    id: "t1", title: "Commands", raw_content: `# Commands\n\n${table}\n`,
    forked_children: [{ thread_id: "old-child", chunk_id: rows[1].id, title: "Plan branch" }],
    chunks: [{ id: "t1#c1", kind: "block", order: 1, text: table, table_rows: rows }],
    lineage_depth: 0,
  });
  return rows;
}

test("fork composer previews just the selected row with headers and sends its nested anchor", async () => {
  const rows = mockTableThread();
  const fork = vi.spyOn(api, "forkThread").mockResolvedValue({
    id: "child", title: "Explore plan", status: "active", updated_at: "",
  });
  const { container } = render(<ThreadView threadId="t1" />);
  fireEvent.click(await screen.findByLabelText("Branch from table row 2"));
  const preview = container.querySelector(".branch-composer-context")!;
  expect(preview).toHaveTextContent("Branching from table row");
  expect(preview).toHaveTextContent("Command");
  expect(preview).toHaveTextContent("Purpose");
  expect(preview).toHaveTextContent("/plan");
  expect(preview).not.toHaveTextContent("/help");
  expect(preview).not.toHaveTextContent("/diff");
  expect(container.querySelector('[data-chunk-id="t1#c1.row1"]')).toHaveClass("table-row-selected");
  fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Explore plan" } });
  fireEvent.click(screen.getByLabelText("Create branch"));
  await waitFor(() => expect(fork).toHaveBeenCalledWith("t1", rows[1].id, "Explore plan"));
});

test("revisiting a row branch exposes replace with explicit destructive confirmation", async () => {
  const rows = mockTableThread();
  const refork = vi.spyOn(api, "reforkThread").mockResolvedValue({
    deleted_thread_ids: ["old-child"],
    new_thread: { id: "replacement", title: "Replacement", status: "active", updated_at: "" },
  });
  render(<ThreadView threadId="t1" />);
  fireEvent.click(await screen.findByLabelText("Replace branch from table row 2"));
  expect(refork).not.toHaveBeenCalled();
  const dialog = screen.getByRole("alertdialog");
  expect(dialog).toHaveTextContent("all of its descendants will be deleted");
  fireEvent.click(within(dialog).getByRole("button", { name: "Delete and replace" }));
  await waitFor(() => expect(refork).toHaveBeenCalledWith(
    "t1", "old-child", rows[1].id, "Replacement for Plan branch",
  ));
});

function renderWithChunks(chunks: Array<{ id: string; kind: string; order: number; text: string }>) {
  vi.spyOn(api, "getThread").mockResolvedValue({
    id: "t1",
    title: "Selectable chunks",
    raw_content: "# Selectable chunks\n",
    forked_children: [],
    chunks,
    lineage_depth: 0,
  });
  return render(<ThreadView threadId="t1" />);
}

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

test("left-clicking a chunk selects it so actions persist", async () => {
  const { container } = renderWithChunks([
    {
      id: "t1#c1",
      kind: "block",
      order: 1,
      text: "**assistant:** First branchable answer",
    },
    {
      id: "t1#c2",
      kind: "block",
      order: 2,
      text: "**assistant:** Second branchable answer",
    },
  ]);

  fireEvent.click(await screen.findByText("First branchable answer"));
  expect(container.querySelector('[data-chunk-id="t1#c1"] .message-block')).toHaveClass("message-selected");

  fireEvent.click(screen.getByText("Second branchable answer"));
  expect(container.querySelector('[data-chunk-id="t1#c1"] .message-block')).not.toHaveClass("message-selected");
  expect(container.querySelector('[data-chunk-id="t1#c2"] .message-block')).toHaveClass("message-selected");

  fireEvent.click(screen.getByLabelText("Message"));
  expect(container.querySelector('[data-chunk-id="t1#c2"] .message-block')).not.toHaveClass("message-selected");
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
      raw_content: "# Streaming\n",
      forked_children: [],
      chunks: [],
      lineage_depth: 0,
    })
    .mockResolvedValueOnce({
      id: "t1",
      title: "Streaming",
      raw_content: "# Streaming\n\n**assistant:** Hello there\n",
      forked_children: [],
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
    raw_content: "# Activity\n",
    forked_children: [],
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

test("propagates refreshed title after a failed first stream", async () => {
  vi.spyOn(api, "getThread")
    .mockResolvedValueOnce({
      id: "t1",
      title: "New conversation",
      raw_content: "# New conversation\n",
      forked_children: [],
      chunks: [],
      lineage_depth: 0,
    })
    .mockResolvedValueOnce({
      id: "t1",
      title: "How should we improve Windows support",
      raw_content: "# How should we improve Windows support\n\n**user:** How should we improve Windows support?\n",
      forked_children: [],
      chunks: [{
        id: "t1#c1",
        kind: "block",
        order: 1,
        text: "**user:** How should we improve Windows support?",
      }],
      lineage_depth: 0,
    });
  vi.spyOn(api, "streamMessage").mockRejectedValue(new Error("copilot CLI failed"));
  const onThreadUpdated = vi.fn();

  render(<ThreadView threadId="t1" onThreadUpdated={onThreadUpdated} />);
  fireEvent.change(await screen.findByLabelText("Message"), {
    target: { value: "How should we improve Windows support?" },
  });
  fireEvent.click(screen.getByLabelText("Send message"));

  await waitFor(() => expect(onThreadUpdated).toHaveBeenCalledWith({
    id: "t1",
    title: "How should we improve Windows support",
  }));
});

test("creates a branch only after the branch prompt is submitted", async () => {
  vi.spyOn(api, "getThread").mockResolvedValue({
    id: "parent",
    title: "Parent",
    raw_content: "# Parent\n\n**assistant:** Source thought\n",
    forked_children: [],
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
    raw_content: "# Child\n\n**assistant:** Current thought\n",
    forked_children: [],
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

test("edits a current-branch chunk in place", async () => {
  vi.spyOn(api, "getThread")
    .mockResolvedValueOnce({
      id: "thread",
      title: "Thread",
      raw_content: "# Thread\n\n**assistant:** Original answer\n",
      forked_children: [],
      chunks: [{
        id: "thread#c1",
        kind: "block",
        order: 1,
        text: "**assistant:** Original answer",
        is_ancestor: false,
      }],
      lineage_depth: 0,
    })
    .mockResolvedValueOnce({
      id: "thread",
      title: "Thread",
      raw_content: "# Thread\n\n**assistant:** Revised answer\n",
      forked_children: [],
      chunks: [{
        id: "thread#c1",
        kind: "block",
        order: 1,
        text: "**assistant:** Revised answer",
        is_ancestor: false,
      }],
      lineage_depth: 0,
    });
  const editThread = vi.spyOn(api, "editThread").mockResolvedValue();

  render(<ThreadView threadId="thread" />);
  fireEvent.click(await screen.findByLabelText("Edit chunk"));
  fireEvent.change(screen.getByLabelText("Content"), { target: { value: "Revised answer" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));

  await waitFor(() => expect(editThread).toHaveBeenCalledWith(
    "thread",
    "# Thread\n\n**assistant:** Revised answer\n",
  ));
  expect(await screen.findByText("Revised answer")).toBeInTheDocument();
});

test("confirms destructive re-fork before replacing a child branch", async () => {
  vi.spyOn(api, "getThread").mockResolvedValue({
    id: "parent",
    title: "Parent",
    raw_content: "# Parent\n\n**assistant:** Source thought\n",
    forked_children: [{
      thread_id: "old-child",
      chunk_id: "parent#c1",
      title: "Old child",
    }],
    chunks: [{
      id: "parent#c1",
      kind: "block",
      order: 1,
      text: "**assistant:** Source thought",
      is_ancestor: false,
    }],
    lineage_depth: 0,
  });
  const reforkThread = vi.spyOn(api, "reforkThread").mockResolvedValue({
    deleted_thread_ids: ["old-child", "grandchild"],
    new_thread: {
      id: "replacement",
      title: "Replacement",
      status: "active",
      updated_at: "2026-08-28T00:00:00Z",
    },
  });
  const onReforked = vi.fn();

  render(<ThreadView threadId="parent" onReforked={onReforked} />);
  fireEvent.click(await screen.findByLabelText("Replace branch from this chunk"));

  expect(reforkThread).not.toHaveBeenCalled();
  expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Replacement title"), {
    target: { value: "Replacement" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Delete and replace" }));

  await waitFor(() => expect(reforkThread).toHaveBeenCalledWith(
    "parent",
    "old-child",
    "parent#c1",
    "Replacement",
  ));
  expect(onReforked).toHaveBeenCalledWith(
    "replacement",
    ["old-child", "grandchild"],
  );
});
