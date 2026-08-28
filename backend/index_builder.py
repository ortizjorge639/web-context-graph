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
    store.initialize()
    threads_dir = store.threads_dir
    all_ids = {p.name for p in threads_dir.iterdir() if p.is_dir()} if threads_dir.exists() else set()

    metas = [store.load_meta(tid) for tid in sorted(all_ids)]
    by_id = {meta.id: meta for meta in metas}

    expected_children = {thread_id: [] for thread_id in all_ids}
    for meta in sorted(metas, key=lambda item: item.created_at):
        if not meta.forked_from:
            continue
        parent_id = meta.forked_from["thread_id"]
        if parent_id in expected_children:
            expected_children[parent_id].append({
                "thread_id": meta.id,
                "chunk_id": meta.forked_from["chunk_id"],
            })
    for meta in metas:
        repaired = expected_children[meta.id]
        if repaired != meta.forked_children:
            meta.forked_children = repaired
            store._write_meta(meta)

    lines = ["# Web-Context Graph Index", "", "> Auto-regenerated. Do not hand-edit.", ""]
    visited = set()

    def safe_title(title: str) -> str:
        return title.replace("\\", "\\\\").replace("[", "\\[").replace("]", "\\]")

    def append_thread(meta, depth: int) -> None:
        if meta.id in visited:
            return
        visited.add(meta.id)
        relation = ""
        if meta.forked_from:
            relation = f" — forked at `{meta.forked_from['chunk_id']}`"
        indent = "  " * depth
        lines.append(
            f"{indent}- [{safe_title(meta.title)}](threads/{meta.id}/thread.md)"
            f" — `{meta.id}`{relation} — {meta.status}"
        )
        for child in expected_children[meta.id]:
            append_thread(by_id[child["thread_id"]], depth + 1)

    roots = [
        meta for meta in metas
        if not meta.forked_from or meta.forked_from["thread_id"] not in by_id
    ]
    for meta in sorted(roots, key=lambda item: item.created_at):
        append_thread(meta, 0)

    remaining = [meta for meta in metas if meta.id not in visited]
    if remaining:
        lines.extend(["", "## Unlinked conversations", ""])
        for meta in remaining:
            append_thread(meta, 0)

    (Path(vault_root) / "index.md").write_text("\n".join(lines) + "\n")
