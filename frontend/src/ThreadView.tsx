import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { forkThread, getThread, streamMessage } from "./api";
import type { MessageMetrics, StreamActivity } from "./api";
import {
  CloseIcon,
  ProductMark,
  SendIcon,
  SparkIcon,
} from "./Icons";
import { ConversationChunk } from "./ConversationChunk";
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

export function ThreadView({
  threadId,
  onForked,
  initialMessage,
  onInitialMessageConsumed,
}: {
  threadId: string;
  onForked?: (threadId: string, initialMessage: string) => void;
  initialMessage?: string;
  onInitialMessageConsumed?: () => void;
}) {
  const [title, setTitle] = useState("");
  const [chunks, setChunks] = useState<Chunk[]>([]);
  const [input, setInput] = useState("");
  const [expandedTrace, setExpandedTrace] = useState<Set<string>>(new Set());
  const [lineageDepth, setLineageDepth] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState("");
  const [forkSource, setForkSource] = useState<PresentedChunk | null>(null);
  const [isForking, setIsForking] = useState(false);
  const [pendingUser, setPendingUser] = useState("");
  const [streamingContent, setStreamingContent] = useState("");
  const [streamingElapsedMs, setStreamingElapsedMs] = useState(0);
  const [streamActivities, setStreamActivities] = useState<StreamActivity[]>([]);
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
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "Could not open this conversation.");
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
      await refresh();
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "Could not send your message.");
      await refresh();
    } finally {
      setPendingUser("");
      setStreamingContent("");
      setIsSending(false);
    }
  }, [refresh, threadId]);

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

  if (isLoading) {
    return (
      <div className="workspace-loading">
        <span className="loading-mark"><ProductMark /></span>
        <p>Reconstructing this path...</p>
      </div>
    );
  }

  return (
    <div className="thread-view">
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
                  traceExpanded={expandedTrace.has(chunk.id)}
                  onToggleTrace={() => toggleTrace(chunk.id)}
                  onCopy={chunk.role === "user" || chunk.is_ancestor ? undefined : () => navigator.clipboard.writeText(chunk.content)}
                  onBranch={chunk.role === "user" || chunk.is_ancestor ? undefined : () => beginBranch(chunk)}
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
              <span>Branching from</span>
              <strong>{forkSource.content}</strong>
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
    </div>
  );
}
