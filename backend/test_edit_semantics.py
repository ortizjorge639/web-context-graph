import tempfile
from pathlib import Path
from fastapi.testclient import TestClient

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

        edit_resp = client.post(f"/threads/{root['id']}/edit", json={"new_content": "Hi (tightened)"})
        assert edit_resp.status_code == 200
        assert edit_resp.json()["cascaded"] is False

        still_there = client.get(f"/threads/{child['id']}")
        assert still_there.status_code == 200

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
