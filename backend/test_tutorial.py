import tempfile
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient


def make_client(tmp_path):
    import main
    main.VAULT_ROOT = Path(tmp_path)
    main.store = main.ThreadStore(vault_root=main.VAULT_ROOT)
    return TestClient(main.app)


def test_tutorial_is_idempotent_and_creates_linear_graph():
    with tempfile.TemporaryDirectory() as tmp:
        client = make_client(tmp)
        first = client.post("/tutorial", json={}).json()
        second = client.post("/tutorial", json={}).json()

        assert first["exists"] is True
        assert first["modified"] is False
        assert first["thread_ids"] == second["thread_ids"]
        assert len(first["thread_ids"]) == 5
        root_content = client.get(
            "/file-content",
            params={"path": f"threads/{first['root_thread_id']}/thread.md"},
        ).json()["content"]
        assert root_content.startswith("# Welcome to Lineage App")

        graph = client.get("/graph").json()
        tutorial_edges = [
            edge for edge in graph["edges"]
            if edge["source"] in first["thread_ids"] and edge["target"] in first["thread_ids"]
        ]
        assert len(tutorial_edges) == 4


def test_tutorial_detects_changes_and_resets_after_confirmation():
    with tempfile.TemporaryDirectory() as tmp:
        client = make_client(tmp)
        original = client.post("/tutorial", json={}).json()
        root_id = original["root_thread_id"]
        thread_path = Path(tmp) / "threads" / root_id / "thread.md"
        thread_path.write_text(thread_path.read_text() + "\nChanged by user.\n")

        assert client.get("/tutorial").json()["modified"] is True

        reset = client.post("/tutorial", json={"reset": True}).json()
        assert reset["modified"] is False
        assert reset["thread_ids"] != original["thread_ids"]


def test_tutorial_reset_refuses_to_delete_user_branches():
    with tempfile.TemporaryDirectory() as tmp:
        client = make_client(tmp)
        tutorial = client.post("/tutorial", json={}).json()
        root_id = tutorial["root_thread_id"]
        user_branch = client.post(
            f"/threads/{root_id}/fork",
            json={
                "chunk_id": f"{root_id}#c1",
                "prompt": "My own work",
            },
        ).json()

        status = client.get("/tutorial").json()
        assert status["protected_thread_ids"] == [user_branch["id"]]

        reset = client.post("/tutorial", json={"reset": True})
        assert reset.status_code == 409
        assert client.get(f"/threads/{user_branch['id']}").status_code == 200
        assert client.get(f"/threads/{root_id}").status_code == 200


def test_files_endpoint_returns_relationship_tree_and_loads_content_lazily():
    with tempfile.TemporaryDirectory() as tmp:
        client = make_client(tmp)
        tutorial = client.post("/tutorial", json={}).json()
        extra = client.post("/threads", json={"title": "Outside tutorial"}).json()

        files = client.get(f"/files/{tutorial['final_thread_id']}").json()

        assert files["index"]["name"] == "index.md"
        assert files["guide"] == {"name": "AGENTS.md", "path": "AGENTS.md"}
        assert files["active_lineage_ids"] == tutorial["thread_ids"]
        assert {thread["id"] for thread in files["threads"]} == {
            *tutorial["thread_ids"],
            extra["id"],
        }
        selected = next(
            thread for thread in files["threads"]
            if thread["id"] == tutorial["final_thread_id"]
        )
        assert [file["name"] for file in selected["files"]] == [
            "thread.md",
            "meta.yaml",
        ]
        assert all("content" not in file for file in selected["files"])
        assert selected["forked_from"]["thread_id"] == tutorial["thread_ids"][-2]

        thread_file = selected["files"][0]
        loaded = client.get("/file-content", params={"path": thread_file["path"]})
        assert loaded.status_code == 200
        assert loaded.json()["content"].startswith("# Graph view")
        assert client.get(
            "/file-content",
            params={"path": "../outside.md"},
        ).status_code == 400
        assert client.get(
            "/file-content",
            params={"path": "graph-layout.json"},
        ).status_code == 400
        guide = client.get("/file-content", params={"path": "AGENTS.md"})
        assert guide.status_code == 200
        assert "structural source of truth" in guide.json()["content"]


def test_reveal_file_stays_inside_vault():
    with tempfile.TemporaryDirectory() as tmp:
        client = make_client(tmp)
        thread = client.post("/threads", json={"title": "Reveal me"}).json()
        relative_path = f"threads/{thread['id']}/thread.md"

        with patch("main.subprocess.run") as run:
            response = client.post("/files/actions/reveal", json={"path": relative_path})

        assert response.json() == {"ok": True}
        run.assert_called_once()
        assert client.post(
            "/files/actions/reveal",
            json={"path": "../outside.md"},
        ).status_code == 400


def test_refresh_vault_repairs_index_relationships():
    with tempfile.TemporaryDirectory() as tmp:
        client = make_client(tmp)
        import main

        parent = client.post("/threads", json={"title": "Parent"}).json()
        child = main.store.create_thread(
            title="Child",
            forked_from={"thread_id": parent["id"], "chunk_id": f"{parent['id']}#c0"},
        )
        parent_meta = main.store.load_meta(parent["id"])
        parent_meta.forked_children = []
        main.store._write_meta(parent_meta)

        with patch("main.autocommit") as commit:
            response = client.post("/files/actions/refresh")

        assert response.json() == {"ok": True}
        assert main.store.load_meta(parent["id"]).forked_children[0]["thread_id"] == child.id
        commit.assert_called_once()
