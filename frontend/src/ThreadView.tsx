import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { editThread, forkThread, getThread, reforkThread, streamMessage } from "./api";
import type { ForkedChild, MessageMetrics, StreamActivity, TableRowAnchor } from "./api";
import {
  CloseIcon,
  EditIcon,
  ProductMark,
  SendIcon,
  SparkIcon,
} from "./Icons";
import { ConversationChunk } from "./ConversationChunk";
import { MarkdownContent } from "./MarkdownContent";
import "./theme.css";

interface Chunk {
  id: string;
  kind: string;
  order: number;
  text: string;
  trace?: string[];
  metrics?: MessageMetrics;
  owner_thread_id?: string;
  is_ancestor?: boolean;
  table_rows?: TableRowAnchor[];
}

type PresentedChunk = Chunk & {
  content: string;
  role: "user" | "assistant" | "system" | "content";
};

function presentChunk(chunk: Chunk): PresentedChunk {
  const roles = ["user", "assistant", "system"] as const;
  const role = roles.find((candidate) => chunk.text.startsWith(`**${candidate}:**`));
  if (!role) return { ...chunk, content: chunk.text, role: "content" };
  return {
    ...chunk,
    content: chunk.text.replace(`**${role}:**`, "").trim(),
    role,
  };
}

function replaceChunk(
  rawContent: string,
  chunks: Chunk[],
  chunkId: string,
  replacement: string,
): string {
  let offset = 0;
  for (const chunk of chunks.filter((candidate) => !candidate.is_ancestor)) {
    const start = rawContent.indexOf(chunk.text, offset);
    if (start < 0) continue;
    if (chunk.id === chunkId) {
      return rawContent.slice(0, start) + replacement + rawContent.slice(start + chunk.text.length);
    }
    offset = start + chunk.text.length;
  }
  throw new Error("The selected chunk could not be found in this conversation.");
}

