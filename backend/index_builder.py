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
