import tempfile
from pathlib import Path
from fastapi.testclient import TestClient

def make_client(tmp_path):
    import main
    main.VAULT_ROOT = Path(tmp_path)
    main.store = main.ThreadStore(vault_root=main.VAULT_ROOT)
    return TestClient(main.app)

def test_graph_endpoint_returns_nodes_and_edges():
    with tempfile.TemporaryDirectory() as tmp:
        client = make_client(tmp)
        root = client.post("/threads", json={"title": "Root"}).json()
        client.post(f"/threads/{root['id']}/messages", json={"role": "user", "content": "Hi"})
        child = client.post(
            f"/threads/{root['id']}/fork",
            json={"chunk_id": f"{root['id']}#c0", "title": "Child"},
        ).json()

        resp = client.get("/graph")
        data = resp.json()
        node_ids = {n["id"] for n in data["nodes"]}
        assert root["id"] in node_ids and child["id"] in node_ids
        assert any(e["source"] == root["id"] and e["target"] == child["id"] for e in data["edges"])
