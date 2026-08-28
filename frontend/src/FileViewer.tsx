import { useMemo, useState } from "react";
import { revealVaultFile } from "./api";
import type { VaultFiles, VaultThread } from "./api";
import type { FileSelection } from "./FilesExplorer";
import { CopyIcon, DataIcon, FinderIcon, ThreadIcon } from "./Icons";

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function FileViewer({
  selection,
  vault,
  loading,
  onOpenThread,
}: {
  selection: FileSelection;
  vault: VaultFiles | null;
  loading: boolean;
  onOpenThread: (threadId: string) => void;
}) {
  const [status, setStatus] = useState("");
  const [showRaw, setShowRaw] = useState(false);
  const isMetadata = selection.file.name === "meta.yaml";
  const isIndex = selection.file.name === "index.md";
  const isGuide = selection.file.name === "AGENTS.md";
  const content = selection.file.content ?? "";

  const roots = useMemo(() => {
    if (!vault) return [];
    const ids = new Set(vault.threads.map((thread) => thread.id));
    return vault.threads.filter((thread) => (
      !thread.forked_from || !ids.has(thread.forked_from.thread_id)
    ));
  }, [vault]);

  async function copyContent() {
    setStatus("");
    try {
      await navigator.clipboard.writeText(content);
      setStatus("Copied file");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not copy file");
    }
  }

  async function copyPath() {
    setStatus("");
    try {
      await navigator.clipboard.writeText(selection.file.path);
      setStatus("Copied path");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not copy path");
    }
  }

  async function reveal() {
    setStatus("");
    try {
      await revealVaultFile(selection.file.path);
      setStatus("Revealed in Finder");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not reveal file");
    }
  }

  function renderIndexThread(thread: VaultThread, depth = 0): React.ReactNode {
    if (!vault) return null;
    const children = vault.threads.filter((candidate) => (
      candidate.forked_from?.thread_id === thread.id
    ));
    return (
      <div key={thread.id}>
        <button
          className="vault-index-thread"
          style={{ "--index-depth": depth } as React.CSSProperties}
          onClick={() => onOpenThread(thread.id)}
        >
          <ThreadIcon />
          <span><strong>{thread.title}</strong><small>{children.length} {children.length === 1 ? "branch" : "branches"}</small></span>
        </button>
        {children.map((child) => renderIndexThread(child, depth + 1))}
      </div>
    );
  }

  const title = isMetadata
    ? "Conversation details"
    : isIndex
      ? "Vault index"
      : isGuide
        ? "Agent guide"
        : selection.file.name;

  return (
    <article className="file-viewer">
      <header className="file-viewer-header">
        <div>
          <span className="eyebrow">Local vault · User owned</span>
          <h1>{title}</h1>
          <p>{selection.file.path}</p>
        </div>
        <div className="file-viewer-actions">
          <button onClick={() => void copyContent()} disabled={loading}><CopyIcon /><span>Copy file</span></button>
          <button onClick={() => void copyPath()}><CopyIcon /><span>Copy path</span></button>
          <button onClick={() => void reveal()}><FinderIcon /><span>Reveal</span></button>
          {selection.thread && (
            <button className="primary" onClick={() => onOpenThread(selection.thread!.id)}>
              <ThreadIcon />
              <span>Open conversation</span>
            </button>
          )}
        </div>
      </header>

      <div className="file-viewer-meta">
        <span>{isMetadata ? "YAML" : "Markdown"}</span>
        {selection.thread && <span>{selection.thread.title}</span>}
        {!loading && <span>{content.split("\n").length} lines</span>}
        {(isMetadata || isIndex) && (
          <button onClick={() => setShowRaw((current) => !current)}>
            <DataIcon />
            {showRaw ? "Show overview" : `View raw ${isMetadata ? "YAML" : "index"}`}
          </button>
        )}
        {status && <strong role="status">{status}</strong>}
      </div>

      <div className={`file-viewer-content${showRaw ? " raw" : ""}`}>
        {loading ? (
          <div className="file-loading">Loading file...</div>
        ) : isMetadata && !showRaw && selection.thread ? (
          <div className="vault-details">
            <div className="vault-details-grid">
              <section>
                <span>Status</span>
                <strong className="vault-status">{selection.thread.status}</strong>
              </section>
              <section>
                <span>Created</span>
                <strong>{formatDate(selection.thread.created_at)}</strong>
              </section>
              <section>
                <span>Last updated</span>
                <strong>{formatDate(selection.thread.updated_at)}</strong>
              </section>
              <section>
                <span>Saved responses</span>
                <strong>{selection.thread.message_count}</strong>
              </section>
            </div>
            <section className="vault-relationships">
              <div>
                <span className="eyebrow">Parent conversation</span>
                {selection.thread.forked_from ? (
                  <button onClick={() => onOpenThread(selection.thread!.forked_from!.thread_id)}>
                    <ThreadIcon />
                    <span>
                      <strong>{selection.thread.forked_from.title}</strong>
                      <small>Forked at {selection.thread.forked_from.chunk_id.split("#").at(-1)}</small>
                    </span>
                  </button>
                ) : <p>This is a root conversation.</p>}
              </div>
              <div>
                <span className="eyebrow">Branches from this conversation</span>
                {selection.thread.forked_children.length ? (
                  selection.thread.forked_children.map((child) => (
                    <button key={child.thread_id} onClick={() => onOpenThread(child.thread_id)}>
                      <ThreadIcon />
                      <span>
                        <strong>{child.title}</strong>
                        <small>Linked from {child.chunk_id.split("#").at(-1)}</small>
                      </span>
                    </button>
                  ))
                ) : <p>No branches yet.</p>}
              </div>
            </section>
          </div>
        ) : isIndex && !showRaw && vault ? (
          <div className="vault-index-overview">
            <div className="vault-index-summary">
              <section><strong>{vault.threads.length}</strong><span>conversations</span></section>
              <section><strong>{roots.length}</strong><span>roots</span></section>
              <section><strong>{vault.threads.length - roots.length}</strong><span>branches</span></section>
              <section>
                <strong>{vault.health.status === "healthy" ? "Current" : "Check index"}</strong>
                <span>
                  {vault.health.relationship_issues
                    ? `${vault.health.relationship_issues} relationship issues`
                    : `Updated ${vault.health.index_updated_at ? formatDate(vault.health.index_updated_at) : "recently"}`}
                </span>
              </section>
            </div>
            <div className="vault-index-tree">
              <span className="eyebrow">Conversation hierarchy</span>
              {roots.map((thread) => renderIndexThread(thread))}
            </div>
          </div>
        ) : (
          <pre><code>{content}</code></pre>
        )}
      </div>
    </article>
  );
}
