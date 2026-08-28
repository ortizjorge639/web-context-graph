const BASE = import.meta.env.VITE_API_BASE || "http://localhost:8000";

export interface ThreadSummary {
  id: string;
  title: string;
  status: string;
  updated_at: string;
  forked_from?: {
    thread_id: string;
    chunk_id: string;
  } | null;
  pinned?: boolean;
  sidebar_order?: number | null;
  descendant_count?: number;
}

export interface ForkedChild {
  thread_id: string;
  chunk_id: string;
  title: string;
}

export interface GraphData {
  nodes: Array<{
    id: string;
    label: string;
    status: string;
    preview: string;
    created_at: string;
  }>;
  edges: Array<{ source: string; target: string; chunk_id: string }>;
  layouts?: {
    lineage?: Record<string, { x: number; y: number }>;
    tree?: Record<string, { x: number; y: number }>;
  };
}

export interface MessageMetrics {
  model: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  elapsed_ms: number;
  timestamp: string;
  first_chunk_order: number;
  last_chunk_order: number;
}

export interface StreamActivity {
  id: string;
  kind: "status" | "tool";
  label: string;
  detail?: string | null;
  state: "running" | "complete" | "error";
}

export type StreamEvent =
  | { type: "activity"; id: string; kind: "status" | "tool"; label: string; detail?: string | null; state: "running" | "complete" | "error" }
  | { type: "model"; model: string }
  | { type: "delta"; content: string }
  | { type: "usage"; input_tokens: number; output_tokens: number; total_tokens: number }
  | { type: "complete"; metrics: MessageMetrics };

export interface TutorialStatus {
  exists: boolean;
  modified: boolean;
  version: number;
  root_thread_id: string | null;
  final_thread_id: string | null;
  thread_ids: string[];
  protected_thread_ids: string[];
}

export interface VaultFile {
  name: string;
  path: string;
  content?: string;
}

export interface VaultThread {
  id: string;
  title: string;
  folder: string;
  status: string;
  created_at: string;
  updated_at: string;
  pinned: boolean;
  message_count: number;
  forked_from: {
    thread_id: string;
    chunk_id: string;
    title: string;
  } | null;
  forked_children: Array<{
    thread_id: string;
    chunk_id: string;
    title: string;
  }>;
  files: VaultFile[];
}

export interface VaultFiles {
  vault_name: string;
  active_lineage_ids: string[];
  health: {
    status: "healthy" | "attention";
    relationship_issues: number;
    index_updated_at: string | null;
  };
  guide: VaultFile;
  index: VaultFile;
  threads: VaultThread[];
}

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export async function createThread(title: string) {
  const res = await fetch(`${BASE}/threads`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
  return readJson<ThreadSummary>(res);
}

export async function listThreads(query = ""): Promise<ThreadSummary[]> {
  const search = query.trim() ? `?q=${encodeURIComponent(query.trim())}` : "";
  const res = await fetch(`${BASE}/threads${search}`);
  return readJson<ThreadSummary[]>(res);
}

export async function updateThread(
  threadId: string,
  update: { title?: string; pinned?: boolean },
): Promise<ThreadSummary> {
  const res = await fetch(`${BASE}/threads/${threadId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(update),
  });
  return readJson<ThreadSummary>(res);
}

export async function reorderThreads(threadIds: string[]): Promise<void> {
  const res = await fetch(`${BASE}/threads/reorder`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ thread_ids: threadIds }),
  });
  await readJson<{ ok: boolean }>(res);
}

export async function deleteThread(threadId: string): Promise<{ deleted_ids: string[]; parent_id: string | null }> {
  const res = await fetch(`${BASE}/threads/${threadId}`, { method: "DELETE" });
  return readJson<{ deleted_ids: string[]; parent_id: string | null }>(res);
}

export async function getThread(id: string) {
  const res = await fetch(`${BASE}/threads/${id}`);
  return readJson<{
    id: string;
    title: string;
    raw_content: string;
    forked_children: ForkedChild[];
    chunks: Array<{
      id: string;
      kind: string;
      order: number;
      text: string;
      trace?: string[];
      metrics?: MessageMetrics;
      owner_thread_id?: string;
      is_ancestor?: boolean;
    }>;
    lineage_depth: number;
  }>(res);
}

export async function sendMessage(threadId: string, content: string) {
  const res = await fetch(`${BASE}/threads/${threadId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role: "user", content }),
  });
  return readJson<{ ok: boolean }>(res);
}

