import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import App from "./App";
import * as api from "./api";

vi.mock("./ThreadView", () => ({
  ThreadView: ({ threadId }: { threadId: string }) => <div>Thread {threadId}</div>,
}));
vi.mock("./GraphView", () => ({
  GraphView: () => <div>Graph</div>,
}));

beforeEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

test("skipping onboarding persists completion", async () => {
  vi.spyOn(api, "listThreads").mockResolvedValue([]);
  vi.spyOn(api, "createThread").mockResolvedValue({
    id: "new-thread",
    title: "Untitled thread",
    status: "active",
    updated_at: "2026-08-27T00:00:00Z",
  });
  vi.spyOn(api, "ensureTutorial").mockResolvedValue({
    exists: true,
    modified: false,
    version: 1,
    root_thread_id: "tutorial-root",
    final_thread_id: "tutorial-final",
    thread_ids: ["tutorial-root", "tutorial-final"],
    protected_thread_ids: [],
  });
  vi.spyOn(api, "getGraph").mockResolvedValue({ nodes: [], edges: [] });
  vi.spyOn(api, "getThreadFiles").mockResolvedValue({
    vault_name: "web-context-graph-data",
    active_lineage_ids: ["tutorial-root", "tutorial-final"],
    health: { status: "healthy", relationship_issues: 0, index_updated_at: null },
    guide: { name: "AGENTS.md", path: "AGENTS.md" },
    index: { name: "index.md", path: "index.md", content: "" },
    threads: [],
  });

  render(<App />);
  fireEvent.click(screen.getByText("Skip tutorial"));

  expect(await screen.findByText("Graph")).toBeInTheDocument();
  expect(window.localStorage.getItem("wcg_onboarding_seen")).toBe("1");
});

test("loads existing threads without creating another and switches between them", async () => {
  window.localStorage.setItem("wcg_onboarding_seen", "1");
  vi.spyOn(api, "listThreads").mockResolvedValue([
    { id: "recent", title: "Recent thread", status: "active", updated_at: "2026-08-27T01:00:00Z" },
    { id: "older", title: "Older thread", status: "active", updated_at: "2026-08-27T00:00:00Z" },
  ]);
  const createThread = vi.spyOn(api, "createThread");

  render(<App />);

  expect(await screen.findByText("Thread recent")).toBeInTheDocument();
  expect(createThread).not.toHaveBeenCalled();

  fireEvent.change(screen.getByLabelText("Current thread"), { target: { value: "older" } });

  await waitFor(() => expect(screen.getByText("Thread older")).toBeInTheDocument());
});

test("places pinned conversations before the main conversation section", async () => {
  window.localStorage.setItem("wcg_onboarding_seen", "1");
  vi.spyOn(api, "listThreads").mockResolvedValue([
    {
      id: "pinned",
      title: "Pinned thread",
      status: "active",
      updated_at: "2026-08-27T01:00:00Z",
      pinned: true,
    },
    {
      id: "regular",
      title: "Regular thread",
      status: "active",
      updated_at: "2026-08-27T00:00:00Z",
      pinned: false,
    },
  ]);

  render(<App />);

  const pinnedLabel = await screen.findByText("Pinned");
  const conversationsLabel = screen.getByText("Conversations");
  expect(
    pinnedLabel.compareDocumentPosition(conversationsLabel)
      & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
});

test("nests child branches beneath expandable root conversations", async () => {
  window.localStorage.setItem("wcg_onboarding_seen", "1");
  vi.spyOn(api, "listThreads").mockResolvedValue([
    {
      id: "root",
      title: "Root conversation",
      status: "active",
      updated_at: "2026-08-27T01:00:00Z",
      forked_from: null,
    },
    {
      id: "child",
      title: "Child branch",
      status: "active",
      updated_at: "2026-08-27T00:00:00Z",
      forked_from: { thread_id: "root", chunk_id: "root#c1" },
    },
  ]);

  render(<App />);

  expect(await screen.findByRole("button", { name: /^Root conversation/ })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /^Child branch/ })).not.toBeInTheDocument();

  fireEvent.click(screen.getByLabelText("Expand Root conversation"));

  expect(screen.getByRole("button", { name: /^Child branch/ })).toBeInTheDocument();
});

