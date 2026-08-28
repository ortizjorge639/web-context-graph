import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { FilesExplorer } from "./FilesExplorer";
import type { VaultFiles } from "./api";

const vault: VaultFiles = {
  vault_name: "web-context-graph-data",
  active_lineage_ids: ["active-thread"],
  health: { status: "healthy", relationship_issues: 0, index_updated_at: null },
  guide: { name: "AGENTS.md", path: "AGENTS.md", content: "# Agent Guide" },
  index: { name: "index.md", path: "index.md", content: "# Index" },
  threads: [
    {
      id: "active-thread",
      title: "Active thread",
      folder: "threads/active-thread",
      status: "active",
      created_at: "2026-08-27T00:00:00Z",
      updated_at: "2026-08-27T01:00:00Z",
      pinned: false,
      message_count: 1,
      forked_from: null,
      forked_children: [],
      files: [
        {
          name: "thread.md",
          path: "threads/active-thread/thread.md",
          content: "# Active",
        },
        {
          name: "meta.yaml",
          path: "threads/active-thread/meta.yaml",
          content: "id: active-thread",
        },
      ],
    },
    {
      id: "other-thread",
      title: "Other thread",
      folder: "threads/other-thread",
      status: "active",
      created_at: "2026-08-27T02:00:00Z",
      updated_at: "2026-08-27T02:00:00Z",
      pinned: false,
      message_count: 0,
      forked_from: null,
      forked_children: [],
      files: [],
    },
  ],
};

test("expands the active lineage and selects a file", () => {
  const onSelect = vi.fn();
  render(
    <FilesExplorer
      activeThreadId="active-thread"
      selectedPath={null}
      vault={vault}
      onSelect={onSelect}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: /thread.md/i }));
  expect(onSelect).toHaveBeenCalledWith({
    file: vault.threads[0].files[0],
    thread: vault.threads[0],
  });
  expect(screen.getByRole("button", { name: "Other thread" })).toHaveAttribute(
    "aria-expanded",
    "false",
  );
});

test("nests branch folders under their parent and exposes management actions", () => {
  const parent = vault.threads[0];
  const child = {
    ...vault.threads[1],
    id: "child-thread",
    title: "Child branch",
    folder: "threads/child-thread",
    forked_from: {
      thread_id: parent.id,
      chunk_id: `${parent.id}#c2`,
      title: parent.title,
    },
  };
  const nestedVault: VaultFiles = {
    ...vault,
    threads: [
      { ...parent, forked_children: [{
        thread_id: child.id,
        chunk_id: `${parent.id}#c2`,
        title: child.title,
      }] },
      child,
    ],
  };
  const onOpenThread = vi.fn();
  const onRenameThread = vi.fn();

  render(
    <FilesExplorer
      activeThreadId={parent.id}
      selectedPath={null}
      vault={nestedVault}
      onSelect={vi.fn()}
      onOpenThread={onOpenThread}
      onRenameThread={onRenameThread}
    />,
  );

  expect(screen.getByRole("button", { name: /^Child branch$/ })).toBeInTheDocument();
  fireEvent.click(screen.getByLabelText(`Actions for ${child.title}`));
  fireEvent.click(screen.getByText("Open conversation"));
  expect(onOpenThread).toHaveBeenCalledWith(child.id);

  fireEvent.click(screen.getByLabelText(`Actions for ${child.title}`));
  fireEvent.click(screen.getByText("Rename"));
  expect(onRenameThread).toHaveBeenCalledWith(child.id);
});