export async function streamMessage(
  threadId: string,
  content: string,
  onEvent: (event: StreamEvent) => void,
): Promise<MessageMetrics> {
  const response = await fetch(`${BASE}/threads/${threadId}/messages/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role: "user", content }),
  });
  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }
  if (!response.body) {
    throw new Error("The browser did not expose the response stream.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let completed: MessageMetrics | null = null;

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line) as StreamEvent | { type: "error"; message: string };
      if (event.type === "error") throw new Error(event.message);
      onEvent(event);
      if (event.type === "complete") completed = event.metrics;
    }
    if (done) break;
  }

  if (!completed) {
    throw new Error("The response stream ended before completion.");
  }
  return completed;
}

export async function forkThread(threadId: string, chunkId: string, prompt: string) {
  const res = await fetch(`${BASE}/threads/${threadId}/fork`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chunk_id: chunkId, prompt }),
  });
  return readJson<ThreadSummary>(res);
}

export async function editThread(threadId: string, newContent: string): Promise<void> {
  const res = await fetch(`${BASE}/threads/${threadId}/edit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ new_content: newContent }),
  });
  await readJson<{ ok: boolean; cascaded: false }>(res);
}

export async function reforkThread(
  threadId: string,
  oldChildThreadId: string,
  chunkId: string,
  newTitle: string,
): Promise<{ deleted_thread_ids: string[]; new_thread: ThreadSummary }> {
  const res = await fetch(`${BASE}/threads/${threadId}/refork`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      old_child_thread_id: oldChildThreadId,
      chunk_id: chunkId,
      new_title: newTitle,
    }),
  });
  return readJson<{ deleted_thread_ids: string[]; new_thread: ThreadSummary }>(res);
}

export async function getGraph(): Promise<GraphData> {
  const res = await fetch(`${BASE}/graph`);
  return readJson<GraphData>(res);
}

export async function saveGraphLayout(
  mode: "lineage" | "tree",
  positions: Record<string, { x: number; y: number }>,
): Promise<void> {
  const res = await fetch(`${BASE}/graph/layout`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode, positions }),
  });
  await readJson<{ ok: boolean }>(res);
}

export async function getTutorialStatus(): Promise<TutorialStatus> {
  const res = await fetch(`${BASE}/tutorial`);
  return readJson<TutorialStatus>(res);
}

export async function ensureTutorial(reset = false): Promise<TutorialStatus> {
  const res = await fetch(`${BASE}/tutorial`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reset }),
  });
  return readJson<TutorialStatus>(res);
}

export async function getThreadFiles(threadId: string): Promise<VaultFiles> {
  const res = await fetch(`${BASE}/files/${threadId}`);
  return readJson<VaultFiles>(res);
}

export async function getVaultFile(path: string): Promise<VaultFile> {
  const res = await fetch(`${BASE}/file-content?path=${encodeURIComponent(path)}`);
  return readJson<VaultFile>(res);
}

export async function refreshVaultIndex(): Promise<void> {
  const res = await fetch(`${BASE}/files/actions/refresh`, { method: "POST" });
  await readJson<{ ok: boolean }>(res);
}

export async function revealVaultFile(path: string): Promise<void> {
  const res = await fetch(`${BASE}/files/actions/reveal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  });
  await readJson<{ ok: boolean }>(res);
}
