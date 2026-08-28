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
import os
import re
import shutil
import tempfile
import uuid
import yaml


AGENT_GUIDE = """# Agent Guide

This directory is a Web-Context Graph conversation vault. It is user-owned,
plain-file data. Read it without modifying files unless the user explicitly
asks you to change the vault.

## Navigate the vault

1. Read `index.md` to discover root conversations and branches.
2. Choose a thread under `threads/<thread-id>/`.
3. Read `meta.yaml` for authoritative structure and `thread.md` for content.
4. To reconstruct context, follow `forked_from.thread_id` from the selected
   thread back to a root, reverse that chain, and read it root-to-current.
5. For every ancestor, stop at the chunk recorded by the next child's
   `forked_from.chunk_id`. Never include sibling branches.

Older vaults may contain ancestor text embedded at the start of a child
`thread.md`. When reconstructing those threads, remove leading blocks that
exactly duplicate context already collected from ancestors.

## File contract

- `threads/<thread-id>/thread.md`: messages owned by that thread, using
  `**user:**`, `**assistant:**`, and `**system:**` role markers.
- `threads/<thread-id>/meta.yaml`: structural source of truth. `forked_from`
  points to the parent and fork chunk; `forked_children` stores reciprocal
  child links.
- `index.md`: regenerated discovery cache. It is never authoritative and must
  not be hand-edited.
- `graph-layout.json`: optional presentation state only. It does not define
  lineage.

Chunk IDs are deterministic positional addresses in the form
`<thread-id>#c<order>`, computed from that thread's Markdown blocks.

## Mutation safety

Prefer the Web-Context Graph API for writes. It updates both sides of
relationships, regenerates `index.md`, and commits the vault to local git.
Do not rename thread directories, rewrite IDs, edit Copilot session fields, or
move branches by changing only one metadata file. If direct repair is
unavoidable, update parent and child metadata together, regenerate the index,
and preserve git history.

This guide is created once and is safe to extend; the app does not overwrite
an existing `AGENTS.md`.
"""


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
    message_metrics: list = field(default_factory=list)
    pinned: bool = False
    sidebar_order: int | None = None
    copilot_session_id: str = field(default_factory=lambda: str(uuid.uuid4()))  # 1:1 with Copilot CLI session
    copilot_initialized: bool = False


class ThreadStore:
    def __init__(self, vault_root: Path):
        self.vault_root = Path(vault_root)
        self.threads_dir = self.vault_root / "threads"
        self.agent_guide_created = False

    def initialize(self) -> None:
        self.threads_dir.mkdir(parents=True, exist_ok=True)
        guide_path = self.vault_root / "AGENTS.md"
        self.agent_guide_created = not guide_path.exists()
        if self.agent_guide_created:
            guide_path.write_text(AGENT_GUIDE)

    def _thread_dir(self, thread_id: str) -> Path:
        return self.threads_dir / thread_id

    def create_thread(self, title: str, forked_from: dict | None) -> ThreadMeta:
        self.initialize()
        thread_id = _new_thread_id(title)
        now = datetime.now(timezone.utc).isoformat()
        meta = ThreadMeta(
            id=thread_id, title=title, forked_from=forked_from,
            created_at=now, updated_at=now,
        )
        thread_dir = self._thread_dir(thread_id)
        thread_dir.mkdir(parents=True, exist_ok=False)
        try:
            (thread_dir / "thread.md").write_text(f"# {title}\n\n")
            self._write_meta(meta)

            if forked_from:
                parent = self.load_meta(forked_from["thread_id"])
                parent.forked_children.append(
                    {"thread_id": thread_id, "chunk_id": forked_from["chunk_id"]}
                )
                self._write_meta(parent)
        except Exception:
            shutil.rmtree(thread_dir, ignore_errors=True)
            raise

        return meta

    def load_meta(self, thread_id: str) -> ThreadMeta:
        raw = yaml.safe_load((self._thread_dir(thread_id) / "meta.yaml").read_text())
        if "copilot_initialized" not in raw:
            raw["copilot_initialized"] = bool(raw.get("message_metrics"))
        return ThreadMeta(**raw)

    def _write_meta(self, meta: ThreadMeta) -> None:
        path = self._thread_dir(meta.id) / "meta.yaml"
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary_path = None
        try:
            with tempfile.NamedTemporaryFile(
                "w",
                dir=path.parent,
                prefix=".meta.",
                suffix=".yaml.tmp",
                delete=False,
            ) as temporary:
                yaml.safe_dump(asdict(meta), temporary, sort_keys=False)
                temporary.flush()
                os.fsync(temporary.fileno())
                temporary_path = Path(temporary.name)
            os.replace(temporary_path, path)
        finally:
            if temporary_path and temporary_path.exists():
                temporary_path.unlink()

    def append_message(self, thread_id: str, role: str, content: str) -> None:
        path = self._thread_dir(thread_id) / "thread.md"
        with path.open("a") as f:
            f.write(f"\n**{role}:** {content}\n")
        meta = self.load_meta(thread_id)
        meta.updated_at = datetime.now(timezone.utc).isoformat()
        self._write_meta(meta)

    def read_content(self, thread_id: str) -> str:
        return (self._thread_dir(thread_id) / "thread.md").read_text()

    def rename_thread(self, thread_id: str, title: str) -> ThreadMeta:
        meta = self.load_meta(thread_id)
        content_path = self._thread_dir(thread_id) / "thread.md"
        lines = content_path.read_text().splitlines()
        if lines and lines[0].startswith("# "):
            lines[0] = f"# {title}"
            content_path.write_text("\n".join(lines) + "\n")
        meta.title = title
        meta.updated_at = datetime.now(timezone.utc).isoformat()
        self._write_meta(meta)
        return meta

    def record_message_metrics(self, thread_id: str, metrics: dict) -> None:
        meta = self.load_meta(thread_id)
        meta.message_metrics.append(metrics)
        meta.copilot_initialized = True
        self._write_meta(meta)

    def mark_copilot_initialized(self, thread_id: str) -> None:
        meta = self.load_meta(thread_id)
        meta.copilot_initialized = True
        self._write_meta(meta)

    def delete_thread_recursive(self, thread_id: str) -> list[str]:
        """
        Absolute deletion (D7): deletes this thread and every thread that
        (transitively) forked from it. Returns the list of deleted thread IDs.
        """
        deleted = self.descendant_ids(thread_id)
        for deleted_id in reversed(deleted):
            shutil.rmtree(self._thread_dir(deleted_id))
        return deleted

    def descendant_ids(self, thread_id: str) -> list[str]:
        meta = self.load_meta(thread_id)
        descendants = [thread_id]
        for child in meta.forked_children:
            descendants.extend(self.descendant_ids(child["thread_id"]))
        return descendants
