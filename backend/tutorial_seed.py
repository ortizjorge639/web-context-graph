from hashlib import sha256
from pathlib import Path

import yaml

from storage import ThreadStore


TUTORIAL_VERSION = 1
TUTORIAL_THREADS = [
    (
        "Welcome to Web-Context Graph",
        "Think in branches. Explore every direction without losing the path that brought you here.",
    ),
    (
        "Chunking",
        "Responses are divided into focused blocks. Each block is an addressable idea you can copy or branch from.",
    ),
    (
        "Forking",
        "Branch from any response block to explore a new direction while the original conversation remains intact.",
    ),
    (
        "Backtracking",
        "Return to an earlier thread whenever you want. Every path remains visible and independently editable.",
    ),
    (
        "Graph view",
        "The map turns your conversation history into a navigable web. Time flows left to right and sibling branches stack vertically.",
    ),
]


class TutorialResetBlocked(Exception):
    def __init__(self, thread_ids: list[str]):
        self.thread_ids = thread_ids
        super().__init__("Tutorial reset would delete user-created branches")


def _manifest_path(store: ThreadStore) -> Path:
    return store.vault_root / "tutorial.yaml"


def _content_hash(store: ThreadStore, thread_id: str) -> str:
    return sha256(store.read_content(thread_id).encode()).hexdigest()


def _descendant_ids(store: ThreadStore, root_id: str) -> set[str]:
    found: set[str] = set()
    pending = [root_id]
    while pending:
        thread_id = pending.pop()
        if thread_id in found:
            continue
        found.add(thread_id)
        path = store._thread_dir(thread_id) / "meta.yaml"
        if not path.exists():
            continue
        meta = store.load_meta(thread_id)
        pending.extend(child["thread_id"] for child in meta.forked_children)
    return found


def tutorial_status(store: ThreadStore) -> dict:
    path = _manifest_path(store)
    if not path.exists():
        return {
            "exists": False,
            "modified": False,
            "version": TUTORIAL_VERSION,
            "root_thread_id": None,
            "final_thread_id": None,
            "thread_ids": [],
            "protected_thread_ids": [],
        }

    manifest = yaml.safe_load(path.read_text())
    thread_ids = manifest["thread_ids"]
    expected_hashes = manifest["content_hashes"]
    descendants = _descendant_ids(store, manifest["root_thread_id"])
    protected_thread_ids = sorted(descendants - set(thread_ids))
    modified = bool(protected_thread_ids) or set(thread_ids) != descendants
    for thread_id in thread_ids:
        content_path = store._thread_dir(thread_id) / "thread.md"
        if not content_path.exists() or _content_hash(store, thread_id) != expected_hashes.get(thread_id):
            modified = True
            break

    return {
        "exists": True,
        "modified": modified,
        "version": manifest["version"],
        "root_thread_id": manifest["root_thread_id"],
        "final_thread_id": manifest["final_thread_id"],
        "thread_ids": thread_ids,
        "protected_thread_ids": protected_thread_ids,
    }


def ensure_tutorial(store: ThreadStore, reset: bool = False) -> tuple[dict, bool]:
    status = tutorial_status(store)
    if status["exists"] and not reset:
        return status, False

    if status["exists"]:
        if status["protected_thread_ids"]:
            raise TutorialResetBlocked(status["protected_thread_ids"])
        root_path = store._thread_dir(status["root_thread_id"])
        if root_path.exists():
            store.delete_thread_recursive(status["root_thread_id"])
        _manifest_path(store).unlink(missing_ok=True)

    created_ids: list[str] = []
    parent_id: str | None = None
    for title, content in TUTORIAL_THREADS:
        forked_from = (
            {"thread_id": parent_id, "chunk_id": f"{parent_id}#c1"}
            if parent_id
            else None
        )
        meta = store.create_thread(title=title, forked_from=forked_from)
        store.append_message(meta.id, "assistant", content)
        created_ids.append(meta.id)
        parent_id = meta.id

    manifest = {
        "version": TUTORIAL_VERSION,
        "root_thread_id": created_ids[0],
        "final_thread_id": created_ids[-1],
        "thread_ids": created_ids,
        "content_hashes": {
            thread_id: _content_hash(store, thread_id)
            for thread_id in created_ids
        },
    }
    _manifest_path(store).write_text(yaml.safe_dump(manifest, sort_keys=False))
    return tutorial_status(store), True
