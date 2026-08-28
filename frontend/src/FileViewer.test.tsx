import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { FileViewer } from "./FileViewer";
import type { VaultFiles, VaultThread } from "./api";

const parent: VaultThread = {
  id: "parent",
  title: "Parent conversation",
  folder: "threads/parent",
  status: "active",
  created_at: "2026-08-27T00:00:00Z",
  updated_at: "2026-08-27T01:00:00Z",
  pinned: false,
  message_count: 2,
  forked_from: null,
  forked_children: [{ thread_id: "child", chunk_id: "parent#c2", title: "Child branch" }],
  files: [],
};

const child: VaultThread = {
  ...parent,
  id: "child",
  title: "Child branch",
  folder: "threads/child",
  forked_from: { thread_id: "parent", chunk_id: "parent#c2", title: "Parent conversation" },
  forked_children: [],
};

const vault: VaultFiles = {
  vault_name: "vault",
  active_lineage_ids: ["parent", "child"],
  health: {
    status: "healthy",
    relationship_issues: 0,
    index_updated_at: "2026-08-27T02:00:00Z",
  },
  guide: { name: "AGENTS.md", path: "AGENTS.md" },
  index: { name: "index.md", path: "index.md" },
  threads: [parent, child],
};

test("presents metadata as navigable relationships with raw YAML optional", () => {
  const onOpenThread = vi.fn();
  render(
    <FileViewer
      selection={{
        file: {
          name: "meta.yaml",
          path: "threads/child/meta.yaml",
          content: "id: child\nstatus: active\n",
        },
        thread: child,
      }}
      vault={vault}
      loading={false}
      onOpenThread={onOpenThread}
    />,
  );

  expect(screen.getByText("Conversation details")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Parent conversation/ }));
  expect(onOpenThread).toHaveBeenCalledWith("parent");

  fireEvent.click(screen.getByText("View raw YAML"));
  expect(screen.getByText(/id: child/)).toBeInTheDocument();
});

test("shows index health and the complete hierarchy", () => {
  render(
    <FileViewer
      selection={{
        file: { name: "index.md", path: "index.md", content: "# Index" },
        thread: null,
      }}
      vault={vault}
      loading={false}
      onOpenThread={vi.fn()}
    />,
  );

  expect(screen.getByText("Current")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Parent conversation/ })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Child branch/ })).toBeInTheDocument();
});
