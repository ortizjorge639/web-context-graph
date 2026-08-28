import { useMemo } from "react";
import DOMPurify from "dompurify";
import { marked } from "marked";
import { BranchIcon, ChevronIcon, CopyIcon, EditIcon, SparkIcon } from "./Icons";
import type { MessageMetrics, StreamActivity } from "./api";

export type ConversationRole = "user" | "assistant" | "system" | "content";

export function ConversationChunk({
  content,
  role,
  trace,
  traceExpanded = false,
  onToggleTrace,
  onCopy,
  onBranch,
  onEdit,
  onRefork,
  compact = false,
  metrics,
  streaming = false,
  streamingElapsedMs = 0,
  activities = [],
}: {
  content: string;
  role: ConversationRole;
  trace?: string[];
  traceExpanded?: boolean;
  onToggleTrace?: () => void;
  onCopy?: () => void;
  onBranch?: () => void;
  onEdit?: () => void;
  onRefork?: () => void;
  compact?: boolean;
  metrics?: MessageMetrics;
  streaming?: boolean;
  streamingElapsedMs?: number;
  activities?: StreamActivity[];
}) {
  const timestamp = metrics
    ? new Date(metrics.timestamp).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : "";
  const elapsed = metrics
    ? metrics.elapsed_ms < 1000
      ? `${metrics.elapsed_ms}ms`
      : `${(metrics.elapsed_ms / 1000).toFixed(1)}s`
    : "";
  const isAssistantOutput = role === "assistant" || role === "content";
  const renderedMarkdown = useMemo(() => {
    if (role === "user") return "";
    const parsed = marked.parse(content, { async: false, gfm: true });
    const externalLinks = parsed.replace(
      /<a /g,
      '<a target="_blank" rel="noreferrer" ',
    );
    return DOMPurify.sanitize(externalLinks, { ADD_ATTR: ["target", "rel"] });
  }, [content, role]);

  return (
    <article className={`message-block message-${role}${compact ? " message-compact" : ""}${streaming ? " message-streaming" : ""}`}>
      <div className="message-body">
        {streaming && activities.length > 0 && (
          <section className="agent-activity" aria-label="Agent activity" aria-live="polite">
            <header>
              <SparkIcon />
              <strong>{content ? "Working" : activities.slice().reverse().find((activity) => activity.state === "running")?.label ?? "Working"}</strong>
              <span>{(streamingElapsedMs / 1000).toFixed(1)}s</span>
            </header>
            <ol>
              {activities.map((activity) => (
                <li key={activity.id} className={`activity-${activity.state}`}>
                  <span className="activity-state" aria-hidden="true" />
                  <div>
                    <strong>{activity.label}</strong>
                    {activity.detail && <code>{activity.detail}</code>}
                  </div>
                </li>
              ))}
            </ol>
          </section>
        )}
        <div className={`message-text${role === "user" ? "" : " markdown-body"}`}>
          {role === "user"
            ? content
            : <div className="markdown-body-rendered" dangerouslySetInnerHTML={{ __html: renderedMarkdown }} />}
          {streaming && <span className="streaming-cursor" aria-label="Generating response" />}
        </div>

        {trace && trace.length > 0 && (
          <div className="reasoning-trace">
            <button onClick={onToggleTrace}>
              <SparkIcon />
              <span>{trace.length} steps</span>
              <ChevronIcon className={traceExpanded ? "rotated" : ""} />
            </button>
            {traceExpanded && (
              <ol>
                {trace.map((step, index) => <li key={index}>{step}</li>)}
              </ol>
            )}
          </div>
        )}

        {isAssistantOutput && (metrics || streaming) && (
          <footer className="message-metrics">
            {streaming ? (
              <>
                <span className="metrics-generating">Generating</span>
                <span>{(streamingElapsedMs / 1000).toFixed(1)}s</span>
              </>
            ) : metrics ? (
              <>
                <span>{metrics.model}</span>
                <span>{elapsed}</span>
                <span title={`${metrics.total_tokens.toLocaleString()} total tokens`}>
                  {metrics.output_tokens.toLocaleString()} tokens
                </span>
                <time dateTime={metrics.timestamp}>{timestamp}</time>
              </>
            ) : null}
          </footer>
        )}
      </div>

      {(onCopy || onBranch || onEdit || onRefork) && (
        <div className="message-actions">
          {onCopy && (
            <button onClick={onCopy} aria-label="Copy chunk" title="Copy">
              <CopyIcon />
            </button>
          )}
          {onBranch && (
            <button onClick={onBranch} aria-label="Branch from this chunk" title="Branch from here">
              <BranchIcon />
            </button>
          )}
          {onEdit && (
            <button onClick={onEdit} aria-label="Edit chunk" title="Edit">
              <EditIcon />
            </button>
          )}
          {onRefork && (
            <button onClick={onRefork} aria-label="Replace branch from this chunk" title="Replace branch">
              <BranchIcon />
            </button>
          )}
        </div>
      )}
    </article>
  );
}
