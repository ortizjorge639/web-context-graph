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
