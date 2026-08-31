"""
FastAPI backend. D1 (chunk-reply forks a thread), D2 (full lineage carried
into new thread), D3 (no sibling context sharing -- each thread only ever
sees ITS OWN lineage chain, never a sibling's).
"""
from pathlib import Path
from datetime import datetime, timezone
from typing import Literal
from contextlib import asynccontextmanager, contextmanager
import copy
import json
import math
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel
from starlette.middleware.trustedhost import TrustedHostMiddleware

from storage import ThreadStore
from chunking import chunk_markdown
from index_builder import rebuild_index
from copilot_engine import ask_copilot, stream_copilot
from autocommit import ensure_git_repo, autocommit
from tutorial_seed import TutorialResetBlocked, ensure_tutorial, tutorial_status

VAULT_ROOT = Path(
    os.environ.get("WCG_VAULT_ROOT", Path.home() / "web-context-graph-data")
).expanduser()
FRONTEND_DIST = Path(
    os.environ.get(
        "WCG_FRONTEND_DIST",
        Path(__file__).resolve().parents[1] / "frontend" / "dist",
    )
).expanduser()
store = ThreadStore(vault_root=VAULT_ROOT)
_thread_locks: dict[str, threading.Lock] = {}
_thread_locks_guard = threading.Lock()


def _thread_lock(thread_id: str) -> threading.Lock:
    with _thread_locks_guard:
        return _thread_locks.setdefault(thread_id, threading.Lock())


@contextmanager
def _locked_threads(thread_ids: list[str]):
    acquired = []
    try:
        for thread_id in sorted(set(thread_ids)):
            lock = _thread_lock(thread_id)
            if not lock.acquire(blocking=False):
                raise HTTPException(
                    409,
                    f"Conversation is busy: {thread_id}",
                )
            acquired.append(lock)
        yield
    finally:
        for lock in reversed(acquired):
            lock.release()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    store.initialize()
    ensure_git_repo(VAULT_ROOT)
    if store.agent_guide_created:
        autocommit(VAULT_ROOT, message="add vault agent guide")
    yield


