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
        assert index_text.startswith("# Lineage App Knowledge Tree")
        assert f"[Root Thread](threads/{a.id}/thread.md)" in index_text
        assert "  - [Child Thread]" in index_text
        assert f"forked at `{a.id}#c0`" in index_text

def test_rebuild_index_prunes_dangling_forked_children():
    with tempfile.TemporaryDirectory() as tmp:
        store = ThreadStore(vault_root=Path(tmp))
        a = store.create_thread(title="Root", forked_from=None)
        b = store.create_thread(
            title="Child", forked_from={"thread_id": a.id, "chunk_id": f"{a.id}#c0"}
        )
        import shutil
        shutil.rmtree(Path(tmp) / "threads" / b.id)
        rebuild_index(Path(tmp))
        parent_meta = store.load_meta(a.id)
        assert parent_meta.forked_children == []


def test_rebuild_index_restores_missing_parent_backlink():
    with tempfile.TemporaryDirectory() as tmp:
        store = ThreadStore(vault_root=Path(tmp))
        parent = store.create_thread(title="Parent", forked_from=None)
        child = store.create_thread(
            title="Child",
            forked_from={"thread_id": parent.id, "chunk_id": f"{parent.id}#c2"},
        )
        parent_meta = store.load_meta(parent.id)
        parent_meta.forked_children = []
        store._write_meta(parent_meta)

        rebuild_index(Path(tmp))

        assert store.load_meta(parent.id).forked_children == [{
            "thread_id": child.id,
            "chunk_id": f"{parent.id}#c2",
        }]
