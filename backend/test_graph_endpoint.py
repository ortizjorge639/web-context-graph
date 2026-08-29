import tempfile
import json
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
        root_node = next(node for node in data["nodes"] if node["id"] == root["id"])
        assert root_node["preview"] != "No messages yet"
        assert root_node["created_at"]


def test_graph_layout_is_persisted_in_the_vault():
    with tempfile.TemporaryDirectory() as tmp:
        client = make_client(tmp)
        thread = client.post("/threads", json={"title": "Movable"}).json()

        response = client.put("/graph/layout", json={
            "mode": "lineage",
            "positions": {thread["id"]: {"x": 120.5, "y": -42}},
        })

        assert response.status_code == 200
        layout_path = Path(tmp) / "graph-layout.json"
        assert json.loads(layout_path.read_text())["layouts"]["lineage"][thread["id"]] == {
            "x": 120.5,
            "y": -42.0,
        }
        assert client.get("/graph").json()["layouts"]["lineage"][thread["id"]] == {
            "x": 120.5,
            "y": -42.0,
        }

        client.put("/graph/layout", json={
            "mode": "tree",
            "positions": {thread["id"]: {"x": -80, "y": 300}},
        })
        layouts = client.get("/graph").json()["layouts"]
        assert layouts["lineage"][thread["id"]]["x"] == 120.5
        assert layouts["tree"][thread["id"]] == {"x": -80.0, "y": 300.0}


def test_corrupt_graph_layout_recovers_and_can_be_replaced():
    with tempfile.TemporaryDirectory() as tmp:
        client = make_client(tmp)
        thread = client.post("/threads", json={"title": "Recoverable"}).json()
        layout_path = Path(tmp) / "graph-layout.json"
        layout_path.write_text('{"version": 2, "layouts":')

        graph = client.get("/graph")
        assert graph.status_code == 200
        assert graph.json()["layouts"] == {"lineage": {}, "tree": {}}

        saved = client.put("/graph/layout", json={
            "mode": "lineage",
            "positions": {thread["id"]: {"x": 1, "y": 2}},
        })
        assert saved.status_code == 200
        assert json.loads(layout_path.read_text())["layouts"]["lineage"][thread["id"]] == {
            "x": 1.0,
            "y": 2.0,
        }


def test_invalid_stored_positions_are_ignored():
    with tempfile.TemporaryDirectory() as tmp:
        client = make_client(tmp)
        thread = client.post("/threads", json={"title": "Position"}).json()
        layout_path = Path(tmp) / "graph-layout.json"
        layout_path.write_text(json.dumps({
            "version": 2,
            "layouts": {
                "lineage": {thread["id"]: "not-a-position"},
                "tree": {thread["id"]: {"x": None, "y": 20}},
            },
        }))

        assert client.get("/graph").json()["layouts"] == {
            "lineage": {},
            "tree": {},
        }
