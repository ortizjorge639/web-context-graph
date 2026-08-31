import { useMemo, useState } from "react";
import { revealVaultFile } from "./api";
import type { VaultFile, VaultFiles, VaultThread } from "./api";
import {
  ChevronIcon,
  DataIcon,
  DocumentIcon,
  EditIcon,
  FilesIcon,
  FinderIcon,
  MoreIcon,
  RefreshIcon,
  ThreadIcon,
  TrashIcon,
} from "./Icons";

export type FileSelection = {
  file: VaultFile;
  thread: VaultThread | null;
};

type ContextMenu = {
  path: string;
  x: number;
  y: number;
} | null;

function revealLabel() {
  const platform = navigator.platform.toLowerCase();
  if (platform.includes("win")) return "Reveal in File Explorer";
  if (platform.includes("mac")) return "Reveal in Finder";
  return "Reveal in file manager";
}

export function FilesExplorer({
  activeThreadId,
  selectedPath,
  vault,
  onSelect,
  onOpenThread,
  onRenameThread,
  onDeleteThread,
  onRefresh,
}: {
  activeThreadId: string | null;
  selectedPath: string | null;
  vault: VaultFiles | null;
  onSelect: (selection: FileSelection) => void;
  onOpenThread?: (threadId: string) => void;
  onRenameThread?: (threadId: string) => void;
  onDeleteThread?: (threadId: string) => void;
  onRefresh?: () => void;
}) {
  const [expansionOverrides, setExpansionOverrides] = useState<Record<string, boolean>>({});
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenu>(null);
  const [status, setStatus] = useState("");

  const tree = useMemo(() => {
    const threads = vault?.threads ?? [];
    const ids = new Set(threads.map((thread) => thread.id));
    const children = new Map<string, VaultThread[]>();
    for (const thread of threads) {
      const parentId = thread.forked_from?.thread_id;
      if (!parentId || !ids.has(parentId)) continue;
      const siblings = children.get(parentId) ?? [];
      siblings.push(thread);
      children.set(parentId, siblings);
    }
    return {
      roots: threads.filter((thread) => (
        !thread.forked_from || !ids.has(thread.forked_from.thread_id)
      )),
      children,
    };
  }, [vault]);

  if (!vault) {
    return <div className="explorer-loading">Reading local vault...</div>;
  }
  const loadedVault = vault;

  function toggle(threadId: string) {
    const defaultExpanded = loadedVault.active_lineage_ids.includes(threadId);
    setExpansionOverrides((current) => ({
      ...current,
      [threadId]: !(current[threadId] ?? defaultExpanded),
    }));
    setOpenMenu(null);
  }

  async function reveal(path: string) {
    setOpenMenu(null);
    setContextMenu(null);
    setStatus("");
    try {
      await revealVaultFile(path);
      setStatus(`Revealed in ${revealLabel().replace("Reveal in ", "")}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not reveal vault item");
    }
  }

  function openContextMenu(
    event: React.MouseEvent,
    path: string,
  ) {
    event.preventDefault();
    setOpenMenu(null);
    setContextMenu({
      path,
      x: event.clientX,
      y: event.clientY,
    });
  }

  function renderFile(file: VaultFile, thread: VaultThread | null, depth: number) {
    const isMetadata = file.name.endsWith(".yaml");
    const Icon = isMetadata ? DataIcon : DocumentIcon;
    return (
      <button
        key={file.path}
        className={`explorer-file${depth > 0 ? " nested" : ""}${selectedPath === file.path ? " active" : ""}`}
        style={{ "--explorer-depth": depth } as React.CSSProperties}
        onClick={() => onSelect({ file, thread })}
        onContextMenu={(event) => openContextMenu(event, file.path)}
      >
        <Icon />
        <span>{file.name}</span>
        {isMetadata && <small>details</small>}
      </button>
    );
  }

  function renderThread(thread: VaultThread, depth = 0): React.ReactNode {
    const children = tree.children.get(thread.id) ?? [];
    const isInLineage = loadedVault.active_lineage_ids.includes(thread.id);
    const isExpanded = expansionOverrides[thread.id] ?? isInLineage;
    return (
      <div className="explorer-thread" key={thread.id}>
        <div className="explorer-folder-row">
          <button
            className={`explorer-folder${depth > 0 ? " nested" : ""}${isInLineage ? " in-lineage" : ""}${thread.id === activeThreadId ? " current" : ""}`}
            style={{ "--explorer-depth": depth } as React.CSSProperties}
            onClick={() => toggle(thread.id)}
            onContextMenu={(event) => openContextMenu(event, thread.folder)}
            aria-expanded={isExpanded}
          >
            <ChevronIcon className={isExpanded ? "expanded" : ""} />
            <FilesIcon className="explorer-folder-icon" />
            <span>{thread.title}</span>
            {children.length > 0 && <small>{children.length}</small>}
            {thread.id === activeThreadId && <em>current</em>}
          </button>
          <button
            className="explorer-menu-trigger"
            aria-label={`Actions for ${thread.title}`}
            aria-expanded={openMenu === thread.id}
            onClick={() => setOpenMenu((current) => current === thread.id ? null : thread.id)}
          >
            <MoreIcon />
          </button>
          {openMenu === thread.id && (
            <div className="explorer-menu">
              <button onClick={() => {
                setOpenMenu(null);
                onOpenThread?.(thread.id);
              }}><ThreadIcon />Open conversation</button>
              <button onClick={() => {
                setOpenMenu(null);
                onRenameThread?.(thread.id);
              }}><EditIcon />Rename</button>
              <button onClick={() => void reveal(thread.folder)}><FinderIcon />{revealLabel()}</button>
              <button className="danger" onClick={() => {
                setOpenMenu(null);
                onDeleteThread?.(thread.id);
              }}><TrashIcon />Delete</button>
            </div>
          )}
        </div>
        {isExpanded && (
          <div
            className="explorer-children"
            style={{ "--explorer-depth": depth } as React.CSSProperties}
          >
            {thread.files.map((file) => renderFile(file, thread, depth + 1))}
            {children.map((child) => renderThread(child, depth + 1))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="files-explorer" aria-label="Vault explorer" onClick={() => setContextMenu(null)}>
      <div className="explorer-root">
        <FilesIcon />
        <strong>{loadedVault.vault_name}</strong>
        <button onClick={onRefresh} title="Refresh vault"><RefreshIcon /><span>Refresh</span></button>
      </div>
      {renderFile(loadedVault.guide, null, 0)}
      {renderFile(loadedVault.index, null, 0)}
      <div className="explorer-folder-label">
        <span>Conversations</span>
        <small>{loadedVault.threads.length}</small>
      </div>
      {tree.roots.map((thread) => renderThread(thread))}
      {contextMenu && (
        <div
          className="explorer-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          role="menu"
          aria-label="File actions"
          onClick={(event) => event.stopPropagation()}
        >
          <button role="menuitem" onClick={() => void reveal(contextMenu.path)}>
            <FinderIcon />
            {revealLabel()}
          </button>
        </div>
      )}
      {status && <div className="explorer-status" role="status">{status}</div>}
    </div>
  );
}
