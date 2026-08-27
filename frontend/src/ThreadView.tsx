import { useState, useEffect } from "react";
import { getThread, sendMessage, forkThread } from "./api";
import "./theme.css";

interface Chunk {
  id: string;
  kind: string;
  order: number;
  text: string;
}

export function ThreadView({ threadId }: { threadId: string }) {
  const [chunks, setChunks] = useState<Chunk[]>([]);
  const [input, setInput] = useState("");
  const [expandedTrace, setExpandedTrace] = useState<Set<string>>(new Set());

  function toggleTrace(chunkId: string) {
    setExpandedTrace((prev) => {
      const next = new Set(prev);
      next.has(chunkId) ? next.delete(chunkId) : next.add(chunkId);
      return next;
    });
  }

  async function refresh() {
    const data = await getThread(threadId);
    setChunks(data.chunks);
  }

  useEffect(() => { refresh(); }, [threadId]);

  async function handleSend() {
    if (!input.trim()) return;
    await sendMessage(threadId, input);
    setInput("");
    await refresh();
  }

  async function handleFork(chunk: Chunk) {
    const title = window.prompt("Title for the new branch?", chunk.text.slice(0, 40));
    if (!title) return;
    const child = await forkThread(threadId, chunk.id, title);
    alert(`Forked into new thread: ${child.id}`);
  }

  return (
    <div>
      {chunks.map((chunk) => (
        <div key={chunk.id} className="chunk-block" data-chunk-id={chunk.id}>
          <div>{chunk.text}</div>
          {(chunk as any).trace && (chunk as any).trace.length > 0 && (
            <div>
              <button onClick={() => toggleTrace(chunk.id)}>
                {(chunk as any).trace.length} steps
              </button>
              {expandedTrace.has(chunk.id) && (
                <ul>
                  {(chunk as any).trace.map((step: string, i: number) => (
                    <li key={i}>{step}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <div className="chunk-actions">
            <button onClick={() => navigator.clipboard.writeText(chunk.text)}>Copy</button>
            <button onClick={() => handleFork(chunk)}>Fork from here</button>
          </div>
        </div>
      ))}
      <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask..." />
      <button onClick={handleSend}>Send</button>
    </div>
  );
}
