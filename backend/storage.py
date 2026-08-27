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
    forked_from: dict | None
    created_at: str
    updated_at: str
    status: str = "active"
    chunks: list = field(default_factory=list)
    forked_children: list = field(default_factory=list)
    copilot_session_id: str = field(default_factory=lambda: str(uuid.uuid4()))  # 1:1 with Copilot CLI session


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
