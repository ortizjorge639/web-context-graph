import { useEffect, useState } from "react";
import { Onboarding } from "./Onboarding";
import { ThreadView } from "./ThreadView";
import { GraphView } from "./GraphView";
import { createThread } from "./api";
import "./theme.css";

type View = "onboarding" | "thread" | "graph";

const ONBOARDING_SEEN_KEY = "wcg_onboarding_seen";

function App() {
  const [view, setView] = useState<View>(() =>
    localStorage.getItem(ONBOARDING_SEEN_KEY) ? "thread" : "onboarding"
  );
  const [threadId, setThreadId] = useState<string | null>(null);

  useEffect(() => {
    if (view === "thread" && !threadId) {
      createThread("Untitled thread").then((meta) => setThreadId(meta.id));
    }
  }, [view, threadId]);

  function completeOnboarding() {
    localStorage.setItem(ONBOARDING_SEEN_KEY, "1");
    setView("thread");
  }

  function openThread(id: string) {
    setThreadId(id);
    setView("thread");
  }

  return (
    <div style={{ minHeight: "100vh" }}>
      <nav
        style={{
          display: "flex",
          gap: 12,
          padding: "10px 16px",
          background: "var(--charcoal-brown)",
          color: "var(--ghost-white)",
        }}
      >
        <strong style={{ marginRight: 8 }}>Web-Context Graph</strong>
        <button onClick={() => setView("thread")}>Thread View</button>
        <button onClick={() => setView("graph")}>Graph View</button>
        <button onClick={() => setView("onboarding")}>Replay onboarding</button>
      </nav>

      {view === "onboarding" && <Onboarding onComplete={completeOnboarding} />}
      {view === "thread" && threadId && <ThreadView threadId={threadId} />}
      {view === "thread" && !threadId && <p style={{ padding: 16 }}>Creating thread...</p>}
      {view === "graph" && <GraphView onOpenThread={openThread} />}
    </div>
  );
}

export default App;
