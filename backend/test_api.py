import tempfile
from pathlib import Path
from fastapi.testclient import TestClient

def make_client(tmp_path):
    import main
    main.VAULT_ROOT = Path(tmp_path)
    main.store = main.ThreadStore(vault_root=main.VAULT_ROOT)
    return TestClient(main.app)

def test_create_root_thread():
    with tempfile.TemporaryDirectory() as tmp:
        client = make_client(tmp)
        resp = client.post("/threads", json={"title": "Test Thread"})
        assert resp.status_code == 200
        assert resp.json()["forked_from"] is None

def test_fork_thread_carries_full_lineage():
    with tempfile.TemporaryDirectory() as tmp:
        client = make_client(tmp)
        root = client.post("/threads", json={"title": "Root"}).json()
        client.post(f"/threads/{root['id']}/messages", json={"role": "user", "content": "Hi"})
        chunk_id = f"{root['id']}#c0"
        fork_resp = client.post(
            f"/threads/{root['id']}/fork",
            json={"chunk_id": chunk_id, "title": "Forked thread"},
        )
        assert fork_resp.status_code == 200
        child = fork_resp.json()
        assert child["forked_from"]["thread_id"] == root["id"]
        detail = client.get(f"/threads/{child['id']}").json()
        assert "Root" in detail["content"] or "Hi" in detail["content"]

def test_lineage_depth_reported_in_thread_detail():
    with tempfile.TemporaryDirectory() as tmp:
        client = make_client(tmp)
        root = client.post("/threads", json={"title": "Root"}).json()
        detail = client.get(f"/threads/{root['id']}").json()
        assert detail["lineage_depth"] == 0

        client.post(f"/threads/{root['id']}/messages", json={"role": "user", "content": "Hi"})
        child = client.post(
            f"/threads/{root['id']}/fork",
            json={"chunk_id": f"{root['id']}#c0", "title": "Child"},
        ).json()
        child_detail = client.get(f"/threads/{child['id']}").json()
        assert child_detail["lineage_depth"] == 1
