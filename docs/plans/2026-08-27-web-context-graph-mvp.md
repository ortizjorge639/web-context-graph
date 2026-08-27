# Web-Context Graph — Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task, dispatching a fresh Copilot-CLI-driven subagent (`delegate_task` with `acp_command="copilot"`) per task where possible, with spec-compliance + code-quality review after each.

**Goal:** Build the Phase 1 (MVP) of Web-Context Graph — a local-first conversation app where agent responses chunk into reply-able blocks, replying forks a new thread, and the whole traversal persists as a folder-of-markdown graph with an auto-updating index and Graph View.

**Architecture:** Python FastAPI backend (thread CRUD, chunking, Copilot CLI subprocess invocation via `-p`/`--session-id`, index/backlink recomputation) + a single React frontend serving both Thread View (mobile-first) and Graph View (desktop-first, via `react-flow`) against the same REST API. Storage is plain files: one folder per thread, `meta.yaml` as sole source of truth, `thread.md` as raw content only.

**Tech Stack:** Python 3.11 + FastAPI + PyYAML (backend), React + TypeScript + Vite + react-flow (frontend), GitHub Copilot CLI as the reasoning engine (confirmed: `-p "<prompt>" --session-id=<uuid> --allow-all-tools --no-remote` for headless multi-turn invocation — see Spike Findings below), local git for autosave/versioning safety net.

---

## Spike findings (resolves Q3, Q5, Q8 from the spec)

Run live in this session before writing this plan, so the architecture above is not a guess:

