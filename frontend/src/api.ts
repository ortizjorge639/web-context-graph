const BASE = import.meta.env.VITE_API_BASE || "http://localhost:8000";

export async function createThread(title: string) {
  const res = await fetch(`${BASE}/threads`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
  return res.json();
}

export async function getThread(id: string) {
  const res = await fetch(`${BASE}/threads/${id}`);
  return res.json();
}

export async function sendMessage(threadId: string, content: string) {
  const res = await fetch(`${BASE}/threads/${threadId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role: "user", content }),
  });
  return res.json();
}

export async function forkThread(threadId: string, chunkId: string, title: string) {
  const res = await fetch(`${BASE}/threads/${threadId}/fork`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chunk_id: chunkId, title }),
  });
  return res.json();
}
