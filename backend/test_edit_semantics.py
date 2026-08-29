import tempfile
import shutil
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient


@pytest.fixture(autouse=True)
def mock_copilot_cli():
    with patch("main.ask_copilot", return_value="Test response"):
        yield


def make_client(tmp_path):
    import main
    main.VAULT_ROOT = Path(tmp_path)
    main.store = main.ThreadStore(vault_root=main.VAULT_ROOT)
    return TestClient(main.app, base_url="http://localhost")

def test_in_place_edit_does_not_delete_forked_child():
    with tempfile.TemporaryDirectory() as tmp:
        client = make_client(tmp)
        root = client.post("/threads", json={"title": "Root"}).json()
        client.post(f"/threads/{root['id']}/messages", json={"role": "user", "content": "Hi"})
        chunk_id = f"{root['id']}#c0"
        child = client.post(
            f"/threads/{root['id']}/fork",
            json={"chunk_id": chunk_id, "title": "Child"},
        ).json()

        import main
        original_content = main.store.read_content(root["id"])
        edit_resp = client.post(
            f"/threads/{root['id']}/edit",
            json={"new_content": original_content + "\nA trailing note.\n"},
        )
        assert edit_resp.status_code == 200
        assert edit_resp.json()["cascaded"] is False

        still_there = client.get(f"/threads/{child['id']}")
        assert still_there.status_code == 200


def test_in_place_edit_rejects_changes_to_existing_fork_anchor():
    with tempfile.TemporaryDirectory() as tmp:
        client = make_client(tmp)
        root = client.post("/threads", json={"title": "Root"}).json()
        client.post(f"/threads/{root['id']}/messages", json={"role": "user", "content": "Hi"})
        client.post(
            f"/threads/{root['id']}/fork",
            json={"chunk_id": f"{root['id']}#c0", "title": "Child"},
        )

        response = client.post(
            f"/threads/{root['id']}/edit",
            json={"new_content": "# Changed root\n\n**user:** Hi\n"},
        )

        assert response.status_code == 409


def test_refork_rejects_unrelated_branch():
    with tempfile.TemporaryDirectory() as tmp:
        client = make_client(tmp)
        first = client.post("/threads", json={"title": "First"}).json()
        second = client.post("/threads", json={"title": "Second"}).json()
        client.post(f"/threads/{first['id']}/messages", json={"role": "user", "content": "First"})
        client.post(f"/threads/{second['id']}/messages", json={"role": "user", "content": "Second"})
        unrelated = client.post(
            f"/threads/{second['id']}/fork",
            json={"chunk_id": f"{second['id']}#c0", "title": "Unrelated"},
        ).json()

        response = client.post(
            f"/threads/{first['id']}/refork",
            json={
                "old_child_thread_id": unrelated["id"],
                "chunk_id": f"{first['id']}#c0",
                "new_title": "Replacement",
            },
        )

        assert response.status_code == 400
        assert client.get(f"/threads/{unrelated['id']}").status_code == 200

def test_refork_deletes_old_downstream_branch_absolutely():
    with tempfile.TemporaryDirectory() as tmp:
        client = make_client(tmp)
        root = client.post("/threads", json={"title": "Root"}).json()
        client.post(f"/threads/{root['id']}/messages", json={"role": "user", "content": "Hi"})
        chunk_id = f"{root['id']}#c0"
        old_child = client.post(
            f"/threads/{root['id']}/fork",
            json={"chunk_id": chunk_id, "title": "Old branch"},
        ).json()

        refork_resp = client.post(
            f"/threads/{root['id']}/refork",
            json={"old_child_thread_id": old_child["id"], "chunk_id": chunk_id, "new_title": "New branch"},
        )
        assert refork_resp.status_code == 200
        assert refork_resp.json()["cascaded"] is True

        deleted = client.get(f"/threads/{old_child['id']}")
        assert deleted.status_code == 404


def test_refork_restores_old_branch_when_replacement_creation_fails():
    with tempfile.TemporaryDirectory() as tmp:
        client = make_client(tmp)
        root = client.post("/threads", json={"title": "Root"}).json()
        client.post(
            f"/threads/{root['id']}/messages",
            json={"role": "user", "content": "Hi"},
        )
        chunk_id = f"{root['id']}#c0"
        old_child = client.post(
            f"/threads/{root['id']}/fork",
            json={"chunk_id": chunk_id, "title": "Old branch"},
        ).json()

        with patch("main.store.create_thread", side_effect=OSError("disk full")):
            response = client.post(
                f"/threads/{root['id']}/refork",
                json={
                    "old_child_thread_id": old_child["id"],
                    "chunk_id": chunk_id,
                    "new_title": "Replacement",
                },
            )

        assert response.status_code == 500
        assert "original branch was restored" in response.json()["detail"]
        assert client.get(f"/threads/{old_child['id']}").status_code == 200


def test_refork_restores_old_branch_after_destructive_failure():
    with tempfile.TemporaryDirectory() as tmp:
        client = make_client(tmp)
        import main

        root = client.post("/threads", json={"title": "Root"}).json()
        client.post(
            f"/threads/{root['id']}/messages",
            json={"role": "user", "content": "Hi"},
        )
        chunk_id = f"{root['id']}#c0"
        old_child = client.post(
            f"/threads/{root['id']}/fork",
            json={"chunk_id": chunk_id, "title": "Old branch"},
        ).json()

        def fail_after_delete(thread_id):
            shutil.rmtree(main.store._thread_dir(thread_id))
            raise OSError("delete interrupted")

        with patch(
            "main.store.delete_thread_recursive",
            side_effect=fail_after_delete,
        ):
            response = client.post(
                f"/threads/{root['id']}/refork",
                json={
                    "old_child_thread_id": old_child["id"],
                    "chunk_id": chunk_id,
                    "new_title": "Replacement",
                },
            )

        assert response.status_code == 500
        assert client.get(f"/threads/{old_child['id']}").status_code == 200
        threads = client.get("/threads").json()
        assert {thread["id"] for thread in threads} == {root["id"], old_child["id"]}
        restored_parent = main.store.load_meta(root["id"])
        assert restored_parent.forked_children == [{
            "thread_id": old_child["id"],
            "chunk_id": chunk_id,
        }]


def test_refork_restores_git_index_when_commit_fails():
    with tempfile.TemporaryDirectory() as tmp:
        client = make_client(tmp)
        import main

        root = client.post("/threads", json={"title": "Root"}).json()
        client.post(
            f"/threads/{root['id']}/messages",
            json={"role": "user", "content": "Hi"},
        )
        chunk_id = f"{root['id']}#c0"
        old_child = client.post(
            f"/threads/{root['id']}/fork",
            json={"chunk_id": chunk_id, "title": "Old branch"},
        ).json()

        def fail_after_staging(vault_root, _message, **_kwargs):
            main.subprocess.run(
                ["git", "add", "-A"],
                cwd=vault_root,
                check=True,
            )
            raise OSError("commit interrupted")

        with patch("main.autocommit", side_effect=fail_after_staging):
            response = client.post(
                f"/threads/{root['id']}/refork",
                json={
                    "old_child_thread_id": old_child["id"],
                    "chunk_id": chunk_id,
                    "new_title": "Replacement",
                },
            )

        assert response.status_code == 500
        assert client.get(f"/threads/{old_child['id']}").status_code == 200
        staged = main.subprocess.run(
            ["git", "diff", "--cached", "--name-only"],
            cwd=tmp,
            capture_output=True,
            check=True,
            text=True,
        )
        assert staged.stdout == ""
