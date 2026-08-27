import { useState } from "react";

const STEPS = [
  { title: "Chunking", desc: "Every agent response breaks into reply-able pieces." },
  { title: "Forking", desc: "Reply to any chunk to start a new thread from that exact point." },
  { title: "Backtracking", desc: "Jump back to any earlier point, anytime, for free." },
  { title: "Graph View", desc: "See your whole traversal as a map, from a distance." },
];

export function Onboarding({ onComplete }: { onComplete: () => void }) {
  const [step, setStep] = useState(0);
  const current = STEPS[step];

  function next() {
    if (step === STEPS.length - 1) onComplete();
    else setStep(step + 1);
  }

  return (
    <div style={{ textAlign: "center", padding: 40 }}>
      <h1>{current.title}</h1>
      <p>{current.desc}</p>
      <button onClick={next}>Next</button>
      <button onClick={onComplete}>Skip</button>
    </div>
  );
}
