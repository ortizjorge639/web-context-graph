import { useState } from "react";
import type { CSSProperties } from "react";
import { ConversationChunk } from "./ConversationChunk";
import { ProductMark } from "./Icons";

const JOURNEY = [
  {
    id: "welcome",
    title: "Welcome",
    heading: "Think in branches.",
    description: "Explore every direction without losing the path that brought you there.",
    preview: "Your conversations, mapped.",
  },
  {
    id: "chunking",
    title: "Chunking",
    heading: "Every idea has an address.",
    description: "Responses become focused blocks you can copy, revisit, or branch from.",
    preview: "Each response becomes a set of replyable ideas.",
  },
  {
    id: "forking",
    title: "Forking",
    heading: "Follow the interesting path.",
    description: "Choose any idea and explore a new direction without losing your place.",
    preview: "A new direction, with the original path intact.",
  },
  {
    id: "backtracking",
    title: "Backtracking",
    heading: "Return without starting over.",
    description: "Move through earlier decisions while every branch stays within reach.",
    preview: "Earlier context remains one click away.",
  },
  {
    id: "graph",
    title: "Graph view",
    heading: "See the shape of your thinking.",
    description: "The entire journey becomes a navigable map and a folder of markdown you own.",
    preview: "A traceable web, stored as local markdown.",
  },
];

function ArrowIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="m7.5 4.5 5.5 5.5-5.5 5.5" />
    </svg>
  );
}

function FolderTransformation() {
  return (
    <div className="tutorial-folder-reveal" aria-label="Tutorial transformed into markdown files">
      <div className="transformation-label">Stored locally</div>
      <div className="transformation-root">
        <span>⌄</span>
        <strong>web-context-graph-data</strong>
      </div>
      <div className="transformation-file">M↓ <span>index.md</span></div>
      <div className="transformation-folder">⌄ <span>threads</span></div>
      {JOURNEY.map((item) => (
        <div className="transformation-thread" key={item.id}>
          <span>⌄</span>
          <strong>{item.title}</strong>
          <small>thread.md · meta.yaml</small>
        </div>
      ))}
    </div>
  );
}

function PageIllustration({ id }: { id: string }) {
  if (id === "welcome") {
    return (
      <div className="tutorial-welcome-mark">
        <div className="welcome-glow" />
        <span><ProductMark /></span>
      </div>
    );
  }

  if (id === "chunking") {
    return (
      <div className="tutorial-chunk-demo">
        <ConversationChunk content="A response becomes a set of focused ideas." role="assistant" compact />
        <ConversationChunk content="Each idea can become its own direction." role="assistant" onBranch={() => undefined} compact />
      </div>
    );
  }

  if (id === "forking") {
    return (
      <div className="tutorial-fork-demo" aria-hidden="true">
        <div className="fork-thought">What if we take a quieter approach?</div>
        <div className="fork-stem" />
        <div className="fork-choice fork-choice-primary">Explore this</div>
        <div className="fork-choice">Keep going</div>
      </div>
    );
  }

  if (id === "backtracking") {
    return (
      <div className="tutorial-backtrack-demo" aria-hidden="true">
        <div className="backtrack-card past">Define the question</div>
        <div className="backtrack-card active">Choose the model</div>
        <div className="backtrack-card current">Refine the details</div>
        <svg viewBox="0 0 120 220">
          <path d="M92 190C18 170 18 70 78 54" />
          <path d="m69 47 12 6-4 13" />
        </svg>
      </div>
    );
  }

  return (
    <div className="tutorial-web-demo" aria-hidden="true">
      <svg viewBox="0 0 320 190">
        <path d="M44 95h72M116 95l72-58M116 95l72 58M188 37h84M188 153h84" />
        <circle cx="44" cy="95" r="17" />
        <circle cx="116" cy="95" r="17" />
        <circle cx="188" cy="37" r="17" />
        <circle cx="188" cy="153" r="17" />
        <circle cx="272" cy="37" r="17" />
        <circle cx="272" cy="153" r="17" className="active" />
      </svg>
    </div>
  );
}

