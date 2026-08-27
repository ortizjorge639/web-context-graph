# Web-Context Graph

Spider-style branching conversation graph, powered by GitHub Copilot CLI as the reasoning engine. Reply to any chunk of an agent's response and it forks a new thread from that exact point; backtrack freely; the whole traversal persists as a folder-of-markdown graph you own, with an auto-updating index and a visual Graph View.

See `docs/plans/2026-08-27-web-context-graph-mvp.md` for the implementation plan, and the spec it implements (Jorge's Obsidian vault, `Projects/Web-Context-Graph/Web-Context-Graph-Spec.md`).

## Screenshots

Live captures from the running Phase 1 MVP (real backend data, real Copilot CLI responses):

**Onboarding carousel** — Raycast-style, one mechanic per screen, skippable:

![Onboarding](docs/screenshots/01-onboarding.png)

**Graph View** — real threads and a real fork edge, rendered via react-flow. Clicking a node opens that thread:

![Graph View](docs/screenshots/02-graph-view.png)

**Thread View** — chunked agent output (block-level), opened by clicking the corresponding node in Graph View:

![Thread View](docs/screenshots/03-thread-view.png)

## Prerequisites

- Python 3.11+
- Node 18+
- GitHub Copilot CLI installed and authenticated (`copilot --version` should work)

## Run

```bash
# Backend
cd backend
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn main:app --reload

# Frontend (separate terminal)
cd frontend
npm install
npm run dev
```

## Test

```bash
# Backend fast tests (no real Copilot CLI calls)
cd backend && .venv/bin/pytest -v --ignore=test_smoke_e2e.py --ignore=test_copilot_engine.py

# Backend full suite (slower -- hits real Copilot CLI)
cd backend && .venv/bin/pytest -v

# Frontend
cd frontend && npx vitest run
```

## Data location

User graph data lives in `~/web-context-graph-data/` by default — not this repo. That folder is the user's actual content (threads, index.md), auto-committed to its own local git repo after every mutation as a safety net for the app's absolute-delete-on-refork semantics.
