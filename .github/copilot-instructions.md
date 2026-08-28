# Web-Context Graph repository instructions

## Commands

Run backend commands from `backend/`; its modules use flat imports such as `from storage import ThreadStore`.

```bash
# One-time backend setup
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt

# Backend development server
.venv/bin/uvicorn main:app --reload

# Fast backend suite (avoids real Copilot CLI calls)
.venv/bin/pytest -v --ignore=test_smoke_e2e.py --ignore=test_copilot_engine.py

# Full backend suite; requires an installed, authenticated `copilot` CLI
.venv/bin/pytest -v

# One backend file or test
.venv/bin/pytest -v test_chunking.py
.venv/bin/pytest -v test_chunking.py::test_chunks_by_paragraph
```

Run frontend commands from `frontend/`:

```bash
npm install
npm run dev
npm run build
npm run lint
npm test

# One frontend file or named test
npx vitest run src/ThreadView.test.tsx
npx vitest run src/ThreadView.test.tsx -t "renders chunks returned by getThread"
```

The frontend API defaults to `http://localhost:8000`; override it with `VITE_API_BASE`.

## Architecture

- This is a local-first conversation graph: a FastAPI backend owns thread persistence and Copilot CLI invocation, while a React/Vite frontend provides thread, graph, and onboarding views.
- `backend/main.py` is the API composition layer. It coordinates `ThreadStore`, render-time markdown chunking, index rebuilding, Copilot invocation, and git autosaves.
- User data is outside this source repository at `~/web-context-graph-data/` by default. Each thread is `threads/<thread-id>/` with raw conversation text in `thread.md` and structural metadata in `meta.yaml`.
- `meta.yaml` is the source of truth for parent/child relationships and status. `index.md` is a regenerable cache built by scanning metadata; do not treat or edit it as authoritative.
- Chunks are computed from `thread.md` only when serving a thread. Their IDs are deterministic positional addresses (`<thread-id>#c<order>`) used by fork edges; chunking does not rewrite stored markdown.
- Each thread owns a UUID `copilot_session_id`. `copilot_engine.py` invokes the headless CLI with that ID, preserving per-thread Copilot memory. The backend also assembles root-to-current lineage; sibling thread content must never leak into that lineage.
- The graph endpoint derives nodes and edges from thread metadata. The frontend renders those relationships with `reactflow`; selecting a graph node returns to the corresponding thread view.

## Repository-specific invariants

- Preserve the distinction between edits and re-forks: `/edit` changes one thread in place and never cascades, while `/refork` recursively deletes the selected old child branch before creating its replacement. The frontend is responsible for confirmation before calling the destructive re-fork endpoint.
- Every backend mutation must rebuild `index.md` and autocommit the external data vault. Git history is the safety net for autosave and destructive re-fork behavior.
- Creating a fork must update both sides of the relationship: the child records `forked_from`, and the parent records a matching `forked_children` entry. Index rebuilding prunes dangling child references.
- Keep `thread.md` free of YAML frontmatter or duplicated metadata. Message content uses markdown role markers (`**user:**`, `**assistant:**`, and `**system:**`).
- Backend API tests must isolate filesystem state by rebinding both `main.VAULT_ROOT` and the module-level `main.store` to a temporary directory before constructing `TestClient`.
- Tests that call `ask_copilot` are intentionally integration tests: they require the real authenticated CLI and are slow/token-heavy. Do not add real Copilot calls to the fast test path.
- Frontend component tests use Vitest with the jsdom environment configured in `vite.config.ts`; shared Testing Library cleanup and jest-dom matchers live in `src/setupTests.ts`.
- Consult `docs/plans/2026-08-27-web-context-graph-mvp.md` when changing product semantics. Its D-numbered decisions explain non-obvious behavior such as lineage isolation, chunk identity, storage authority, and absolute re-fork deletion.