test("searches and manages conversations from the row action menu", async () => {
  window.localStorage.setItem("wcg_onboarding_seen", "1");
  const root = {
    id: "root",
    title: "Root conversation",
    status: "active",
    updated_at: "2026-08-27T01:00:00Z",
    forked_from: null,
    pinned: false,
  };
  const listThreads = vi.spyOn(api, "listThreads").mockResolvedValue([root]);
  const updateThread = vi.spyOn(api, "updateThread").mockResolvedValue({
    ...root,
    pinned: true,
  });

  render(<App />);

  fireEvent.change(await screen.findByLabelText("Search conversations"), {
    target: { value: "root" },
  });
  await waitFor(() => expect(listThreads).toHaveBeenCalledWith("root"));

  fireEvent.click(screen.getByLabelText("Actions for Root conversation"));
  fireEvent.click(screen.getByText("Pin"));

  await waitFor(() => expect(updateThread).toHaveBeenCalledWith("root", { pinned: true }));

  fireEvent.click(screen.getByLabelText("Actions for Root conversation"));
  fireEvent.click(screen.getByText("Rename"));
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Renamed conversation" } });
  fireEvent.click(screen.getByText("Save"));

  await waitFor(() => expect(updateThread).toHaveBeenCalledWith(
    "root",
    { title: "Renamed conversation" },
  ));
});

test("confirms recursive conversation deletion", async () => {
  window.localStorage.setItem("wcg_onboarding_seen", "1");
  const root = {
    id: "root",
    title: "Root conversation",
    status: "active",
    updated_at: "2026-08-27T01:00:00Z",
    forked_from: null,
  };
  const child = {
    id: "child",
    title: "Child branch",
    status: "active",
    updated_at: "2026-08-27T00:00:00Z",
    forked_from: { thread_id: "root", chunk_id: "root#c1" },
  };
  vi.spyOn(api, "listThreads").mockResolvedValue([root, child]);
  const deleteThread = vi.spyOn(api, "deleteThread").mockResolvedValue({
    deleted_ids: ["root", "child"],
    parent_id: null,
  });

  render(<App />);

  fireEvent.click(await screen.findByLabelText("Actions for Root conversation"));
  fireEvent.click(screen.getByText("Delete"));

  expect(screen.getByText(/and 1 nested branch/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));

  await waitFor(() => expect(deleteThread).toHaveBeenCalledWith("root"));
  expect(await screen.findByText("No conversations yet")).toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: "New conversation" }).length).toBeGreaterThan(0);
});

test("dragging unpinned roots persists their new order", async () => {
  window.localStorage.setItem("wcg_onboarding_seen", "1");
  const first = {
    id: "first",
    title: "First root",
    status: "active",
    updated_at: "2026-08-27T01:00:00Z",
    forked_from: null,
  };
  const second = {
    id: "second",
    title: "Second root",
    status: "active",
    updated_at: "2026-08-27T00:00:00Z",
    forked_from: null,
  };
  vi.spyOn(api, "listThreads").mockResolvedValue([first, second]);
  const reorderThreads = vi.spyOn(api, "reorderThreads").mockResolvedValue();

  const { container } = render(<App />);
  const firstNode = (await screen.findByRole("button", { name: /^First root/ }))
    .closest(".thread-tree-node");
  const secondNode = screen.getByRole("button", { name: /^Second root/ })
    .closest(".thread-tree-node");
  expect(firstNode).not.toBeNull();
  expect(secondNode).not.toBeNull();

  fireEvent.dragStart(firstNode!);
  fireEvent.dragOver(secondNode!);
  fireEvent.drop(secondNode!);

  await waitFor(() => expect(reorderThreads).toHaveBeenCalledWith(["second", "first"]));
  expect(container.querySelector(".thread-tree-node.dragging")).not.toBeInTheDocument();
});

test("persists light dark and system appearance choices", async () => {
  window.localStorage.setItem("wcg_onboarding_seen", "1");
  vi.spyOn(api, "listThreads").mockResolvedValue([{
    id: "root",
    title: "Root",
    status: "active",
    updated_at: "2026-08-27T01:00:00Z",
    forked_from: null,
  }]);

  const { container } = render(<App />);
  fireEvent.click(await screen.findByTitle("Settings"));
  fireEvent.click(screen.getByText("Dark"));

  expect(container.querySelector(".app-shell")).toHaveClass("theme-dark");
  expect(window.localStorage.getItem("wcg_appearance")).toBe("dark");

  fireEvent.click(screen.getByText("Light"));
  expect(container.querySelector(".app-shell")).toHaveClass("theme-light");

  fireEvent.click(screen.getByText("System"));
  expect(window.localStorage.getItem("wcg_appearance")).toBe("system");
});