export function Onboarding({
  onComplete,
  finaleDuration = 2600,
  handoffDuration = 520,
}: {
  onComplete: (options: { animated: boolean }) => Promise<void> | void;
  finaleDuration?: number;
  handoffDuration?: number;
}) {
  const [phase, setPhase] = useState(0);
  const [finale, setFinale] = useState(false);
  const [handoff, setHandoff] = useState(false);
  const [isCompleting, setIsCompleting] = useState(false);
  const [error, setError] = useState("");

  async function complete(skipAnimation = false) {
    if (isCompleting) return;
    setIsCompleting(true);
    setError("");
    if (!skipAnimation) {
      setFinale(true);
      await new Promise((resolve) => window.setTimeout(resolve, finaleDuration));
      setHandoff(true);
      await new Promise((resolve) => window.setTimeout(resolve, handoffDuration));
    }
    try {
      await onComplete({ animated: !skipAnimation });
    } catch (completionError) {
      setFinale(false);
      setHandoff(false);
      setIsCompleting(false);
      setError(
        completionError instanceof Error
          ? completionError.message
          : "Could not create the tutorial graph.",
      );
    }
  }

  function next() {
    if (phase === JOURNEY.length - 1) {
      void complete();
    } else {
      setPhase((currentPhase) => currentPhase + 1);
    }
  }

  return (
    <main className={`onboarding-shell journey-shell${finale ? " tutorial-finale" : ""}`}>
      <header className="onboarding-header">
        <div className="product-lockup">
          <span className="product-mark"><ProductMark /></span>
          <span>Lineage App</span>
        </div>
        <button className="skip-button" onClick={() => void complete(true)} disabled={isCompleting}>
          Skip tutorial
        </button>
      </header>

      <section className="journey-content" aria-live="polite">
        <div className="journey-stage">
          <div className="stage-orb stage-orb-one" />
          <div className="stage-orb stage-orb-two" />
          <div className="tutorial-carousel">
            <div
              className="tutorial-page-track"
              style={{ "--tutorial-phase": phase } as CSSProperties}
            >
              {JOURNEY.map((item, index) => (
                <div
                  className="tutorial-page-slot"
                  key={item.id}
                  aria-hidden={index !== phase}
                  inert={index !== phase ? true : undefined}
                >
                  <div className={`tutorial-page-card${index === phase ? " active" : ""}`}>
                    <div className="page-card-copy">
                      <span className="step-kicker">
                        {index === 0 ? "Your conversations, mapped" : `Step ${index} of ${JOURNEY.length - 1}`}
                      </span>
                      <h1>{item.heading}</h1>
                      <p>{item.description}</p>
                    </div>
                    <PageIllustration id={item.id} />
                  </div>
                  {index < JOURNEY.length - 1 && (
                    <div className="tutorial-page-connector" aria-hidden="true">
                      <span />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
          {finale && <FolderTransformation />}
        </div>

        {error && <div className="onboarding-error" role="alert">{error}</div>}
      </section>

      <footer className="onboarding-footer">
        <div className="step-progress" aria-label={`Tutorial position ${phase + 1} of ${JOURNEY.length}`}>
          {JOURNEY.map((item, index) => (
            <button
              key={item.id}
              className={index === phase ? "active" : ""}
              onClick={() => !isCompleting && setPhase(index)}
              aria-label={`Go to ${item.title}`}
              aria-current={index === phase ? "step" : undefined}
            />
          ))}
        </div>
        <button className="next-button journey-next" onClick={next} disabled={isCompleting}>
          <span>
            {isCompleting
              ? "Building your graph..."
              : phase === 0
                ? "Show me how"
                : phase === JOURNEY.length - 1
                  ? "Create my graph"
                  : "Next"}
          </span>
          {!isCompleting && <ArrowIcon />}
        </button>
      </footer>

      {handoff && (
        <div className="tutorial-handoff" role="status" aria-live="polite">
          <span className="handoff-mark"><ProductMark /></span>
          <span>Preparing your workspace</span>
        </div>
      )}
    </main>
  );
}