export function ThreadView({
  threadId,
  onForked,
  initialMessage,
  onInitialMessageConsumed,
  onReforked,
  onThreadUpdated,
}: {
  threadId: string;
  onForked?: (threadId: string, initialMessage: string) => void;
  initialMessage?: string;
  onInitialMessageConsumed?: () => void;
  onReforked?: (threadId: string, deletedThreadIds: string[]) => void;
  onThreadUpdated?: (thread: { id: string; title: string }) => void;
}) {
  const [title, setTitle] = useState("");
  const [chunks, setChunks] = useState<Chunk[]>([]);
  const [input, setInput] = useState("");
  const [expandedTrace, setExpandedTrace] = useState<Set<string>>(new Set());
  const [lineageDepth, setLineageDepth] = useState(0);
  const [rawContent, setRawContent] = useState("");
  const [forkedChildren, setForkedChildren] = useState<ForkedChild[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState("");
  const [forkSource, setForkSource] = useState<PresentedChunk | null>(null);
  const [isForking, setIsForking] = useState(false);
  const [pendingUser, setPendingUser] = useState("");
  const [streamingContent, setStreamingContent] = useState("");
  const [streamingElapsedMs, setStreamingElapsedMs] = useState(0);
  const [streamActivities, setStreamActivities] = useState<StreamActivity[]>([]);
  const [selectedChunkId, setSelectedChunkId] = useState<string | null>(null);
  const [editSource, setEditSource] = useState<PresentedChunk | null>(null);
  const [editedContent, setEditedContent] = useState("");
  const [reforkSource, setReforkSource] = useState<PresentedChunk | null>(null);
  const [reforkChildId, setReforkChildId] = useState("");
  const [replacementTitle, setReplacementTitle] = useState("");
  const [isMutating, setIsMutating] = useState(false);
  const conversationRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const initialMessageSent = useRef(false);
  const streamStartedAt = useRef(0);

  const refresh = useCallback(async () => {
    try {
      const data = await getThread(threadId);
      setTitle(data.title);
      setChunks(data.chunks);
      setLineageDepth(data.lineage_depth ?? 0);
      setRawContent(data.raw_content ?? "");
      setForkedChildren(data.forked_children ?? []);
      return data;
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "Could not open this conversation.");
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [threadId]);

  useEffect(() => {
    let cancelled = false;
    getThread(threadId)
      .then((data) => {
        if (cancelled) return;
        setTitle(data.title);
        setChunks(data.chunks);
        setLineageDepth(data.lineage_depth ?? 0);
        setRawContent(data.raw_content ?? "");
        setForkedChildren(data.forked_children ?? []);
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Could not open this conversation.");
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [threadId]);

  const presentedChunks = useMemo(
    () => chunks
      .filter((chunk) => (
        !chunk.text.startsWith("# ")
        && !chunk.text.startsWith("**system:** [Forked from chunk")
      ))
      .map(presentChunk),
    [chunks],
  );
  const visibleSelectedChunkId = useMemo(
    () => selectedChunkId && presentedChunks.some((chunk) => chunk.id === selectedChunkId
      || chunk.table_rows?.some((row) => row.id === selectedChunkId))
      ? selectedChunkId
      : null,
    [presentedChunks, selectedChunkId],
  );

  useEffect(() => {
    const element = conversationRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [pendingUser, presentedChunks.length, streamingContent]);

  useEffect(() => {
    if (!isSending) return;
    const timer = window.setInterval(() => {
      setStreamingElapsedMs(Date.now() - streamStartedAt.current);
    }, 100);
    return () => window.clearInterval(timer);
  }, [isSending]);

  function toggleTrace(chunkId: string) {
    setExpandedTrace((previous) => {
      const next = new Set(previous);
      if (next.has(chunkId)) next.delete(chunkId);
      else next.add(chunkId);
      return next;
    });
  }

  const sendMessageContent = useCallback(async (message: string) => {
    setIsSending(true);
    setError("");
    setPendingUser(message);
    setStreamingContent("");
    setStreamActivities([]);
    streamStartedAt.current = Date.now();
    setStreamingElapsedMs(0);
    try {
      await streamMessage(threadId, message, (event) => {
        if (event.type === "activity") {
          setStreamActivities((current) => {
            const activity: StreamActivity = {
              id: event.id,
              kind: event.kind,
              label: event.label,
              detail: event.detail,
              state: event.state,
            };
            const existingIndex = current.findIndex((item) => item.id === activity.id);
            if (existingIndex < 0) return [...current, activity];
            return current.map((item, index) => index === existingIndex ? {
              ...item,
              ...activity,
              label: activity.label === "Using tool" ? item.label : activity.label,
              detail: activity.detail ?? item.detail,
            } : item);
          });
        }
        if (event.type === "delta") {
          setStreamingContent((current) => current + event.content);
          setStreamActivities((current) => current.map((activity) => (
            activity.kind === "status" && activity.state === "running"
              ? { ...activity, state: "complete" }
              : activity
          )));
        }
      });
      const refreshed = await refresh();
      if (refreshed) onThreadUpdated?.({ id: refreshed.id, title: refreshed.title });
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "Could not send your message.");
      const refreshed = await refresh();
      if (refreshed) onThreadUpdated?.({ id: refreshed.id, title: refreshed.title });
    } finally {
      setPendingUser("");
      setStreamingContent("");
      setIsSending(false);
    }
  }, [onThreadUpdated, refresh, threadId]);

  async function handleSend() {
    const message = input.trim();
    if (!message || isSending || isForking) return;
    setInput("");
    if (forkSource) {
      setIsForking(true);
      setError("");
      try {
        const child = await forkThread(threadId, forkSource.id, message);
        setForkSource(null);
        onForked?.(child.id, message);
      } catch (forkError) {
        setError(forkError instanceof Error ? forkError.message : "Could not create this branch.");
        setInput(message);
      } finally {
        setIsForking(false);
      }
      return;
    }
    await sendMessageContent(message);
  }

  useEffect(() => {
    if (!initialMessage || isLoading || initialMessageSent.current) return;
    initialMessageSent.current = true;
    onInitialMessageConsumed?.();
    void sendMessageContent(initialMessage);
  }, [initialMessage, isLoading, onInitialMessageConsumed, sendMessageContent]);

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Escape" && forkSource) {
      event.preventDefault();
      setForkSource(null);
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void handleSend();
    }
  }

  function beginBranch(chunk: PresentedChunk) {
    setForkSource(chunk);
    setInput("");
    window.requestAnimationFrame(() => composerRef.current?.focus());
  }

  function rowSource(chunk: PresentedChunk, row: TableRowAnchor): PresentedChunk {
    return { ...chunk, id: row.id, content: row.text, kind: "table-row", role: "content" };
  }

  function beginEdit(chunk: PresentedChunk) {
    setEditSource(chunk);
    setEditedContent(chunk.content);
  }

  async function submitEdit(event: React.FormEvent) {
    event.preventDefault();
    if (!editSource || !editedContent.trim()) return;
    const replacement = editSource.role === "content"
      ? editedContent.trim()
      : `**${editSource.role}:** ${editedContent.trim()}`;
    try {
      setIsMutating(true);
      setError("");
      await editThread(
        threadId,
        replaceChunk(rawContent, chunks, editSource.id, replacement),
      );
      setEditSource(null);
      await refresh();
    } catch (editError) {
      setError(editError instanceof Error ? editError.message : "Could not edit this chunk.");
    } finally {
      setIsMutating(false);
    }
  }

  function beginRefork(chunk: PresentedChunk) {
    const children = forkedChildren.filter((child) => child.chunk_id === chunk.id);
    if (!children.length) return;
    setReforkSource(chunk);
    setReforkChildId(children[0].thread_id);
    setReplacementTitle(`Replacement for ${children[0].title}`);
  }

  async function confirmRefork() {
    if (!reforkSource || !reforkChildId || !replacementTitle.trim()) return;
    try {
      setIsMutating(true);
      setError("");
      const result = await reforkThread(
        threadId,
        reforkChildId,
        reforkSource.id,
        replacementTitle.trim(),
      );
      setReforkSource(null);
      onReforked?.(result.new_thread.id, result.deleted_thread_ids);
    } catch (reforkError) {
      setError(reforkError instanceof Error ? reforkError.message : "Could not replace this branch.");
    } finally {
      setIsMutating(false);
    }
  }

  if (isLoading) {
    return (
      <div className="workspace-loading">
        <span className="loading-mark"><ProductMark /></span>
        <p>Reconstructing this path...</p>
      </div>
    );
  }

  return (
    <div className="thread-view" onClick={(event) => {
      if (!(event.target as HTMLElement).closest(".message-block")) {
        setSelectedChunkId(null);
      }
    }}>
      <header className="thread-header">
        <div>
          <span className="eyebrow">Conversation</span>
          <h1>{title || "Untitled thread"}</h1>
        </div>
        <div className="thread-context">
          <span className="status-dot" />
          <span>{lineageDepth === 0 ? "Root thread" : `${lineageDepth} branches deep`}</span>
        </div>
      </header>

      <div className="conversation-scroll" ref={conversationRef}>
        {lineageDepth >= 5 && (
          <div className="lineage-notice">
            <SparkIcon />
            <div>
              <strong>A deep line of thought</strong>
              <p>This thread carries {lineageDepth} branches of context, so responses may take longer.</p>
            </div>
          </div>
        )}

        {error && (
          <div className="inline-error" role="alert">
            <strong>Something interrupted the flow.</strong>
            <span>{error}</span>
          </div>
        )}

        {presentedChunks.length === 0 && !pendingUser ? (
          <div className="thread-empty">
            <span className="empty-mark"><ProductMark /></span>
            <span className="eyebrow">A blank canvas</span>
            <h2>What are you thinking about?</h2>
            <p>Ask a question, untangle a decision, or follow a thought wherever it leads.</p>
          </div>
        ) : (
          <div className="message-list">
            {presentedChunks.map((chunk) => (
              <div
                key={chunk.id}
                data-chunk-id={chunk.id}
                className={chunk.is_ancestor ? "ancestor-chunk" : ""}
              >
                {!chunk.is_ancestor
                  && presentedChunks.some((candidate) => candidate.is_ancestor)
                  && presentedChunks.findIndex((candidate) => !candidate.is_ancestor) === presentedChunks.indexOf(chunk)
                  && <div className="current-branch-start"><span>Current branch</span></div>}
                <ConversationChunk
                  content={chunk.content}
                  role={chunk.role}
                  trace={chunk.trace}
                  metrics={chunk.metrics}
                  tableRows={chunk.table_rows}
                  selectedRowId={visibleSelectedChunkId}
                  onSelectRow={chunk.is_ancestor ? undefined : (row) => setSelectedChunkId(row.id)}
                  onBranchRow={chunk.is_ancestor || chunk.role === "user" ? undefined : (row) => {
                    setSelectedChunkId(row.id);
                    beginBranch(rowSource(chunk, row));
                  }}
                  onReforkRow={chunk.is_ancestor ? undefined : (row) => beginRefork(rowSource(chunk, row))}
                  reforkRowIds={forkedChildren.map((child) => child.chunk_id)}
                  selected={visibleSelectedChunkId === chunk.id}
                  onSelect={chunk.is_ancestor ? undefined : () => setSelectedChunkId(chunk.id)}
                  traceExpanded={expandedTrace.has(chunk.id)}
                  onToggleTrace={() => toggleTrace(chunk.id)}
                  onCopy={chunk.role === "user" || chunk.is_ancestor ? undefined : () => navigator.clipboard.writeText(chunk.content)}
                  onBranch={chunk.role === "user" || chunk.is_ancestor ? undefined : () => beginBranch(chunk)}
                  onEdit={chunk.is_ancestor ? undefined : () => beginEdit(chunk)}
                  onRefork={
                    !chunk.is_ancestor && forkedChildren.some((child) => child.chunk_id === chunk.id)
                      ? () => beginRefork(chunk)
                      : undefined
                  }
                />
              </div>
            ))}
            {pendingUser && (
              <>
                <ConversationChunk content={pendingUser} role="user" />
                <ConversationChunk
                  content={streamingContent}
                  role="assistant"
                  streaming
                  streamingElapsedMs={streamingElapsedMs}
                  activities={streamActivities}
                />
              </>
            )}
          </div>
        )}
      </div>

      <div className="composer-wrap">
        {forkSource && (
          <div className="branch-composer-context">
            <div>
              <span>{forkSource.kind === "table-row" ? "Branching from table row" : "Branching from"}</span>
              {forkSource.kind === "table-row"
                ? <div className="branch-row-preview markdown-body"><MarkdownContent content={forkSource.content} /></div>
                : <strong>{forkSource.content}</strong>}
            </div>
            <button
              type="button"
              onClick={() => setForkSource(null)}
              aria-label="Cancel branch"
              title="Cancel branch"
            >
              <CloseIcon />
            </button>
          </div>
        )}
        <div className="composer">
          <textarea
            ref={composerRef}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleComposerKeyDown}
            placeholder={forkSource ? "What direction should this branch take?" : "Ask, explore, or follow a thought..."}
            rows={1}
            aria-label="Message"
          />
          <button
            className="composer-send"
            onClick={() => void handleSend()}
            disabled={!input.trim() || isSending || isForking}
            aria-label={isSending ? "Sending message" : forkSource ? "Create branch" : "Send message"}
          >
            {isSending || isForking ? <span className="send-spinner" /> : <SendIcon />}
          </button>
        </div>
        <span className="composer-hint">
          {forkSource ? "Enter to create branch · Esc to cancel" : "Enter to send · Shift + Enter for a new line"}
        </span>
      </div>
      {editSource && (
        <div className="dialog-backdrop" role="presentation" onMouseDown={() => setEditSource(null)}>
          <form className="app-dialog chunk-edit-dialog" role="dialog" aria-modal="true" aria-labelledby="edit-chunk-heading" onSubmit={submitEdit} onMouseDown={(event) => event.stopPropagation()}>
            <button type="button" className="dialog-close" onClick={() => setEditSource(null)} aria-label="Close"><CloseIcon /></button>
            <span className="dialog-icon"><EditIcon /></span>
            <span className="dialog-kicker">Edit in place</span>
            <h2 id="edit-chunk-heading">Edit this chunk</h2>
            <p>Existing branches stay attached. Edits that change a branch point are rejected.</p>
            <label>
              <span>Content</span>
              <textarea autoFocus value={editedContent} onChange={(event) => setEditedContent(event.target.value)} />
            </label>
            <div className="dialog-actions">
              <button type="button" className="button-quiet" onClick={() => setEditSource(null)}>Cancel</button>
              <button type="submit" className="button-dark" disabled={!editedContent.trim() || isMutating}>Save</button>
            </div>
          </form>
        </div>
      )}
      {reforkSource && (
        <div className="dialog-backdrop" role="presentation" onMouseDown={() => setReforkSource(null)}>
          <div className="app-dialog branch-dialog" role="alertdialog" aria-modal="true" aria-labelledby="refork-heading" onMouseDown={(event) => event.stopPropagation()}>
            <button type="button" className="dialog-close" onClick={() => setReforkSource(null)} aria-label="Close"><CloseIcon /></button>
            <span className="dialog-icon danger"><SparkIcon /></span>
            <span className="dialog-kicker">Destructive re-fork</span>
            <h2 id="refork-heading">Replace this branch?</h2>
            <p>The selected branch and all of its descendants will be deleted before its replacement is created.</p>
            {forkedChildren.filter((child) => child.chunk_id === reforkSource.id).length > 1 && (
              <label>
                <span>Branch to replace</span>
                <select aria-label="Branch to replace" value={reforkChildId} onChange={(event) => setReforkChildId(event.target.value)}>
                  {forkedChildren.filter((child) => child.chunk_id === reforkSource.id).map((child) => (
                    <option key={child.thread_id} value={child.thread_id}>{child.title}</option>
                  ))}
                </select>
              </label>
            )}
            <label>
              <span>Replacement title</span>
              <input value={replacementTitle} onChange={(event) => setReplacementTitle(event.target.value)} />
            </label>
            <div className="dialog-actions">
              <button type="button" className="button-quiet" onClick={() => setReforkSource(null)}>Cancel</button>
              <button type="button" className="button-danger" disabled={!replacementTitle.trim() || isMutating} onClick={() => void confirmRefork()}>Delete and replace</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