- **Q3 (Copilot CLI invocation mode) — RESOLVED.** `copilot -p "<prompt>" --session-id=<uuid> --allow-all-tools --no-remote` is genuinely multi-turn: calling it twice with the same UUID session ID lets Copilot recall content from the first call natively (verified live: told it "remember 4471," second call with the same session ID correctly answered "4471"). **No manual lineage re-injection is needed** — Copilot CLI's own session persistence handles it. Session IDs must be valid UUIDs (`uuid.uuid4()`); an arbitrary string like `"my-session"` is rejected.
- **Cost/latency data (new, from the spike, not in the original spec):** ~5 seconds latency even for a trivial prompt; ~22k tokens of baseline overhead per session before any real content, growing to ~70k tokens after just 2 tiny turns. **This directly affects D2's "unbounded lineage by default"** — deep lineage chains will get expensive fast. Flagged as a stronger version of the spec's existing "Unbounded lineage guardrail" NFR; Task 12 below adds a lineage-depth warning as a cheap v1 mitigation (not a hard cap, per the spec's decision that reset/condense is deliberately deferred).
- **Q5 (chunk identity)** — resolved at spec-level already (stable `<thread-id>#c<order>` scheme); this plan implements it directly, no further research needed.
- **Q8 (backend language + graph-viz library)** — resolved for this plan: **Python** (FastAPI) for the backend, chosen for straightforward YAML/markdown handling and because the Copilot CLI subprocess invocation is simple regardless of host language, so pick the language the implementer/reviewer will be fastest in. **react-flow** for Graph View — mature, TypeScript-native, directly supports custom node/edge styling for the palette-driven color semantics.

---

## Before you start

Read these first, in order:
1. `Projects/Web-Context-Graph/Web-Context-Graph-Spec.md` (in Jorge's Obsidian vault) — the full Decision Log (D1-D17) and Open Questions (Q1-Q8) this plan implements. Every task below cites the D#/Q# it satisfies.
2. This file, in full, before starting Task 1.

Working directory for this build: `~/web-context-graph` (fresh git repo, initialized, currently empty except `docs/plans/`).

---

## Phase 1 Task List

### Task 1: Project scaffolding + git init

**Objective:** Set up the repo skeleton so every subsequent task has somewhere to put files.

**Files:**
- Create: `backend/requirements.txt`
- Create: `backend/.gitignore`
- Create: `frontend/package.json` (via `npm create vite@latest` — see Step 2)
- Create: `README.md`

**Step 1: Backend Python setup**

```bash
cd ~/web-context-graph
python3 -m venv backend/.venv
source backend/.venv/bin/activate
pip install fastapi uvicorn pyyaml pytest httpx
pip freeze > backend/requirements.txt
```

**Step 2: Frontend scaffold**

```bash
cd ~/web-context-graph
npm create vite@latest frontend -- --template react-ts
cd frontend
npm install
npm install reactflow
```

**Step 3: .gitignore**

Create `~/web-context-graph/.gitignore`:
```
backend/.venv/
frontend/node_modules/
frontend/dist/
threads/
index.md
*.pyc
__pycache__/
.DS_Store
```

Note: `threads/` and `index.md` are gitignored at the repo root because they're the *user's data*, not the app's source code — the app itself gets committed to this repo, but a user's actual graph data lives in a separate vault-root directory the app points at (configurable, defaults to `~/web-context-graph-data/` — see Task 3).

**Step 4: README stub**

Create `README.md`:
```markdown
# Web-Context Graph

Spider-style branching conversation graph. See `docs/plans/2026-08-27-web-context-graph-mvp.md` for the implementation plan and the Obsidian spec it implements.

## Run

Backend: `cd backend && source .venv/bin/activate && uvicorn main:app --reload`
Frontend: `cd frontend && npm run dev`
```

**Step 5: Commit**

```bash
cd ~/web-context-graph
git add -A
git commit -m "chore: project scaffolding (backend venv, frontend vite+react-flow)"
```

---

### Task 2: Chunk identity data model (resolves D16, D4, Q5)

**Objective:** Implement the chunking logic as a pure function: given raw markdown, split it into stable, ID-addressable chunks.

**Files:**
- Create: `backend/chunking.py`
- Test: `backend/test_chunking.py`

**Step 1: Write failing test**

```python
# backend/test_chunking.py
from chunking import chunk_markdown, Chunk

def test_chunks_by_paragraph():
    text = "First paragraph.\n\nSecond paragraph."
    chunks = chunk_markdown(text, thread_id="t1")
    assert len(chunks) == 2
    assert chunks[0].id == "t1#c0"
    assert chunks[0].kind == "block"
    assert chunks[0].text == "First paragraph."
    assert chunks[1].id == "t1#c1"
    assert chunks[1].text == "Second paragraph."

def test_chunks_header_with_bullets_as_one_block():
    text = "## Options\n- A) do X\n- B) do Y\n- C) do Z"
    chunks = chunk_markdown(text, thread_id="t1")
    assert len(chunks) == 1
    assert chunks[0].kind == "block"
    assert "A) do X" in chunks[0].text

def test_chunk_ids_stable_across_reparse_of_same_text():
    text = "Para one.\n\nPara two."
    c1 = chunk_markdown(text, thread_id="t1")
    c2 = chunk_markdown(text, thread_id="t1")
    assert [c.id for c in c1] == [c.id for c in c2]
```

**Step 2: Run test to verify failure**

Run: `cd backend && source .venv/bin/activate && pytest test_chunking.py -v`
Expected: FAIL — "No module named 'chunking'"

**Step 3: Write minimal implementation**

```python
# backend/chunking.py
"""
Chunking logic per spec D4/D16: block-level split (paragraph, header+bullets,
multi-option lists) is the primary chunk boundary. Chunking is a
RENDERING-TIME concern only (per Feature Breakdown) -- this module never
mutates the stored thread.md, it only computes chunk boundaries + stable IDs
for the display layer and for fork/backlink addressing.
"""
from dataclasses import dataclass
import re


@dataclass
class Chunk:
    id: str          # "<thread_id>#c<order>", stable per D16/Q5
    kind: str        # "block" | "span" (span is user-selected at render time, not computed here)
    order: int
    text: str


def chunk_markdown(text: str, thread_id: str) -> list[Chunk]:
    """
    Split raw markdown into block-level chunks:
    - A header line + all immediately-following bullet/numbered lines forms ONE chunk.
    - Otherwise, split on blank-line-separated paragraphs.
    Order is deterministic (top-to-bottom), so re-chunking identical text yields identical IDs.
    """
    blocks = _split_into_blocks(text)
    return [
        Chunk(id=f"{thread_id}#c{i}", kind="block", order=i, text=block)
        for i, block in enumerate(blocks)
    ]


def _split_into_blocks(text: str) -> list[str]:
    lines = text.split("\n")
    blocks: list[str] = []
    current: list[str] = []

    def flush():
        if current:
            joined = "\n".join(current).strip()
            if joined:
                blocks.append(joined)
            current.clear()

    i = 0
    while i < len(lines):
        line = lines[i]
        is_header = bool(re.match(r"^#{1,6}\s", line))
        if is_header:
            flush()
            current.append(line)
            i += 1
            # absorb any immediately-following bullet/numbered lines into this same block
            while i < len(lines) and (
                re.match(r"^\s*[-*]\s", lines[i]) or re.match(r"^\s*\d+[.)]\s", lines[i])
            ):
                current.append(lines[i])
                i += 1
            flush()
            continue
        if line.strip() == "":
            flush()
            i += 1
            continue
        current.append(line)
        i += 1
    flush()
    return blocks
```

**Step 4: Run test to verify pass**

Run: `pytest test_chunking.py -v`
Expected: 3 passed

**Step 5: Commit**

```bash
git add backend/chunking.py backend/test_chunking.py
git commit -m "feat: block-level chunking with stable chunk IDs (D4, D16, resolves Q5)"
```

---

### Task 3: meta.yaml data model + thread storage (resolves D5, D7, D8, D16, Q7, "File/ID safety" NFR)

**Objective:** Implement the thread persistence layer — folder-per-thread, `meta.yaml` as sole source of truth, safe ID generation.

**Files:**
- Create: `backend/storage.py`
- Test: `backend/test_storage.py`

**Step 1: Write failing test**

```python
# backend/test_storage.py
import tempfile
from pathlib import Path
from storage import ThreadStore, ThreadMeta

def test_create_root_thread_generates_safe_id_and_folder():
    with tempfile.TemporaryDirectory() as tmp:
        store = ThreadStore(vault_root=Path(tmp))
        meta = store.create_thread(title="My First Thread!! ??", forked_from=None)
        assert meta.id  # non-empty
        assert (Path(tmp) / "threads" / meta.id / "thread.md").exists()
        assert (Path(tmp) / "threads" / meta.id / "meta.yaml").exists()
        # title with unsafe chars must not appear literally in the folder name
        assert "!" not in meta.id and "?" not in meta.id

def test_create_forked_thread_records_forked_from_and_registers_in_parent():
    with tempfile.TemporaryDirectory() as tmp:
        store = ThreadStore(vault_root=Path(tmp))
        root = store.create_thread(title="Root", forked_from=None)
        store.append_message(root.id, "user", "Hello")
        store.append_message(root.id, "assistant", "Hi there.\n\nSecond para.")
        child = store.create_thread(
            title="Fork of root",
            forked_from={"thread_id": root.id, "chunk_id": f"{root.id}#c1"},
        )
        assert child.forked_from["thread_id"] == root.id
        parent_meta = store.load_meta(root.id)
        assert {"thread_id": child.id, "chunk_id": f"{root.id}#c1"} in parent_meta.forked_children

def test_two_threads_same_title_get_distinct_ids():
    with tempfile.TemporaryDirectory() as tmp:
        store = ThreadStore(vault_root=Path(tmp))
        a = store.create_thread(title="Same Title", forked_from=None)
        b = store.create_thread(title="Same Title", forked_from=None)
        assert a.id != b.id
```

**Step 2: Run test to verify failure**

Run: `pytest test_storage.py -v`
Expected: FAIL — "No module named 'storage'"

**Step 3: Write minimal implementation**

```python
# backend/storage.py
"""
Thread persistence per spec D5 (one thread = one folder), D7 (edit semantics
live in the API layer, not here), D8 (backlinks via forked_children), D16
(node=thread), and the "File/ID safety" NFR (safe, collision-resistant IDs).

meta.yaml is the SOLE source of truth (resolves Q7) -- thread.md holds ONLY
raw conversation content, no duplicated frontmatter.
"""
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from pathlib import Path
import re
import uuid
import yaml


def _slugify(text: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return slug[:40] or "thread"


def _new_thread_id(title: str) -> str:
    ts = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    return f"{ts}-{_slugify(title)}-{uuid.uuid4().hex[:6]}"


@dataclass
class ThreadMeta:
    id: str
    title: str
    forked_from: dict | None  # {"thread_id": str, "chunk_id": str} or None
    created_at: str
    updated_at: str
    status: str = "active"
    chunks: list = field(default_factory=list)            # [{"id", "kind", "order"}]
    forked_children: list = field(default_factory=list)    # [{"thread_id", "chunk_id"}]


class ThreadStore:
    def __init__(self, vault_root: Path):
        self.vault_root = Path(vault_root)
        self.threads_dir = self.vault_root / "threads"
        self.threads_dir.mkdir(parents=True, exist_ok=True)

    def _thread_dir(self, thread_id: str) -> Path:
        return self.threads_dir / thread_id

    def create_thread(self, title: str, forked_from: dict | None) -> ThreadMeta:
        thread_id = _new_thread_id(title)
        now = datetime.now(timezone.utc).isoformat()
        meta = ThreadMeta(
            id=thread_id, title=title, forked_from=forked_from,
            created_at=now, updated_at=now,
        )
        thread_dir = self._thread_dir(thread_id)
        thread_dir.mkdir(parents=True, exist_ok=False)
        (thread_dir / "thread.md").write_text(f"# {title}\n\n")
        self._write_meta(meta)

        if forked_from:
            parent = self.load_meta(forked_from["thread_id"])
            parent.forked_children.append(
                {"thread_id": thread_id, "chunk_id": forked_from["chunk_id"]}
            )
            self._write_meta(parent)

        return meta

    def load_meta(self, thread_id: str) -> ThreadMeta:
        raw = yaml.safe_load((self._thread_dir(thread_id) / "meta.yaml").read_text())
        return ThreadMeta(**raw)

    def _write_meta(self, meta: ThreadMeta) -> None:
        path = self._thread_dir(meta.id) / "meta.yaml"
        path.write_text(yaml.safe_dump(asdict(meta), sort_keys=False))

    def append_message(self, thread_id: str, role: str, content: str) -> None:
        path = self._thread_dir(thread_id) / "thread.md"
        with path.open("a") as f:
            f.write(f"\n**{role}:** {content}\n")
        meta = self.load_meta(thread_id)
        meta.updated_at = datetime.now(timezone.utc).isoformat()
        self._write_meta(meta)

    def read_content(self, thread_id: str) -> str:
        return (self._thread_dir(thread_id) / "thread.md").read_text()
```

**Step 4: Run test to verify pass**

Run: `pytest test_storage.py -v`
Expected: 3 passed

**Step 5: Commit**

```bash
git add backend/storage.py backend/test_storage.py
git commit -m "feat: folder-per-thread storage, meta.yaml as sole source of truth (D5, D7, D8, D16, resolves Q7)"
```

---

### Task 4: index.md regeneration (resolves D10, "Index/crash consistency" NFR, "Orphan backlinks" NFR)

**Objective:** Implement `index.md` as a fully regenerable cache derived from `threads/*/meta.yaml` — never hand-edited, never authoritative.

**Files:**
- Create: `backend/index_builder.py`
- Test: `backend/test_index_builder.py`

**Step 1: Write failing test**

```python
# backend/test_index_builder.py
import tempfile
from pathlib import Path
from storage import ThreadStore
from index_builder import rebuild_index

def test_rebuild_index_lists_all_active_threads():
    with tempfile.TemporaryDirectory() as tmp:
        store = ThreadStore(vault_root=Path(tmp))
        a = store.create_thread(title="Root Thread", forked_from=None)
        store.create_thread(
            title="Child Thread",
            forked_from={"thread_id": a.id, "chunk_id": f"{a.id}#c0"},
        )
        rebuild_index(Path(tmp))
        index_text = (Path(tmp) / "index.md").read_text()
        assert "Root Thread" in index_text
        assert "Child Thread" in index_text

def test_rebuild_index_prunes_dangling_forked_children():
    with tempfile.TemporaryDirectory() as tmp:
        store = ThreadStore(vault_root=Path(tmp))
        a = store.create_thread(title="Root", forked_from=None)
        b = store.create_thread(
            title="Child", forked_from={"thread_id": a.id, "chunk_id": f"{a.id}#c0"}
        )
        # simulate child being deleted without going through an API that updates the parent
        import shutil
        shutil.rmtree(Path(tmp) / "threads" / b.id)
        rebuild_index(Path(tmp))  # must not crash, must prune the dangling reference
        parent_meta = store.load_meta(a.id)
        assert parent_meta.forked_children == []
```

**Step 2: Run test to verify failure**

Run: `pytest test_index_builder.py -v`
Expected: FAIL — "No module named 'index_builder'"

**Step 3: Write minimal implementation**

```python
# backend/index_builder.py
"""
index.md is a REGENERABLE CACHE, never an independent source of truth
(resolves the "Index/crash consistency" NFR from the spec). It is always
fully derivable by scanning threads/*/meta.yaml. This module also prunes
dangling forked_children references (resolves "Orphan backlinks" NFR).
"""
from pathlib import Path
from storage import ThreadStore


def rebuild_index(vault_root: Path) -> None:
    store = ThreadStore(vault_root=Path(vault_root))
    threads_dir = store.threads_dir
    all_ids = {p.name for p in threads_dir.iterdir() if p.is_dir()} if threads_dir.exists() else set()

    metas = [store.load_meta(tid) for tid in sorted(all_ids)]

    # Prune dangling forked_children (child thread no longer exists on disk)
    for meta in metas:
        pruned = [fc for fc in meta.forked_children if fc["thread_id"] in all_ids]
        if pruned != meta.forked_children:
            meta.forked_children = pruned
            store._write_meta(meta)

    lines = ["# Web-Context Graph Index", "", "> Auto-regenerated. Do not hand-edit.", ""]
    for meta in metas:
        parent_note = f" (forked from `{meta.forked_from['thread_id']}`)" if meta.forked_from else " (root)"
        lines.append(f"- `{meta.id}` — {meta.title}{parent_note} — status: {meta.status}")

    (Path(vault_root) / "index.md").write_text("\n".join(lines) + "\n")
```

**Step 4: Run test to verify pass**

Run: `pytest test_index_builder.py -v`
Expected: 2 passed

**Step 5: Commit**

```bash
git add backend/index_builder.py backend/test_index_builder.py
git commit -m "feat: regenerable index.md with dangling-backlink pruning (D10, resolves NFR gaps)"
```

---

### Task 5: Copilot CLI invocation wrapper (resolves D11, Q3 — using confirmed spike findings)

**Objective:** Wrap the confirmed `copilot -p ... --session-id=<uuid> --allow-all-tools --no-remote` invocation as a Python function, with a per-thread session ID stored in meta.yaml so each thread maps 1:1 to a Copilot CLI session.

**Files:**
- Modify: `backend/storage.py` (add `copilot_session_id` field to `ThreadMeta`)
- Create: `backend/copilot_engine.py`
- Test: `backend/test_copilot_engine.py`

**Step 1: Add session ID field to ThreadMeta**

In `backend/storage.py`, modify the `ThreadMeta` dataclass:

```python
@dataclass
class ThreadMeta:
    id: str
    title: str
    forked_from: dict | None
    created_at: str
    updated_at: str
    status: str = "active"
    chunks: list = field(default_factory=list)
    forked_children: list = field(default_factory=list)
    copilot_session_id: str = field(default_factory=lambda: str(uuid.uuid4()))  # 1:1 with Copilot CLI session
```

**Step 2: Write failing test (uses a real subprocess call — this is an integration test, kept minimal/fast)**

```python
# backend/test_copilot_engine.py
import uuid
from copilot_engine import ask_copilot

def test_ask_copilot_returns_nonempty_text():
    session_id = str(uuid.uuid4())
    reply = ask_copilot(session_id, "Reply with exactly the word PONG and nothing else.")
    assert "PONG" in reply.upper()
```

**Step 3: Run test to verify failure**

Run: `pytest test_copilot_engine.py -v`
Expected: FAIL — "No module named 'copilot_engine'"

**Step 4: Write minimal implementation**

```python
# backend/copilot_engine.py
"""
Wraps the CONFIRMED (via live spike, see plan header) headless invocation:
    copilot -p "<prompt>" --session-id=<uuid> --allow-all-tools --no-remote
Session IDs are per-thread (stored in ThreadMeta.copilot_session_id), so
calling this repeatedly with the same thread's session_id gives Copilot CLI
native multi-turn memory of that thread's lineage -- no manual context
re-injection needed (resolves D11/Q3).

NOTE (from spike): ~5s latency and ~20k+ token overhead per call even for
trivial prompts -- do not call this in a tight loop or in test suites beyond
a small number of smoke tests.
"""
import subprocess


def ask_copilot(session_id: str, prompt: str, timeout: int = 60) -> str:
    result = subprocess.run(
        [
            "copilot", "-p", prompt,
            "--session-id", session_id,
            "--allow-all-tools",
            "--no-remote",
        ],
        capture_output=True, text=True, timeout=timeout,
    )
    if result.returncode != 0:
        raise RuntimeError(f"copilot CLI failed: {result.stderr}")
    return result.stdout.strip()
```

**Step 5: Run test to verify pass**

Run: `pytest test_copilot_engine.py -v -s`
Expected: 1 passed (takes ~5-10s — this is a real subprocess call, not mocked, per the plan's TDD principle of testing real behavior for the riskiest integration point)

**Step 6: Commit**

```bash
git add backend/storage.py backend/copilot_engine.py backend/test_copilot_engine.py
git commit -m "feat: Copilot CLI invocation wrapper with per-thread session IDs (D11, resolves Q3)"
```

---

### Task 6: FastAPI backend — thread CRUD + fork endpoint (resolves D1, D2, D3)

**Objective:** Expose thread creation, message sending, and forking as a REST API the frontend can call.

**Files:**
- Create: `backend/main.py`
- Test: `backend/test_api.py`

**Step 1: Write failing test**

```python
# backend/test_api.py
import tempfile
from pathlib import Path
from fastapi.testclient import TestClient

def make_client(tmp_path):
    import main
    main.VAULT_ROOT = Path(tmp_path)
    main.store = main.ThreadStore(vault_root=main.VAULT_ROOT)
    return TestClient(main.app)

def test_create_root_thread():
    with tempfile.TemporaryDirectory() as tmp:
        client = make_client(tmp)
        resp = client.post("/threads", json={"title": "Test Thread"})
        assert resp.status_code == 200
        assert resp.json()["forked_from"] is None

def test_fork_thread_carries_full_lineage():
    with tempfile.TemporaryDirectory() as tmp:
        client = make_client(tmp)
        root = client.post("/threads", json={"title": "Root"}).json()
        client.post(f"/threads/{root['id']}/messages", json={"role": "user", "content": "Hi"})
        chunk_id = f"{root['id']}#c0"
        fork_resp = client.post(
            f"/threads/{root['id']}/fork",
            json={"chunk_id": chunk_id, "title": "Forked thread"},
        )
        assert fork_resp.status_code == 200
        child = fork_resp.json()
        assert child["forked_from"]["thread_id"] == root["id"]
        # D2: full lineage carried into the new thread's content
        detail = client.get(f"/threads/{child['id']}").json()
        assert "Root" in detail["content"] or "Hi" in detail["content"]
```

**Step 2: Run test to verify failure**

Run: `pytest test_api.py -v`
Expected: FAIL — "No module named 'main'"

**Step 3: Write minimal implementation**

```python
# backend/main.py
"""
FastAPI backend. D1 (chunk-reply forks a thread), D2 (full lineage carried
into new thread), D3 (no sibling context sharing -- each thread only ever
sees ITS OWN lineage chain, never a sibling's).
"""
from pathlib import Path
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from storage import ThreadStore
from chunking import chunk_markdown
from index_builder import rebuild_index
from copilot_engine import ask_copilot

VAULT_ROOT = Path.home() / "web-context-graph-data"
store = ThreadStore(vault_root=VAULT_ROOT)

app = FastAPI()


class CreateThreadRequest(BaseModel):
    title: str


class MessageRequest(BaseModel):
    role: str
    content: str


class ForkRequest(BaseModel):
    chunk_id: str
    title: str


def _build_lineage_content(thread_id: str) -> str:
    """D2: full lineage, root -> fork point, unbounded by default in v1."""
    meta = store.load_meta(thread_id)
    if not meta.forked_from:
        return store.read_content(thread_id)
    parent_content = _build_lineage_content(meta.forked_from["thread_id"])
    return parent_content + "\n\n---\n\n" + store.read_content(thread_id)


@app.post("/threads")
def create_thread(req: CreateThreadRequest):
    meta = store.create_thread(title=req.title, forked_from=None)
    rebuild_index(VAULT_ROOT)
    return meta.__dict__


@app.get("/threads/{thread_id}")
def get_thread(thread_id: str):
    try:
        meta = store.load_meta(thread_id)
    except FileNotFoundError:
        raise HTTPException(404, "Thread not found")
    content = store.read_content(thread_id)
    chunks = chunk_markdown(content, thread_id=thread_id)
    return {**meta.__dict__, "content": content, "chunks": [c.__dict__ for c in chunks]}


@app.post("/threads/{thread_id}/messages")
def send_message(thread_id: str, req: MessageRequest):
    store.append_message(thread_id, req.role, req.content)
    if req.role == "user":
        meta = store.load_meta(thread_id)
        lineage = _build_lineage_content(thread_id)
        reply = ask_copilot(meta.copilot_session_id, lineage + f"\n\n**user:** {req.content}")
        store.append_message(thread_id, "assistant", reply)
    rebuild_index(VAULT_ROOT)
    return {"ok": True}


@app.post("/threads/{thread_id}/fork")
def fork_thread(thread_id: str, req: ForkRequest):
    """D1: reply to a chunk forks a new thread. D2: seeded with full lineage."""
    try:
        store.load_meta(thread_id)
    except FileNotFoundError:
        raise HTTPException(404, "Parent thread not found")
    child = store.create_thread(
        title=req.title,
        forked_from={"thread_id": thread_id, "chunk_id": req.chunk_id},
    )
    lineage = _build_lineage_content(thread_id)
    store.append_message(child.id, "system", f"[Forked from chunk {req.chunk_id}]\n\n{lineage}")
    rebuild_index(VAULT_ROOT)
    return store.load_meta(child.id).__dict__
```

**Step 4: Run test to verify pass**

Run: `cd backend && pip install fastapi[all] && pytest test_api.py -v`
Expected: 2 passed

**Step 5: Commit**

```bash
git add backend/main.py backend/test_api.py
git commit -m "feat: FastAPI thread CRUD + fork endpoint with lineage seeding (D1, D2, D3)"
```

---

### Task 7: Edit-in-place vs. re-fork semantics (resolves D7, Q6-now-resolved)

**Objective:** Implement the two distinct edit behaviors the spec settled on: a plain in-place edit never cascades; a re-fork (replacing what a message forked into) deletes the old downstream branch absolutely.

**Files:**
- Modify: `backend/main.py`
- Modify: `backend/storage.py` (add `delete_thread_recursive`)
- Test: `backend/test_edit_semantics.py`

**Step 1: Write failing test**

```python
# backend/test_edit_semantics.py
import tempfile
from pathlib import Path
from fastapi.testclient import TestClient

def make_client(tmp_path):
    import main
    main.VAULT_ROOT = Path(tmp_path)
    main.store = main.ThreadStore(vault_root=main.VAULT_ROOT)
    return TestClient(main.app)

def test_in_place_edit_does_not_delete_forked_child():
    with tempfile.TemporaryDirectory() as tmp:
        client = make_client(tmp)
        root = client.post("/threads", json={"title": "Root"}).json()
        client.post(f"/threads/{root['id']}/messages", json={"role": "user", "content": "Hi"})
        chunk_id = f"{root['id']}#c0"
        child = client.post(
            f"/threads/{root['id']}/fork",
            json={"chunk_id": chunk_id, "title": "Child"},
        ).json()

        edit_resp = client.post(f"/threads/{root['id']}/edit", json={"new_content": "Hi (tightened)"})
        assert edit_resp.status_code == 200
        assert edit_resp.json()["cascaded"] is False

        # child must still exist and be unaffected
        still_there = client.get(f"/threads/{child['id']}")
        assert still_there.status_code == 200

def test_refork_deletes_old_downstream_branch_absolutely():
    with tempfile.TemporaryDirectory() as tmp:
        client = make_client(tmp)
        root = client.post("/threads", json={"title": "Root"}).json()
        client.post(f"/threads/{root['id']}/messages", json={"role": "user", "content": "Hi"})
        chunk_id = f"{root['id']}#c0"
        old_child = client.post(
            f"/threads/{root['id']}/fork",
            json={"chunk_id": chunk_id, "title": "Old branch"},
        ).json()

        refork_resp = client.post(
            f"/threads/{root['id']}/refork",
            json={"old_child_thread_id": old_child["id"], "chunk_id": chunk_id, "new_title": "New branch"},
        )
        assert refork_resp.status_code == 200
        assert refork_resp.json()["cascaded"] is True

        # old branch must be GONE (absolute deletion, D7)
        deleted = client.get(f"/threads/{old_child['id']}")
        assert deleted.status_code == 404
```

**Step 2: Run test to verify failure**

Run: `pytest test_edit_semantics.py -v`
Expected: FAIL — 404 on `/threads/{id}/edit` (route doesn't exist)

**Step 3: Add `delete_thread_recursive` to storage.py**

```python
# Add to backend/storage.py, inside ThreadStore

    def delete_thread_recursive(self, thread_id: str) -> list[str]:
        """
        Absolute deletion (D7): deletes this thread and every thread that
        (transitively) forked from it. Returns the list of deleted thread IDs.
        """
        meta = self.load_meta(thread_id)
        deleted = [thread_id]
        for fc in list(meta.forked_children):
            deleted.extend(self.delete_thread_recursive(fc["thread_id"]))
        import shutil
        shutil.rmtree(self._thread_dir(thread_id))
        return deleted
```

**Step 4: Add edit/refork endpoints to main.py**

```python
# Add to backend/main.py

class EditRequest(BaseModel):
    new_content: str


class ReforkRequest(BaseModel):
    old_child_thread_id: str
    chunk_id: str
    new_title: str


@app.post("/threads/{thread_id}/edit")
def edit_in_place(thread_id: str, req: EditRequest):
    """
    D7: a plain in-place edit is NOT a re-fork. It never cascades and never
    affects any thread that forked from this one -- resolved 2026-08-27.
    """
    path = store._thread_dir(thread_id) / "thread.md"
    path.write_text(req.new_content)
    meta = store.load_meta(thread_id)
    from datetime import datetime, timezone
    meta.updated_at = datetime.now(timezone.utc).isoformat()
    store._write_meta(meta)
    rebuild_index(VAULT_ROOT)
    return {"ok": True, "cascaded": False}


@app.post("/threads/{thread_id}/refork")
def refork(thread_id: str, req: ReforkRequest):
    """
    D7: this IS the "conversation stems off into a new branch" case --
    absolute, unconditional deletion of the OLD downstream branch, per the
    user's own words ("C is deleted, done. Absolute."). The confirm-before-delete
    UX lives in the frontend only (spec-author addition, not user-specified) --
    this endpoint itself performs the deletion unconditionally once called.
    """
    deleted_ids = store.delete_thread_recursive(req.old_child_thread_id)
    child = store.create_thread(
        title=req.new_title,
        forked_from={"thread_id": thread_id, "chunk_id": req.chunk_id},
    )
    rebuild_index(VAULT_ROOT)
    return {"ok": True, "cascaded": True, "deleted_thread_ids": deleted_ids, "new_thread": child.__dict__}
```

**Step 5: Run test to verify pass**

Run: `pytest test_edit_semantics.py -v`
Expected: 2 passed

**Step 6: Commit**

```bash
git add backend/storage.py backend/main.py backend/test_edit_semantics.py
git commit -m "feat: edit-in-place vs re-fork semantics -- in-place never cascades (D7, resolves former Q6)"
```

---

### Task 8: Git auto-commit safety net (resolves "Autosave + irreversible delete interaction" NFR)

**Objective:** Auto-commit the vault-data directory to its own local git repo after every mutating operation, so the spec's "manual git concern" escape hatch for D7 is actually real.

**Files:**
- Create: `backend/autocommit.py`
- Modify: `backend/main.py` (call it after every mutating endpoint)
- Test: `backend/test_autocommit.py`

**Step 1: Write failing test**

```python
# backend/test_autocommit.py
import tempfile
import subprocess
from pathlib import Path
from autocommit import ensure_git_repo, autocommit

def test_ensure_git_repo_initializes_once():
    with tempfile.TemporaryDirectory() as tmp:
        ensure_git_repo(Path(tmp))
        assert (Path(tmp) / ".git").exists()
        ensure_git_repo(Path(tmp))  # calling twice must not error
        assert (Path(tmp) / ".git").exists()

def test_autocommit_creates_a_commit():
    with tempfile.TemporaryDirectory() as tmp:
        vault = Path(tmp)
        ensure_git_repo(vault)
        (vault / "test.txt").write_text("hello")
        autocommit(vault, message="test commit")
        log = subprocess.run(
            ["git", "-C", str(vault), "log", "--oneline"], capture_output=True, text=True
        ).stdout
        assert "test commit" in log
```

**Step 2: Run test to verify failure**

Run: `pytest test_autocommit.py -v`
Expected: FAIL — "No module named 'autocommit'"

**Step 3: Write minimal implementation**

```python
# backend/autocommit.py
"""
Resolves the spec's 'Autosave + irreversible delete interaction' NFR:
D6 (autosave every turn) + D7 (edit deletes downstream, no undo except
manual git) means the "manual git" escape hatch is only real if the
implementation actually commits every turn. This module does that.
"""
import subprocess
from pathlib import Path


def ensure_git_repo(vault_root: Path) -> None:
    if not (vault_root / ".git").exists():
        subprocess.run(["git", "init"], cwd=vault_root, capture_output=True, check=True)
        subprocess.run(["git", "config", "user.email", "wcg@localhost"], cwd=vault_root, capture_output=True)
        subprocess.run(["git", "config", "user.name", "Web Context Graph"], cwd=vault_root, capture_output=True)


def autocommit(vault_root: Path, message: str) -> None:
    subprocess.run(["git", "add", "-A"], cwd=vault_root, capture_output=True)
    subprocess.run(
        ["git", "commit", "-m", message, "--allow-empty-message", "--quiet"],
        cwd=vault_root, capture_output=True,
    )
```

**Step 4: Run test to verify pass**

Run: `pytest test_autocommit.py -v`
Expected: 2 passed

**Step 5: Wire into main.py — add near the top and call after each mutating endpoint**

```python
# Add to backend/main.py, after VAULT_ROOT is defined:
from autocommit import ensure_git_repo, autocommit
ensure_git_repo(VAULT_ROOT)

# Then add `autocommit(VAULT_ROOT, message="...")` as the last line inside
# create_thread, send_message, fork_thread, edit_in_place, and refork --
# e.g. in send_message, right before the `return`:
#     autocommit(VAULT_ROOT, message=f"message in {thread_id}")
```

**Step 6: Commit**

```bash
git add backend/autocommit.py backend/test_autocommit.py backend/main.py
git commit -m "feat: git auto-commit after every mutation -- makes the D7 manual-git escape hatch real"
```

---

### Task 9: React frontend — Thread View (resolves D13, D14, D15, D4-fallback, D17-partial)

**Objective:** Build the mobile-first chat-like Thread View: renders chunked messages, hover/long-press actions, collapsible tool-call trace.

**Files:**
- Create: `frontend/src/ThreadView.tsx`
- Create: `frontend/src/api.ts`
- Create: `frontend/src/theme.css`
- Test: `frontend/src/ThreadView.test.tsx`

**Step 1: Palette as CSS variables (D12)**

Create `frontend/src/theme.css`:

```css
:root {
  --charcoal-brown: #1f271b;
  --ghost-white: #f7f7ff;
  --burgundy: #7b0d1e;
  --vibrant-coral: #fe5f55;
  --willow-green: #bcd979;
}

body {
  background: var(--ghost-white);
  color: #1a1a1a;
  font-family: -apple-system, sans-serif;
}

.chunk-block {
  padding: 12px 16px;
  border-radius: 10px;
  margin: 8px 0;
  position: relative;
}

.chunk-actions {
  display: none;
  position: absolute;
  top: 4px;
  right: 4px;
  gap: 4px;
}

.chunk-block:hover .chunk-actions {
  display: flex;
}
```

**Step 2: API client**

Create `frontend/src/api.ts`:

```typescript
const BASE = "http://localhost:8000";

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
```

**Step 3: ThreadView component**

Create `frontend/src/ThreadView.tsx`:

```tsx
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
    // D1/D2: caller navigates to the new thread with full lineage already seeded
    alert(`Forked into new thread: ${child.id}`);
  }

  return (
    <div>
      {chunks.map((chunk) => (
        <div key={chunk.id} className="chunk-block" data-chunk-id={chunk.id}>
          <div>{chunk.text}</div>
          {/* D15: hover-reveal actions -- copy, fork-from-here, edit */}
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
```

**Step 4: Component test**

Create `frontend/src/ThreadView.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { vi, test, expect } from "vitest";
import { ThreadView } from "./ThreadView";
import * as api from "./api";

test("renders chunks returned by getThread", async () => {
  vi.spyOn(api, "getThread").mockResolvedValue({
    chunks: [{ id: "t1#c0", kind: "block", order: 0, text: "Hello world" }],
  } as any);
  render(<ThreadView threadId="t1" />);
  expect(await screen.findByText("Hello world")).toBeInTheDocument();
});
```

**Step 5: Install test deps + run**

```bash
cd frontend
npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom
```

Add to `frontend/vite.config.ts`:
```typescript
/// <reference types="vitest" />
export default {
  test: { environment: "jsdom" },
};
```

Run: `npx vitest run`
Expected: 1 passed

**Step 6: Commit**

```bash
git add frontend/src/ThreadView.tsx frontend/src/api.ts frontend/src/theme.css frontend/src/ThreadView.test.tsx frontend/vite.config.ts
git commit -m "feat: Thread View with hover-reveal actions, palette applied (D12, D13, D15)"
```

---

### Task 10: React frontend — Graph View (resolves D8, D13, D16, Graph View color-mapping proposal)

**Objective:** Build the desktop-first Graph View using react-flow, rendering `index.md`/`meta.yaml` fork relationships as nodes/edges.

**Files:**
- Create: `frontend/src/GraphView.tsx`
- Modify: `backend/main.py` (add a `/graph` endpoint returning nodes+edges directly)
- Test: `backend/test_graph_endpoint.py`

**Step 1: Write failing backend test first (graph endpoint)**

```python
# backend/test_graph_endpoint.py
import tempfile
from pathlib import Path
from fastapi.testclient import TestClient

def make_client(tmp_path):
    import main
    main.VAULT_ROOT = Path(tmp_path)
    main.store = main.ThreadStore(vault_root=main.VAULT_ROOT)
    return TestClient(main.app)

def test_graph_endpoint_returns_nodes_and_edges():
    with tempfile.TemporaryDirectory() as tmp:
        client = make_client(tmp)
        root = client.post("/threads", json={"title": "Root"}).json()
        client.post(f"/threads/{root['id']}/messages", json={"role": "user", "content": "Hi"})
        child = client.post(
            f"/threads/{root['id']}/fork",
            json={"chunk_id": f"{root['id']}#c0", "title": "Child"},
        ).json()

        resp = client.get("/graph")
        data = resp.json()
        node_ids = {n["id"] for n in data["nodes"]}
        assert root["id"] in node_ids and child["id"] in node_ids
        assert any(e["source"] == root["id"] and e["target"] == child["id"] for e in data["edges"])
```

**Step 2: Run test to verify failure**

Run: `pytest test_graph_endpoint.py -v`
Expected: FAIL — 404 (route doesn't exist)

**Step 3: Add `/graph` endpoint to main.py**

```python
# Add to backend/main.py

@app.get("/graph")
def get_graph():
    """D8: backlinks are structural (fork relationships), never AI-synthesized."""
    threads_dir = store.threads_dir
    ids = [p.name for p in threads_dir.iterdir() if p.is_dir()] if threads_dir.exists() else []
    nodes, edges = [], []
    for tid in ids:
        meta = store.load_meta(tid)
        nodes.append({"id": meta.id, "label": meta.title, "status": meta.status})
        if meta.forked_from:
            edges.append({
                "source": meta.forked_from["thread_id"],
                "target": meta.id,
                "chunk_id": meta.forked_from["chunk_id"],
            })
    return {"nodes": nodes, "edges": edges}
```

**Step 4: Run test to verify pass**

Run: `pytest test_graph_endpoint.py -v`
Expected: 1 passed

**Step 5: Frontend GraphView component**

Create `frontend/src/GraphView.tsx`:

```tsx
import { useEffect, useState } from "react";
import ReactFlow, { Background, Node, Edge } from "reactflow";
import "reactflow/dist/style.css";

const BASE = "http://localhost:8000";

// Graph View color semantics: AGENT PROPOSAL per spec, not user-confirmed --
// approve/adjust before treating as final. Coral = active path, willow-green
// = rest of tree, charcoal-brown = canvas background.
const COLORS = {
  active: "#fe5f55",
  normal: "#bcd979",
  background: "#1f271b",
  text: "#f7f7ff",
};

export function GraphView() {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);

  useEffect(() => {
    fetch(`${BASE}/graph`).then((r) => r.json()).then((data) => {
      setNodes(
        data.nodes.map((n: any, i: number) => ({
          id: n.id,
          data: { label: n.label },
          position: { x: (i % 5) * 200, y: Math.floor(i / 5) * 120 },
          style: { background: COLORS.normal, color: "#1a1a1a", borderRadius: 8 },
        }))
      );
      setEdges(
        data.edges.map((e: any) => ({
          id: `${e.source}-${e.target}`,
          source: e.source,
          target: e.target,
          label: e.chunk_id,
        }))
      );
    });
  }, []);

  return (
    <div style={{ height: "100vh", background: COLORS.background }}>
      <ReactFlow nodes={nodes} edges={edges} fitView>
        <Background color={COLORS.text} gap={16} />
      </ReactFlow>
    </div>
  );
}
```

**Step 6: Commit**

```bash
git add backend/main.py backend/test_graph_endpoint.py frontend/src/GraphView.tsx
git commit -m "feat: Graph View via react-flow, /graph endpoint (D8, D13, D16, color proposal per spec)"
```

---

### Task 11: Collapsible reasoning trace (resolves D14)

**Objective:** Render tool-call/reasoning steps as a collapsed-by-default "N steps" summary in Thread View.

**Files:**
- Modify: `frontend/src/ThreadView.tsx`
- Test: extend `frontend/src/ThreadView.test.tsx`

**Step 1: Write failing test**

```tsx
// Add to frontend/src/ThreadView.test.tsx
test("reasoning trace is collapsed by default and expands on click", async () => {
  vi.spyOn(api, "getThread").mockResolvedValue({
    chunks: [
      { id: "t1#c0", kind: "block", order: 0, text: "Hello", trace: ["step one", "step two"] },
    ],
  } as any);
  render(<ThreadView threadId="t1" />);
  expect(screen.getByText("2 steps")).toBeInTheDocument();
  expect(screen.queryByText("step one")).not.toBeInTheDocument();
  screen.getByText("2 steps").click();
  expect(await screen.findByText("step one")).toBeInTheDocument();
});
```

**Step 2: Run test to verify failure**

Run: `npx vitest run`
Expected: FAIL — "2 steps" not found

**Step 3: Add collapsible trace to ThreadView.tsx**

```tsx
// Modify frontend/src/ThreadView.tsx -- add inside the chunk map, and add state

// Add near the top of the component:
const [expandedTrace, setExpandedTrace] = useState<Set<string>>(new Set());

function toggleTrace(chunkId: string) {
  setExpandedTrace((prev) => {
    const next = new Set(prev);
    next.has(chunkId) ? next.delete(chunkId) : next.add(chunkId);
    return next;
  });
}

// Inside the chunks.map(...) render, after the chunk text div:
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
```

**Step 4: Run test to verify pass**

Run: `npx vitest run`
Expected: 2 passed

**Step 5: Commit**

```bash
git add frontend/src/ThreadView.tsx frontend/src/ThreadView.test.tsx
git commit -m "feat: collapsible N-steps reasoning trace, collapsed by default (D14)"
```

---

### Task 12: Onboarding carousel (resolves D17)

**Objective:** Build the Raycast-style multi-step onboarding: one mechanic per screen, skippable, "Next"-driven.

**Files:**
- Create: `frontend/src/Onboarding.tsx`
- Test: `frontend/src/Onboarding.test.tsx`

**Step 1: Write failing test**

```tsx
// frontend/src/Onboarding.test.tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { test, expect, vi } from "vitest";
import { Onboarding } from "./Onboarding";

test("steps through all 4 screens and calls onComplete", () => {
  const onComplete = vi.fn();
  render(<Onboarding onComplete={onComplete} />);
  expect(screen.getByText(/chunking/i)).toBeInTheDocument();
  fireEvent.click(screen.getByText("Next"));
  expect(screen.getByText(/forking/i)).toBeInTheDocument();
  fireEvent.click(screen.getByText("Next"));
  expect(screen.getByText(/backtracking/i)).toBeInTheDocument();
  fireEvent.click(screen.getByText("Next"));
  expect(screen.getByText(/graph view/i)).toBeInTheDocument();
  fireEvent.click(screen.getByText("Next"));
  expect(onComplete).toHaveBeenCalled();
});

test("skip calls onComplete immediately", () => {
  const onComplete = vi.fn();
  render(<Onboarding onComplete={onComplete} />);
  fireEvent.click(screen.getByText("Skip"));
  expect(onComplete).toHaveBeenCalled();
});
```

**Step 2: Run test to verify failure**

Run: `npx vitest run`
Expected: FAIL — "No module named './Onboarding'" equivalent (import error)

**Step 3: Write minimal implementation**

```tsx
// frontend/src/Onboarding.tsx
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
```

**Step 4: Run test to verify pass**

Run: `npx vitest run`
Expected: 2 passed (plus the prior 2 from Task 9/11 — 4 total)

**Step 5: Commit**

```bash
git add frontend/src/Onboarding.tsx frontend/src/Onboarding.test.tsx
git commit -m "feat: Raycast-style onboarding carousel, skippable (D17)"
```

---

### Task 13: Lineage-depth guardrail warning (new — from spike token-cost findings)

**Objective:** Since the spike confirmed real token-cost growth (~22k baseline, ~70k after 2 turns), add a cheap, non-blocking warning in the UI when a thread's lineage chain gets deep — mitigates D2's "no ceiling yet" NFR without violating the spec's decision that reset/condense stays out of v1.

**Files:**
- Modify: `backend/main.py` (add `lineage_depth` to the thread detail response)
- Modify: `frontend/src/ThreadView.tsx` (show a subtle warning banner past a threshold)
- Test: extend `backend/test_api.py`

**Step 1: Write failing test**

```python
# Add to backend/test_api.py
def test_lineage_depth_reported_in_thread_detail():
    with tempfile.TemporaryDirectory() as tmp:
        client = make_client(tmp)
        root = client.post("/threads", json={"title": "Root"}).json()
        detail = client.get(f"/threads/{root['id']}").json()
        assert detail["lineage_depth"] == 0  # root has no ancestors

        client.post(f"/threads/{root['id']}/messages", json={"role": "user", "content": "Hi"})
        child = client.post(
            f"/threads/{root['id']}/fork",
            json={"chunk_id": f"{root['id']}#c0", "title": "Child"},
        ).json()
        child_detail = client.get(f"/threads/{child['id']}").json()
        assert child_detail["lineage_depth"] == 1
```

**Step 2: Run test to verify failure**

Run: `pytest test_api.py -v`
Expected: FAIL — KeyError 'lineage_depth'

**Step 3: Add lineage_depth computation to main.py**

```python
# Add to backend/main.py

def _lineage_depth(thread_id: str) -> int:
    meta = store.load_meta(thread_id)
    if not meta.forked_from:
        return 0
    return 1 + _lineage_depth(meta.forked_from["thread_id"])

# Modify get_thread to include it:
@app.get("/threads/{thread_id}")
def get_thread(thread_id: str):
    try:
        meta = store.load_meta(thread_id)
    except FileNotFoundError:
        raise HTTPException(404, "Thread not found")
    content = store.read_content(thread_id)
    chunks = chunk_markdown(content, thread_id=thread_id)
    return {
        **meta.__dict__,
        "content": content,
        "chunks": [c.__dict__ for c in chunks],
        "lineage_depth": _lineage_depth(thread_id),
    }
```

**Step 4: Run test to verify pass**

Run: `pytest test_api.py -v`
Expected: passes (3 total in this file now)

**Step 5: Add warning banner to ThreadView.tsx**

```tsx
// Modify frontend/src/ThreadView.tsx -- add near the top of the returned JSX,
// after fetching thread detail (requires storing lineage_depth in state)

// Add state: const [lineageDepth, setLineageDepth] = useState(0);
// In refresh(): setLineageDepth(data.lineage_depth);

{lineageDepth >= 5 && (
  <div style={{ background: "#7b0d1e", color: "#f7f7ff", padding: 8, borderRadius: 6 }}>
    This thread carries {lineageDepth} forks of lineage as context — cost/latency grows with depth.
    Condensing is not built yet (Phase 2), but this is a heads-up.
  </div>
)}
```

**Step 6: Commit**

```bash
git add backend/main.py backend/test_api.py frontend/src/ThreadView.tsx
git commit -m "feat: lineage-depth warning banner -- cheap v1 mitigation for D2's unbounded-lineage NFR (from spike token-cost findings)"
```

---

### Task 14: End-to-end smoke test + docs

**Objective:** One real, full-stack smoke test proving the whole loop works: create thread → send message (real Copilot CLI call) → fork → edit-in-place → graph endpoint.

**Files:**
- Create: `backend/test_smoke_e2e.py`
- Modify: `README.md`

**Step 1: Write the smoke test**

```python
# backend/test_smoke_e2e.py
"""
Full-stack smoke test. Uses the REAL Copilot CLI (not mocked) -- slow
(~10-20s) by design, per the plan's finding that this integration point is
the riskiest part of the system. Run this one deliberately, not in a fast
inner test loop.
"""
import tempfile
from pathlib import Path
from fastapi.testclient import TestClient

def test_full_loop_create_message_fork_edit_graph():
    with tempfile.TemporaryDirectory() as tmp:
        import main
        main.VAULT_ROOT = Path(tmp)
        main.store = main.ThreadStore(vault_root=main.VAULT_ROOT)
        client = TestClient(main.app)

        root = client.post("/threads", json={"title": "Smoke test root"}).json()
        msg_resp = client.post(
            f"/threads/{root['id']}/messages",
            json={"role": "user", "content": "Say hello in one short sentence."},
        )
        assert msg_resp.status_code == 200

        detail = client.get(f"/threads/{root['id']}").json()
        assert len(detail["chunks"]) > 0

        child = client.post(
            f"/threads/{root['id']}/fork",
            json={"chunk_id": detail["chunks"][0]["id"], "title": "Forked"},
        ).json()
        assert child["forked_from"]["thread_id"] == root["id"]

        edit_resp = client.post(
            f"/threads/{root['id']}/edit", json={"new_content": "# Smoke test root\n\nEdited in place."}
        )
        assert edit_resp.json()["cascaded"] is False

        # child must be unaffected by the in-place edit
        child_still_there = client.get(f"/threads/{child['id']}")
        assert child_still_there.status_code == 200

        graph = client.get("/graph").json()
        assert len(graph["nodes"]) == 2
```

**Step 2: Run**

Run: `pytest test_smoke_e2e.py -v -s`
Expected: 1 passed (takes ~15-30s — this is expected, it calls the real Copilot CLI)

**Step 3: Update README**

```markdown
# Web-Context Graph

Spider-style branching conversation graph. See `docs/plans/2026-08-27-web-context-graph-mvp.md`
for the implementation plan and Jorge's Obsidian vault spec it implements.

## Run

Backend: `cd backend && source .venv/bin/activate && uvicorn main:app --reload`
Frontend: `cd frontend && npm run dev`

## Test

Backend fast tests: `cd backend && pytest -v --ignore=test_smoke_e2e.py --ignore=test_copilot_engine.py`
Backend full suite (slower, hits real Copilot CLI): `cd backend && pytest -v`
Frontend: `cd frontend && npx vitest run`

## Data location

User graph data lives in `~/web-context-graph-data/` by default (not this repo --
that folder is the user's actual content, auto-committed to its own local git
repo after every mutation as a safety net for D7's absolute-delete semantics).
```

**Step 4: Commit**

```bash
git add backend/test_smoke_e2e.py README.md
git commit -m "test: full-stack smoke test (real Copilot CLI), update README"
```

---

## What's deliberately NOT in this plan (per spec's Out of Scope, D9, Phase 2)

- Text-span fallback chunking (D4 fallback) — block-level only for v1.
- Condense/synthesize button — Q1 still open, Phase 2.
- Retrieval-at-scale measurement — Phase 2, needs real usage data first.
- Sibling-branch context sharing, multi-user, export-as-static-site — Stretch phase.

## Handoff

This plan is ready for `subagent-driven-development`: dispatch one Copilot-CLI-driven subagent per task above (via `delegate_task`, `acp_command="copilot"`), review spec-compliance (does it match the D#/Q# cited) then code quality, and proceed task-by-task. Tasks 1-8 (backend) can run sequentially; Tasks 9-13 (frontend) depend on the backend endpoints existing, so keep that ordering. Task 14 is the final integration checkpoint before calling Phase 1 complete.
