"""
Full-stack smoke test. Uses the REAL Copilot CLI (not mocked) -- slow
(~10-20s) by design, per the plan's finding that this integration point is
the riskiest part of the system. Run this one deliberately, not in a fast
inner test loop.
"""
import tempfile
from pathlib import Path
from fastapi.testclient import TestClient


def test_full_loop_create_message_fork_edit_graph():
    with tempfile.TemporaryDirectory() as tmp:
        import main
        main.VAULT_ROOT = Path(tmp)
        main.store = main.ThreadStore(vault_root=main.VAULT_ROOT)
        client = TestClient(main.app)

        root = client.post("/threads", json={"title": "Smoke test root"}).json()
        msg_resp = client.post(
            f"/threads/{root['id']}/messages",
            json={"role": "user", "content": "Say hello in one short sentence."},
        )
        assert msg_resp.status_code == 200

        detail = client.get(f"/threads/{root['id']}").json()
        assert len(detail["chunks"]) > 0

        child = client.post(
            f"/threads/{root['id']}/fork",
            json={"chunk_id": detail["chunks"][0]["id"], "title": "Forked"},
        ).json()
        assert child["forked_from"]["thread_id"] == root["id"]

        edit_resp = client.post(
            f"/threads/{root['id']}/edit", json={"new_content": "# Smoke test root\n\nEdited in place."}
        )
        assert edit_resp.json()["cascaded"] is False

        child_still_there = client.get(f"/threads/{child['id']}")
        assert child_still_there.status_code == 200

        graph = client.get("/graph").json()
        assert len(graph["nodes"]) == 2
