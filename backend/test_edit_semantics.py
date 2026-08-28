import tempfile
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
    return TestClient(main.app)

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
