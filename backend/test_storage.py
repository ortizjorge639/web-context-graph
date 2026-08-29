import tempfile
from pathlib import Path
from storage import ThreadStore, ThreadMeta


def test_constructing_store_does_not_create_vault():
    with tempfile.TemporaryDirectory() as tmp:
        vault = Path(tmp) / "not-created-yet"

        ThreadStore(vault_root=vault)

        assert not vault.exists()


def test_create_root_thread_generates_safe_id_and_folder():
    with tempfile.TemporaryDirectory() as tmp:
        store = ThreadStore(vault_root=Path(tmp))
        meta = store.create_thread(title="My First Thread!! ??", forked_from=None)
        assert meta.id
        assert (Path(tmp) / "threads" / meta.id / "thread.md").exists()
        assert (Path(tmp) / "threads" / meta.id / "meta.yaml").exists()
        guide = Path(tmp) / "AGENTS.md"
        assert guide.exists()
        assert "Lineage App conversation vault" in guide.read_text()
        assert "Read `index.md`" in guide.read_text()
        assert "Never include sibling branches" in guide.read_text()
        assert "!" not in meta.id and "?" not in meta.id


def test_existing_agent_guide_is_not_overwritten():
    with tempfile.TemporaryDirectory() as tmp:
        guide = Path(tmp) / "AGENTS.md"
        guide.write_text("# My custom guide\n")

        store = ThreadStore(vault_root=Path(tmp))

        assert store.agent_guide_created is False
        assert guide.read_text() == "# My custom guide\n"

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