app = FastAPI(lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(
    TrustedHostMiddleware,
    allowed_hosts=["localhost", "127.0.0.1"],
)


class CreateThreadRequest(BaseModel):
    title: str


class MessageRequest(BaseModel):
    role: str
    content: str


class ForkRequest(BaseModel):
    chunk_id: str
    prompt: str | None = None
    title: str | None = None


class TutorialRequest(BaseModel):
    reset: bool = False


class RevealFileRequest(BaseModel):
    path: str


class UpdateThreadRequest(BaseModel):
    title: str | None = None
    pinned: bool | None = None


class ReorderThreadsRequest(BaseModel):
    thread_ids: list[str]


class GraphPosition(BaseModel):
    x: float
    y: float


class GraphLayoutRequest(BaseModel):
    mode: Literal["lineage", "tree"] = "lineage"
    positions: dict[str, GraphPosition]


def _read_graph_layout(path: Path) -> dict:
    if not path.exists():
        return {}
    try:
        raw = json.loads(path.read_text())
    except (json.JSONDecodeError, OSError):
        return {}
    return raw if isinstance(raw, dict) else {}


def _stored_graph_layouts(path: Path, valid_ids: set[str]) -> dict:
    raw_layout = _read_graph_layout(path)
    layouts = {"lineage": {}, "tree": {}}
    stored_layouts = raw_layout.get("layouts")
    if isinstance(stored_layouts, dict):
        for mode in layouts:
            stored_mode = stored_layouts.get(mode, {})
            if isinstance(stored_mode, dict):
                layouts[mode] = {
                    thread_id: position
                    for thread_id, position in stored_mode.items()
                    if thread_id in valid_ids
                    and isinstance(position, dict)
                    and isinstance(position.get("x"), (int, float))
                    and not isinstance(position.get("x"), bool)
                    and math.isfinite(position["x"])
                    and isinstance(position.get("y"), (int, float))
                    and not isinstance(position.get("y"), bool)
                    and math.isfinite(position["y"])
                }
    else:
        stored_positions = raw_layout.get("positions", {})
        if isinstance(stored_positions, dict):
            layouts["lineage"] = {
                thread_id: position
                for thread_id, position in stored_positions.items()
                if thread_id in valid_ids
                and isinstance(position, dict)
                and isinstance(position.get("x"), (int, float))
                and not isinstance(position.get("x"), bool)
                and math.isfinite(position["x"])
                and isinstance(position.get("y"), (int, float))
                and not isinstance(position.get("y"), bool)
                and math.isfinite(position["y"])
            }
    return layouts


def _write_json_atomic(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = None
    try:
        with tempfile.NamedTemporaryFile(
            "w",
            dir=path.parent,
            prefix=f".{path.name}.",
            suffix=".tmp",
            delete=False,
        ) as temporary:
            temporary.write(json.dumps(value, indent=2) + "\n")
            temporary.flush()
            os.fsync(temporary.fileno())
            temporary_path = Path(temporary.name)
        os.replace(temporary_path, path)
    finally:
        if temporary_path and temporary_path.exists():
            temporary_path.unlink()


def _build_lineage_content(thread_id: str) -> str:
    """D2: root-to-current context, truncating every ancestor at its fork point."""
    return "\n\n".join(
        chunk["text"] for chunk in _display_lineage_chunks(thread_id)
    )


def _activity(
    activity_id: str,
    label: str,
    state: str,
    detail: str | None = None,
) -> str:
    event = {
        "type": "activity",
        "id": activity_id,
        "kind": "status",
        "label": label,
        "state": state,
    }
    if detail:
        event["detail"] = detail
    return json.dumps(event) + "\n"


@app.get("/graph")
def get_graph():
    """D8: backlinks are structural (fork relationships), never AI-synthesized."""
    threads_dir = store.threads_dir
    ids = [p.name for p in threads_dir.iterdir() if p.is_dir()] if threads_dir.exists() else []
    nodes, edges = [], []
    for tid in ids:
        meta = store.load_meta(tid)
        preview = "No messages yet"
        for chunk in reversed(chunk_markdown(store.read_content(tid), thread_id=tid)):
            text = chunk.text.strip()
            if text.startswith("# ") or text.startswith("**system:** [Forked from chunk"):
                continue
            text = re.sub(r"^\*\*(?:user|assistant|system):\*\*\s*", "", text)
            compact = " ".join(text.split())
            if compact:
                preview = compact[:160]
                break
        nodes.append({
            "id": meta.id,
            "label": meta.title,
            "status": meta.status,
            "preview": preview,
            "created_at": meta.created_at,
        })
        if meta.forked_from:
            edges.append({
                "source": meta.forked_from["thread_id"],
                "target": meta.id,
                "chunk_id": meta.forked_from["chunk_id"],
            })
    layout_path = VAULT_ROOT / "graph-layout.json"
    layouts = _stored_graph_layouts(layout_path, set(ids))
    return {"nodes": nodes, "edges": edges, "layouts": layouts}


@app.put("/graph/layout")
def update_graph_layout(req: GraphLayoutRequest):
    for thread_id, position in req.positions.items():
        if not store._thread_dir(thread_id).exists():
            raise HTTPException(404, f"Thread not found: {thread_id}")
        if not math.isfinite(position.x) or not math.isfinite(position.y):
            raise HTTPException(400, "Graph positions must be finite numbers")
    layout_path = VAULT_ROOT / "graph-layout.json"
    valid_ids = {
        path.name for path in store.threads_dir.iterdir() if path.is_dir()
    } if store.threads_dir.exists() else set()
    layouts = _stored_graph_layouts(layout_path, valid_ids)
    layouts[req.mode] = {
        thread_id: position.model_dump()
        for thread_id, position in req.positions.items()
    }
    _write_json_atomic(layout_path, {
        "version": 2,
        "layouts": layouts,
    })
    rebuild_index(VAULT_ROOT)
    autocommit(VAULT_ROOT, message="update graph layout")
    return {"ok": True}


@app.get("/threads")
def list_threads(q: str | None = None):
    threads_dir = store.threads_dir
    ids = [p.name for p in threads_dir.iterdir() if p.is_dir()] if threads_dir.exists() else []
    metas = [store.load_meta(thread_id) for thread_id in ids]
    metas.sort(key=lambda meta: meta.updated_at, reverse=True)
    metas.sort(key=lambda meta: (
        0 if meta.pinned and not meta.forked_from else 1,
        meta.sidebar_order if not meta.forked_from and meta.sidebar_order is not None else 10**9,
    ))
    if q and q.strip():
        query = q.strip().casefold()
        metas = [
            meta for meta in metas
            if query in meta.title.casefold()
            or query in store.read_content(meta.id).casefold()
        ]

    def descendant_count(meta) -> int:
        return sum(
            1 + descendant_count(store.load_meta(child["thread_id"]))
            for child in meta.forked_children
            if store._thread_dir(child["thread_id"]).exists()
        )

    return [
        {
            "id": meta.id,
            "title": meta.title,
            "status": meta.status,
            "updated_at": meta.updated_at,
            "forked_from": meta.forked_from,
            "pinned": meta.pinned,
            "sidebar_order": meta.sidebar_order,
            "descendant_count": descendant_count(meta),
        }
        for meta in metas
    ]


@app.get("/tutorial")
def get_tutorial():
    return tutorial_status(store)


@app.post("/tutorial")
def create_tutorial(req: TutorialRequest):
    try:
        status, mutated = ensure_tutorial(store, reset=req.reset)
    except TutorialResetBlocked as error:
        raise HTTPException(
            409,
            {
                "message": "Reset blocked because user branches depend on the tutorial",
                "thread_ids": error.thread_ids,
            },
        )
    if mutated:
        rebuild_index(VAULT_ROOT)
        action = "reset" if req.reset else "create"
        autocommit(VAULT_ROOT, message=f"{action} tutorial graph")
    return status


@app.get("/files/{thread_id}")
def get_thread_files(thread_id: str):
    try:
        meta = store.load_meta(thread_id)
    except FileNotFoundError:
        raise HTTPException(404, "Thread not found")

    lineage_ids = []
    current = meta
    while True:
        lineage_ids.append(current.id)
        if not current.forked_from:
            break
        current = store.load_meta(current.forked_from["thread_id"])
    lineage_ids.reverse()

    ids = [path.name for path in store.threads_dir.iterdir() if path.is_dir()]
    metas = [store.load_meta(item_id) for item_id in ids]
    metas.sort(key=lambda item: item.created_at)
    titles = {item.id: item.title for item in metas}
    meta_by_id = {item.id: item for item in metas}
    relationship_issues = 0
    for item in metas:
        if item.forked_from:
            parent = meta_by_id.get(item.forked_from["thread_id"])
            if not parent or not any(
                child["thread_id"] == item.id
                and child["chunk_id"] == item.forked_from["chunk_id"]
                for child in parent.forked_children
            ):
                relationship_issues += 1

    index_path = VAULT_ROOT / "index.md"
    return {
        "vault_name": VAULT_ROOT.name,
        "active_lineage_ids": lineage_ids,
        "health": {
            "status": "healthy" if index_path.exists() and relationship_issues == 0 else "attention",
            "relationship_issues": relationship_issues,
            "index_updated_at": (
                datetime.fromtimestamp(index_path.stat().st_mtime, timezone.utc).isoformat()
                if index_path.exists() else None
            ),
        },
        "index": {
            "name": "index.md",
            "path": "index.md",
        },
        "guide": {
            "name": "AGENTS.md",
            "path": "AGENTS.md",
        },
        "threads": [
            {
                "id": item.id,
                "title": item.title,
                "folder": f"threads/{item.id}",
                "status": item.status,
                "created_at": item.created_at,
                "updated_at": item.updated_at,
                "pinned": item.pinned,
                "message_count": len(item.message_metrics),
                "forked_from": (
                    {
                        **item.forked_from,
                        "title": titles.get(item.forked_from["thread_id"], "Missing conversation"),
                    }
                    if item.forked_from else None
                ),
                "forked_children": [
                    {
                        **child,
                        "title": titles.get(child["thread_id"], "Missing conversation"),
                    }
                    for child in item.forked_children
                    if child["thread_id"] in titles
                ],
                "files": [
                    {
                        "name": "thread.md",
                        "path": f"threads/{item.id}/thread.md",
                    },
                    {
                        "name": "meta.yaml",
                        "path": f"threads/{item.id}/meta.yaml",
                    },
                ],
            }
            for item in metas
        ],
    }


def _resolve_vault_path(path: str) -> Path:
    target = (VAULT_ROOT / path).resolve()
    try:
        target.relative_to(VAULT_ROOT.resolve())
    except ValueError:
        raise HTTPException(400, "Path must be inside the vault")
    return target


@app.get("/file-content")
def get_file_content(path: str):
    target = _resolve_vault_path(path)
    relative = target.relative_to(VAULT_ROOT.resolve())
    is_root_guide = relative.parts in {("index.md",), ("AGENTS.md",)}
    is_thread_file = (
        len(relative.parts) == 3
        and relative.parts[0] == "threads"
        and relative.parts[2] in {"thread.md", "meta.yaml"}
    )
    if not is_root_guide and not is_thread_file:
        raise HTTPException(400, "File is not part of the conversation vault view")
    if not target.is_file():
        raise HTTPException(404, "File not found")
    return {
        "name": target.name,
        "path": str(relative),
        "content": target.read_text(),
    }


@app.post("/files/actions/refresh")
def refresh_vault():
    rebuild_index(VAULT_ROOT)
    autocommit(VAULT_ROOT, message="refresh vault index")
    return {"ok": True}


@app.post("/files/actions/reveal")
def reveal_file(req: RevealFileRequest):
    target = _resolve_vault_path(req.path)
    if not target.exists():
        raise HTTPException(404, "Vault item not found")
    if sys.platform == "win32":
        if target.is_dir():
            command = ["explorer", str(target)]
        else:
            command = ["explorer", f"/select,{target}"]
    elif sys.platform == "darwin":
        command = ["open", "-R", str(target)]
    else:
        command = ["xdg-open", str(target if target.is_dir() else target.parent)]
    subprocess.run(command, check=True)
    return {"ok": True}


@app.post("/threads")
def create_thread(req: CreateThreadRequest):
    meta = store.create_thread(title=req.title, forked_from=None)
    rebuild_index(VAULT_ROOT)
    autocommit(VAULT_ROOT, message=f"create thread {meta.id}")
    return meta.__dict__


@app.patch("/threads/{thread_id}")
def update_thread(thread_id: str, req: UpdateThreadRequest):
    try:
        meta = store.load_meta(thread_id)
    except FileNotFoundError:
        raise HTTPException(404, "Thread not found")
    with _locked_threads([thread_id]):
        meta = store.load_meta(thread_id)
        title = None
        if req.title is not None:
            title = " ".join(req.title.split())
            if not title:
                raise HTTPException(400, "Conversation title cannot be empty")
        if req.pinned is not None and meta.forked_from:
            raise HTTPException(400, "Only root conversations can be pinned")
        if title is not None:
            meta = store.rename_thread(thread_id, title[:120])
        if req.pinned is not None:
            meta.pinned = req.pinned
            meta.updated_at = datetime.now(timezone.utc).isoformat()
            store._write_meta(meta)
        rebuild_index(VAULT_ROOT)
        autocommit(VAULT_ROOT, message=f"update thread {thread_id}")
        return meta.__dict__


@app.post("/threads/reorder")
def reorder_threads(req: ReorderThreadsRequest):
    seen = set()
    metas = []
    for thread_id in req.thread_ids:
        if thread_id in seen:
            raise HTTPException(400, "Conversation order contains duplicates")
        seen.add(thread_id)
        try:
            meta = store.load_meta(thread_id)
        except FileNotFoundError:
            raise HTTPException(404, f"Thread not found: {thread_id}")
        if meta.forked_from or meta.pinned:
            raise HTTPException(400, "Only unpinned root conversations can be reordered")
        metas.append(meta)
    with _locked_threads([meta.id for meta in metas]):
        for order, meta in enumerate(metas):
            meta.sidebar_order = order
            store._write_meta(meta)
        rebuild_index(VAULT_ROOT)
        autocommit(VAULT_ROOT, message="reorder root conversations")
        return {"ok": True}


@app.delete("/threads/{thread_id}")
def delete_thread(thread_id: str):
    try:
        meta = store.load_meta(thread_id)
    except FileNotFoundError:
        raise HTTPException(404, "Thread not found")
    deleted_ids = store.descendant_ids(thread_id)
    parent_id = meta.forked_from["thread_id"] if meta.forked_from else None
    with _locked_threads([*deleted_ids, *([parent_id] if parent_id else [])]):
        if store.descendant_ids(thread_id) != deleted_ids:
            raise HTTPException(409, "The branch changed; retry deletion")
        deleted_ids = store.delete_thread_recursive(thread_id)
        rebuild_index(VAULT_ROOT)
        autocommit(VAULT_ROOT, message=f"delete thread tree {thread_id}")
        return {
            "ok": True,
            "deleted_ids": deleted_ids,
            "parent_id": parent_id,
        }


def _lineage_depth(thread_id: str) -> int:
    meta = store.load_meta(thread_id)
    if not meta.forked_from:
        return 0
    return 1 + _lineage_depth(meta.forked_from["thread_id"])


def _chunks_with_metrics(thread_id: str) -> list[dict]:
    meta = store.load_meta(thread_id)
    metrics_by_order = {
        metrics["last_chunk_order"]: metrics
        for metrics in meta.message_metrics
        if "last_chunk_order" in metrics
    }
    return [
        {
            **chunk.__dict__,
            "metrics": metrics_by_order.get(chunk.order),
            "owner_thread_id": thread_id,
        }
        for chunk in chunk_markdown(store.read_content(thread_id), thread_id=thread_id)
    ]


def _display_lineage_chunks(thread_id: str) -> list[dict]:
    meta = store.load_meta(thread_id)
    own_chunks = _chunks_with_metrics(thread_id)
    if not meta.forked_from:
        return own_chunks

    parent_id = meta.forked_from["thread_id"]
    source_chunk_id = meta.forked_from["chunk_id"]
    parent_chunks = _display_lineage_chunks(parent_id)
    parent_prefix = []
    source_found = False
    for chunk in parent_chunks:
        parent_prefix.append(chunk)
        if chunk["id"] == source_chunk_id:
            source_found = True
            break
    if not source_found:
        raise RuntimeError(
            f"Fork point {source_chunk_id} no longer exists in parent thread {parent_id}"
        )

    # Older branches stored a complete lineage snapshot inside their system
    # message. Remove that duplicated prefix from the child view without
    # rewriting the user's vault.
    parent_texts = [chunk["text"] for chunk in parent_chunks]
    source_length = len(parent_prefix)
    for start, chunk in enumerate(own_chunks):
        if not parent_texts or chunk["text"] != parent_texts[0]:
            continue
        matched = 0
        while (
            start + matched < len(own_chunks)
            and matched < len(parent_texts)
            and own_chunks[start + matched]["text"] == parent_texts[matched]
        ):
            matched += 1
        if matched >= source_length:
            snapshot_end = start + matched
            if matched == len(parent_texts):
                metric_starts = [
                    metric.get("first_chunk_order")
                    for metric in meta.message_metrics
                    if isinstance(metric, dict)
                    and isinstance(metric.get("first_chunk_order"), int)
                ]
                if metric_starts:
                    first_reply = min(metric_starts)
                    child_user_chunks = [
                        index
                        for index in range(
                            snapshot_end,
                            min(first_reply, len(own_chunks)),
                        )
                        if own_chunks[index]["text"].startswith("**user:**")
                    ]
                    if child_user_chunks:
                        snapshot_end = child_user_chunks[-1]
            own_chunks = own_chunks[:start] + own_chunks[snapshot_end:]
            break

    return parent_prefix + own_chunks


@app.get("/threads/{thread_id}")
def get_thread(thread_id: str):
    try:
        meta = store.load_meta(thread_id)
    except FileNotFoundError:
        raise HTTPException(404, "Thread not found")
    chunks = _display_lineage_chunks(thread_id)
    return {
        **meta.__dict__,
        "content": "\n\n".join(chunk["text"] for chunk in chunks),
        "raw_content": store.read_content(thread_id),
        "forked_children": [
            {
                **child,
                "title": store.load_meta(child["thread_id"]).title,
            }
            for child in meta.forked_children
        ],
        "chunks": [
            {**chunk, "is_ancestor": chunk["owner_thread_id"] != thread_id}
            for chunk in chunks
        ],
        "lineage_depth": _lineage_depth(thread_id),
    }


@app.post("/threads/{thread_id}/messages")
def send_message(thread_id: str, req: MessageRequest):
    with _locked_threads([thread_id]):
        try:
            meta = store.load_meta(thread_id)
        except FileNotFoundError:
            raise HTTPException(404, "Thread not found")
        store.append_message(thread_id, req.role, req.content)
        if req.role == "user":
            prompt = req.content if meta.copilot_initialized else _build_lineage_content(thread_id)
            reply = ask_copilot(meta.copilot_session_id, prompt)
            store.append_message(thread_id, "assistant", reply)
            store.mark_copilot_initialized(thread_id)
        rebuild_index(VAULT_ROOT)
        autocommit(VAULT_ROOT, message=f"message in {thread_id}")
    return {"ok": True}


@app.post("/threads/{thread_id}/messages/stream")
def stream_message(thread_id: str, req: MessageRequest):
    try:
        meta = store.load_meta(thread_id)
    except FileNotFoundError:
        raise HTTPException(404, "Thread not found")
    if req.role != "user":
        raise HTTPException(400, "Only user messages can start an assistant stream")
    lock = _thread_lock(thread_id)
    if not lock.acquire(blocking=False):
        raise HTTPException(409, "Conversation is busy")

    def generate_locked():
        meta = store.load_meta(thread_id)
        started_clock = time.monotonic()
        yield _activity("save", "Saving your message", "running")
        store.append_message(thread_id, "user", req.content)
        rebuild_index(VAULT_ROOT)
        autocommit(VAULT_ROOT, message=f"message in {thread_id}")
        yield _activity("save", "Message saved locally", "complete")

        reply_parts = []
        reply_persisted = False
        model = "unknown"
        token_usage = {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0}
        try:
            if meta.copilot_initialized:
                context_label = "Restoring this conversation"
            else:
                context_label = "Preparing branch context" if meta.forked_from else "Preparing conversation context"
            yield _activity("context", context_label, "running")
            prompt = req.content if meta.copilot_initialized else _build_lineage_content(thread_id)
            yield _activity("context", "Conversation context ready", "complete")
            yield _activity("startup", "Starting Copilot", "running")
            for event in stream_copilot(meta.copilot_session_id, prompt):
                if event["type"] == "delta":
                    reply_parts.append(event["content"])
                elif event["type"] == "model":
                    model = event["model"]
                elif event["type"] == "usage":
                    for key in token_usage:
                        token_usage[key] += event[key]
                yield json.dumps(event) + "\n"

            reply = "".join(reply_parts).strip()
            if not reply:
                raise RuntimeError("copilot CLI returned an empty response")

            first_chunk_order = len(chunk_markdown(store.read_content(thread_id), thread_id))
            store.append_message(thread_id, "assistant", reply)
            reply_persisted = True
            last_chunk_order = len(chunk_markdown(store.read_content(thread_id), thread_id)) - 1
            completed_at = datetime.now(timezone.utc)
            metrics = {
                "model": model,
                **token_usage,
                "elapsed_ms": round((time.monotonic() - started_clock) * 1000),
                "timestamp": completed_at.isoformat(),
                "first_chunk_order": first_chunk_order,
                "last_chunk_order": last_chunk_order,
            }
            store.record_message_metrics(thread_id, metrics)
            rebuild_index(VAULT_ROOT)
            autocommit(VAULT_ROOT, message=f"response in {thread_id}")
            yield json.dumps({"type": "complete", "metrics": metrics}) + "\n"
        except Exception as error:
            partial_reply = "".join(reply_parts).strip()
            if partial_reply and not reply_persisted:
                first_chunk_order = len(chunk_markdown(store.read_content(thread_id), thread_id))
                store.append_message(thread_id, "assistant", partial_reply)
                last_chunk_order = len(chunk_markdown(store.read_content(thread_id), thread_id)) - 1
                store.record_message_metrics(thread_id, {
                    "model": model,
                    **token_usage,
                    "elapsed_ms": round((time.monotonic() - started_clock) * 1000),
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "first_chunk_order": first_chunk_order,
                    "last_chunk_order": last_chunk_order,
                    "interrupted": True,
                    "error": str(error),
                })
                rebuild_index(VAULT_ROOT)
                autocommit(VAULT_ROOT, message=f"partial response in {thread_id}")
            yield json.dumps({"type": "error", "message": str(error)}) + "\n"

    def generate():
        try:
            yield from generate_locked()
        finally:
            lock.release()

    return StreamingResponse(generate(), media_type="application/x-ndjson")


@app.post("/threads/{thread_id}/fork")
def fork_thread(thread_id: str, req: ForkRequest):
    """Create a child only after the user supplies its first direction."""
    try:
        store.load_meta(thread_id)
    except FileNotFoundError:
        raise HTTPException(404, "Parent thread not found")
    prompt = (req.prompt or "").strip()
    title = (req.title or "").strip()
    if not prompt and not title:
        raise HTTPException(400, "A branch prompt is required")
    if prompt:
        title = " ".join(prompt.split())[:54]
    with _locked_threads([thread_id]):
        if req.chunk_id not in {
            chunk.id for chunk in chunk_markdown(
                store.read_content(thread_id),
                thread_id,
            )
        }:
            raise HTTPException(400, "Fork chunk does not exist in the parent thread")
        child = store.create_thread(
            title=title,
            forked_from={"thread_id": thread_id, "chunk_id": req.chunk_id},
        )
        store.append_message(child.id, "system", f"[Forked from chunk {req.chunk_id}]")
        rebuild_index(VAULT_ROOT)
        autocommit(VAULT_ROOT, message=f"fork thread {thread_id} into {child.id}")
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
    try:
        meta = store.load_meta(thread_id)
    except FileNotFoundError:
        raise HTTPException(404, "Thread not found")
    with _locked_threads([thread_id]):
        meta = store.load_meta(thread_id)
        old_chunks = {
            chunk.id: chunk.text
            for chunk in chunk_markdown(store.read_content(thread_id), thread_id)
        }
        new_chunks = {
            chunk.id: chunk.text
            for chunk in chunk_markdown(req.new_content, thread_id)
        }
        changed_anchors = [
            child["chunk_id"]
            for child in meta.forked_children
            if new_chunks.get(child["chunk_id"]) != old_chunks.get(child["chunk_id"])
        ]
        if changed_anchors:
            raise HTTPException(
                409,
                {
                    "message": "Edit would invalidate existing branch points",
                    "chunk_ids": changed_anchors,
                },
            )
        path = store._thread_dir(thread_id) / "thread.md"
        path.write_text(req.new_content)
        meta.updated_at = datetime.now(timezone.utc).isoformat()
        store._write_meta(meta)
        rebuild_index(VAULT_ROOT)
        autocommit(VAULT_ROOT, message=f"edit thread {thread_id}")
        return {"ok": True, "cascaded": False}


def _git_index_tree() -> str:
    return subprocess.run(
        ["git", "write-tree"],
        cwd=VAULT_ROOT,
        capture_output=True,
        check=True,
        text=True,
    ).stdout.strip()


def _restore_git_index(tree: str) -> None:
    subprocess.run(
        ["git", "read-tree", tree],
        cwd=VAULT_ROOT,
        capture_output=True,
        check=True,
    )


def _perform_refork(
    thread_id: str,
    req: ReforkRequest,
    parent,
    deleted_ids: list[str],
) -> dict:
    original_parent = copy.deepcopy(parent)
    index_tree = _git_index_tree()
    child = None
    with tempfile.TemporaryDirectory(prefix="wcg-refork-") as backup_root:
        backup_root = Path(backup_root)
        for deleted_id in deleted_ids:
            shutil.copytree(
                store._thread_dir(deleted_id),
                backup_root / deleted_id,
            )
        try:
            child = store.create_thread(
                title=req.new_title,
                forked_from={"thread_id": thread_id, "chunk_id": req.chunk_id},
            )
            store.delete_thread_recursive(req.old_child_thread_id)
            rebuild_index(VAULT_ROOT)
            autocommit(
                VAULT_ROOT,
                message=(
                    f"refork {thread_id}: delete "
                    f"{req.old_child_thread_id}, create {child.id}"
                ),
                check=True,
            )
        except Exception as error:
            if child and store._thread_dir(child.id).exists():
                shutil.rmtree(store._thread_dir(child.id))
            for deleted_id in deleted_ids:
                destination = store._thread_dir(deleted_id)
                if destination.exists():
                    shutil.rmtree(destination)
                shutil.copytree(backup_root / deleted_id, destination)
            store._write_meta(original_parent)
            rebuild_index(VAULT_ROOT)
            _restore_git_index(index_tree)
            raise HTTPException(
                500,
                f"Re-fork failed; the original branch was restored: {error}",
            ) from error
    return {
        "ok": True,
        "cascaded": True,
        "deleted_thread_ids": deleted_ids,
        "new_thread": child.__dict__,
    }


@app.post("/threads/{thread_id}/refork")
def refork(thread_id: str, req: ReforkRequest):
    """
    D7: this IS the "conversation stems off into a new branch" case --
    absolute, unconditional deletion of the OLD downstream branch, per the
    user's own words ("C is deleted, done. Absolute."). The confirm-before-delete
    UX lives in the frontend only (spec-author addition, not user-specified) --
    this endpoint itself performs the deletion unconditionally once called.
    """
    try:
        parent = store.load_meta(thread_id)
        old_child = store.load_meta(req.old_child_thread_id)
    except FileNotFoundError:
        raise HTTPException(404, "Thread not found")
    if not old_child.forked_from or old_child.forked_from["thread_id"] != thread_id:
        raise HTTPException(400, "The old branch is not a direct child of this thread")
    if req.chunk_id not in {
        chunk.id for chunk in chunk_markdown(store.read_content(thread_id), thread_id)
    }:
        raise HTTPException(400, "Fork chunk does not exist in the parent thread")
    deleted_ids = store.descendant_ids(req.old_child_thread_id)
    ensure_git_repo(VAULT_ROOT)
    with _locked_threads([thread_id, *deleted_ids]):
        parent = store.load_meta(thread_id)
        old_child = store.load_meta(req.old_child_thread_id)
        if (
            not old_child.forked_from
            or old_child.forked_from["thread_id"] != thread_id
        ):
            raise HTTPException(
                400,
                "The old branch is not a direct child of this thread",
            )
        locked_deleted_ids = store.descendant_ids(req.old_child_thread_id)
        if locked_deleted_ids != deleted_ids:
            raise HTTPException(409, "The branch changed; retry re-fork")
        if req.chunk_id not in {
            chunk.id for chunk in chunk_markdown(
                store.read_content(thread_id),
                thread_id,
            )
        }:
            raise HTTPException(400, "Fork chunk does not exist in the parent thread")
        return _perform_refork(thread_id, req, parent, deleted_ids)


@app.get("/healthz", include_in_schema=False)
def healthcheck():
    return {
        "ok": True,
        "frontend_built": (FRONTEND_DIST / "index.html").is_file(),
    }


@app.get("/{full_path:path}", include_in_schema=False)
def serve_frontend(full_path: str):
    index_path = FRONTEND_DIST / "index.html"
    if not index_path.is_file():
        raise HTTPException(404, "Frontend build not found")

    requested_path = (FRONTEND_DIST / full_path).resolve()
    if (
        full_path
        and requested_path.is_relative_to(FRONTEND_DIST.resolve())
        and requested_path.is_file()
    ):
        return FileResponse(requested_path)
    return FileResponse(index_path)
