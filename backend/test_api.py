import tempfile
import json
import threading
import time
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

def test_create_root_thread():
    with tempfile.TemporaryDirectory() as tmp:
        client = make_client(tmp)
        resp = client.post("/threads", json={"title": "Test Thread"})
        assert resp.status_code == 200
        assert resp.json()["forked_from"] is None


def test_cors_rejects_untrusted_browser_origins():
    with tempfile.TemporaryDirectory() as tmp:
        client = make_client(tmp)
        headers = {
            "Origin": "https://malicious.example",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        }

        rejected = client.options("/threads", headers=headers)
        assert rejected.status_code == 400
        assert "access-control-allow-origin" not in rejected.headers

        allowed = client.options(
            "/threads",
            headers={**headers, "Origin": "http://localhost:5173"},
        )
        assert allowed.status_code == 200
        assert allowed.headers["access-control-allow-origin"] == "http://localhost:5173"

def test_list_threads_returns_most_recent_first():
    with tempfile.TemporaryDirectory() as tmp:
        client = make_client(tmp)
        first = client.post("/threads", json={"title": "First"}).json()
        second = client.post("/threads", json={"title": "Second"}).json()

        threads = client.get("/threads").json()

        assert [thread["id"] for thread in threads] == [second["id"], first["id"]]


def test_list_threads_includes_parent_relationships():
        with tempfile.TemporaryDirectory() as tmp:
            client = make_client(tmp)
            root = client.post("/threads", json={"title": "Root"}).json()
            client.post(f"/threads/{root['id']}/messages", json={"role": "assistant", "content": "Source"})
            child = client.post(
                f"/threads/{root['id']}/fork",
                json={"chunk_id": f"{root['id']}#c1", "prompt": "Explore another direction"},
            ).json()

            threads = client.get("/threads").json()
            child_summary = next(thread for thread in threads if thread["id"] == child["id"])
            assert child_summary["forked_from"]["thread_id"] == root["id"]


def test_fork_thread_carries_full_lineage():
    with tempfile.TemporaryDirectory() as tmp:
        client = make_client(tmp)
        root = client.post("/threads", json={"title": "Root"}).json()
        client.post(f"/threads/{root['id']}/messages", json={"role": "user", "content": "Hi"})
        chunk_id = f"{root['id']}#c0"
        fork_resp = client.post(
            f"/threads/{root['id']}/fork",
            json={"chunk_id": chunk_id, "prompt": "Explore the greeting"},
        )
        assert fork_resp.status_code == 200
        child = fork_resp.json()
        assert child["forked_from"]["thread_id"] == root["id"]
        detail = client.get(f"/threads/{child['id']}").json()
        assert "Root" in detail["content"] or "Hi" in detail["content"]
        assert any(chunk["is_ancestor"] for chunk in detail["chunks"])
        assert not any(
            "Hi" in chunk["text"] and chunk["owner_thread_id"] == child["id"]
            for chunk in detail["chunks"]
        )


def test_fork_title_comes_from_prompt_and_lineage_stops_at_source():
    with tempfile.TemporaryDirectory() as tmp:
        client = make_client(tmp)
        root = client.post("/threads", json={"title": "Root"}).json()
        client.post(f"/threads/{root['id']}/messages", json={"role": "assistant", "content": "First\n\nSecond"})

        child = client.post(
            f"/threads/{root['id']}/fork",
            json={"chunk_id": f"{root['id']}#c1", "prompt": "Take the first idea somewhere new"},
        ).json()
        detail = client.get(f"/threads/{child['id']}").json()

        assert child["title"] == "Take the first idea somewhere new"
        assert any(chunk["id"] == f"{root['id']}#c1" for chunk in detail["chunks"])
        assert not any(chunk["id"] == f"{root['id']}#c2" for chunk in detail["chunks"])
        stored = Path(tmp, "threads", child["id"], "thread.md").read_text()
        assert "First" not in stored


def test_legacy_embedded_lineage_is_not_rendered_twice():
    with tempfile.TemporaryDirectory() as tmp:
        client = make_client(tmp)
        import main

        root = client.post("/threads", json={"title": "Root"}).json()
        main.store.append_message(root["id"], "user", "Ancestor question")
        main.store.append_message(root["id"], "assistant", "Ancestor answer")
        child = main.store.create_thread(
            title="Legacy child",
            forked_from={"thread_id": root["id"], "chunk_id": f"{root['id']}#c2"},
        )
        lineage = main._build_lineage_content(root["id"])
        main.store.append_message(
            child.id,
            "system",
            f"[Forked from chunk {root['id']}#c2]\n\n{lineage}",
        )
        main.store.append_message(child.id, "user", "Child-only question")

        detail = client.get(f"/threads/{child.id}").json()

        visible_text = [chunk["text"] for chunk in detail["chunks"]]
        assert sum("Ancestor question" in text for text in visible_text) == 1
        child_chunk = next(chunk for chunk in detail["chunks"] if "Child-only question" in chunk["text"])
        assert child_chunk["is_ancestor"] is False


def test_legacy_embedded_lineage_removes_deleted_parent_suffix():
    with tempfile.TemporaryDirectory() as tmp:
        client = make_client(tmp)
        import main

        root = client.post("/threads", json={"title": "Root"}).json()
        main.store.append_message(root["id"], "user", "Ancestor question")
        main.store.append_message(root["id"], "assistant", "Fork point")
        main.store.append_message(root["id"], "user", "Old parent suffix")
        child = main.store.create_thread(
            title="Legacy child",
            forked_from={"thread_id": root["id"], "chunk_id": f"{root['id']}#c2"},
        )
        lineage = main._build_lineage_content(root["id"])
        main.store.append_message(
            child.id,
            "system",
            f"[Forked from chunk {root['id']}#c2]\n\n{lineage}",
        )
        main.store.append_message(child.id, "user", "Child-only question")
        first_reply = len(main.chunk_markdown(
            main.store.read_content(child.id),
            child.id,
        ))
        main.store.append_message(child.id, "assistant", "Child-only answer")
        main.store.record_message_metrics(child.id, {
            "first_chunk_order": first_reply,
            "last_chunk_order": first_reply,
        })
        root_path = Path(tmp, "threads", root["id"], "thread.md")
        root_path.write_text(
            "# Root\n\n**user:** Ancestor question\n\n**assistant:** Fork point\n"
        )

        detail = client.get(f"/threads/{child.id}").json()

        visible = "\n".join(chunk["text"] for chunk in detail["chunks"])
        assert "Old parent suffix" not in visible
        assert "Child-only question" in visible


def test_legacy_lineage_without_metrics_preserves_child_turns():
    with tempfile.TemporaryDirectory() as tmp:
        client = make_client(tmp)
        import main

        root = client.post("/threads", json={"title": "Root"}).json()
        main.store.append_message(root["id"], "user", "Ancestor question")
        main.store.append_message(root["id"], "assistant", "Fork point")
        child = main.store.create_thread(
            title="Legacy child",
            forked_from={"thread_id": root["id"], "chunk_id": f"{root['id']}#c2"},
        )
        main.store.append_message(
            child.id,
            "system",
            (
                f"[Forked from chunk {root['id']}#c2]\n\n"
                f"{main._build_lineage_content(root['id'])}"
            ),
        )
        main.store.append_message(child.id, "user", "First child question")
        main.store.append_message(child.id, "assistant", "First child answer")
        main.store.append_message(child.id, "user", "Second child question")
        main.store.append_message(child.id, "assistant", "Second child answer")

        visible = client.get(f"/threads/{child.id}").json()["content"]

        assert "First child question" in visible
        assert "First child answer" in visible
        assert "Second child question" in visible
        assert "Second child answer" in visible


def test_legacy_lineage_preserves_complete_multi_turn_child_history():
    with tempfile.TemporaryDirectory() as tmp:
        client = make_client(tmp)
        import main

        root = client.post("/threads", json={"title": "Root"}).json()
        main.store.append_message(root["id"], "user", "Ancestor question")
        main.store.append_message(root["id"], "assistant", "Fork point")
        main.store.append_message(root["id"], "user", "Old parent suffix")
        child = main.store.create_thread(
            title="Legacy child",
            forked_from={"thread_id": root["id"], "chunk_id": f"{root['id']}#c2"},
        )
        lineage = main._build_lineage_content(root["id"])
        main.store.append_message(
            child.id,
            "system",
            f"[Forked from chunk {root['id']}#c2]\n\n{lineage}",
        )
        main.store.append_message(child.id, "user", "First child question")
        first_reply = len(main.chunk_markdown(
            main.store.read_content(child.id),
            child.id,
        ))
        main.store.append_message(child.id, "assistant", "First child answer")
        main.store.record_message_metrics(child.id, {
            "first_chunk_order": first_reply,
            "last_chunk_order": first_reply,
        })
        main.store.append_message(child.id, "user", "Second child question")
        main.store.append_message(child.id, "assistant", "Second child answer")
        Path(tmp, "threads", root["id"], "thread.md").write_text(
            "# Root\n\n**user:** Ancestor question\n\n**assistant:** Fork point\n"
        )

        visible = client.get(f"/threads/{child.id}").json()["content"]

        assert "Old parent suffix" not in visible
        assert "First child question" in visible
        assert "First child answer" in visible
        assert "Second child question" in visible
        assert "Second child answer" in visible


def test_update_thread_validates_pin_before_renaming():
    with tempfile.TemporaryDirectory() as tmp:
        client = make_client(tmp)
        import main

        root = client.post("/threads", json={"title": "Root"}).json()
        main.store.append_message(root["id"], "assistant", "Source")
        child = client.post(
            f"/threads/{root['id']}/fork",
            json={"chunk_id": f"{root['id']}#c1", "title": "Child"},
        ).json()

        response = client.patch(
            f"/threads/{child['id']}",
            json={"title": "Unexpected rename", "pinned": True},
        )

        assert response.status_code == 400
        assert main.store.load_meta(child["id"]).title == "Child"
        assert main.store.read_content(child["id"]).startswith("# Child")


def test_reorder_validates_every_thread_before_writing():
    with tempfile.TemporaryDirectory() as tmp:
        client = make_client(tmp)
        import main

        first = client.post("/threads", json={"title": "First"}).json()
        second = client.post("/threads", json={"title": "Second"}).json()
        before = {
            thread_id: main.store.load_meta(thread_id).sidebar_order
            for thread_id in (first["id"], second["id"])
        }

        response = client.post(
            "/threads/reorder",
            json={"thread_ids": [first["id"], second["id"], first["id"]]},
        )

        assert response.status_code == 400
        assert {
            thread_id: main.store.load_meta(thread_id).sidebar_order
            for thread_id in (first["id"], second["id"])
        } == before


def test_thread_management_search_pin_rename_reorder_and_delete():
    with tempfile.TemporaryDirectory() as tmp:
        client = make_client(tmp)
        import main

        first = client.post("/threads", json={"title": "First root"}).json()
        second = client.post("/threads", json={"title": "Second root"}).json()
        main.store.append_message(first["id"], "assistant", "A uniquely searchable phrase")
        child = client.post(
            f"/threads/{first['id']}/fork",
            json={"chunk_id": f"{first['id']}#c1", "prompt": "Nested direction"},
        ).json()

        search = client.get("/threads", params={"q": "uniquely searchable"}).json()
        assert [thread["id"] for thread in search] == [first["id"]]

        renamed = client.patch(
            f"/threads/{second['id']}",
            json={"title": "Renamed root"},
        )
        assert renamed.status_code == 200
        assert main.store.read_content(second["id"]).startswith("# Renamed root")

        assert client.patch(
            f"/threads/{first['id']}",
            json={"pinned": True},
        ).status_code == 200
        assert client.patch(
            f"/threads/{child['id']}",
            json={"pinned": True},
        ).status_code == 400

        third = client.post("/threads", json={"title": "Third root"}).json()
        assert client.post(
            "/threads/reorder",
            json={"thread_ids": [third["id"], second["id"]]},
        ).status_code == 200
        listed = client.get("/threads").json()
        roots = [thread for thread in listed if not thread["forked_from"]]
        assert [thread["id"] for thread in roots] == [first["id"], third["id"], second["id"]]

        deleted = client.delete(f"/threads/{first['id']}").json()
        assert set(deleted["deleted_ids"]) == {first["id"], child["id"]}
        assert client.get(f"/threads/{child['id']}").status_code == 404

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


def test_stream_message_persists_response_metrics():
    with tempfile.TemporaryDirectory() as tmp:
        client = make_client(tmp)
        thread = client.post("/threads", json={"title": "Streaming"}).json()
        streamed_events = [
            {"type": "model", "model": "gpt-test"},
            {"type": "delta", "content": "Hello"},
            {"type": "delta", "content": " there"},
            {
                "type": "usage",
                "input_tokens": 12,
                "output_tokens": 2,
                "total_tokens": 14,
            },
        ]

        with patch("main.stream_copilot", return_value=iter(streamed_events)) as stream:
            response = client.post(
                f"/threads/{thread['id']}/messages/stream",
                json={"role": "user", "content": "Say hello"},
            )

        events = [json.loads(line) for line in response.text.splitlines()]
        assert [event["content"] for event in events if event["type"] == "delta"] == [
            "Hello",
            " there",
        ]
        completed = next(event for event in events if event["type"] == "complete")
        assert completed["metrics"]["model"] == "gpt-test"
        assert completed["metrics"]["output_tokens"] == 2
        assert any(event["type"] == "activity" for event in events)
        assert "Say hello" in stream.call_args.args[1]

        detail = client.get(f"/threads/{thread['id']}").json()
        assistant_chunk = next(
            chunk for chunk in detail["chunks"]
            if chunk["text"].startswith("**assistant:**")
        )
        assert assistant_chunk["metrics"]["total_tokens"] == 14

        with patch("main.stream_copilot", return_value=iter(streamed_events)) as resumed_stream:
            resumed = client.post(
                f"/threads/{thread['id']}/messages/stream",
                json={"role": "user", "content": "Continue"},
            )

        assert resumed.status_code == 200
        assert resumed_stream.call_args.args[1] == "Continue"


def test_stream_message_persists_partial_reply_on_failure():
    with tempfile.TemporaryDirectory() as tmp:
        client = make_client(tmp)
        import main

        thread = client.post("/threads", json={"title": "Interrupted"}).json()

        def interrupted_stream(*_args):
            yield {"type": "model", "model": "gpt-test"}
            yield {"type": "delta", "content": "Partial answer"}
            raise TimeoutError("Agent became idle")

        with patch("main.stream_copilot", side_effect=interrupted_stream):
            response = client.post(
                f"/threads/{thread['id']}/messages/stream",
                json={"role": "user", "content": "Start"},
            )

        events = [json.loads(line) for line in response.text.splitlines()]
        assert events[-1] == {"type": "error", "message": "Agent became idle"}
        assert "Partial answer" in main.store.read_content(thread["id"])
        metrics = main.store.load_meta(thread["id"]).message_metrics[-1]
        assert metrics["interrupted"] is True


def test_concurrent_streams_for_one_thread_fail_fast():
    with tempfile.TemporaryDirectory() as tmp:
        client = make_client(tmp)
        thread = client.post("/threads", json={"title": "Serialized"}).json()
        first_started = threading.Event()
        release_first = threading.Event()
        call_count = 0
        call_count_lock = threading.Lock()

        def controlled_stream(*_args):
            nonlocal call_count
            with call_count_lock:
                call_count += 1
                current_call = call_count
            if current_call == 1:
                first_started.set()
                assert release_first.wait(timeout=2)
            yield {"type": "delta", "content": f"Reply {current_call}"}

        responses = []

        def post_message(content):
            responses.append(client.post(
                f"/threads/{thread['id']}/messages/stream",
                json={"role": "user", "content": content},
            ))

        with patch("main.stream_copilot", side_effect=controlled_stream):
            first = threading.Thread(target=post_message, args=("First",))
            second = threading.Thread(target=post_message, args=("Second",))
            first.start()
            assert first_started.wait(timeout=2)
            second.start()
            time.sleep(0.1)
            assert call_count == 1
            release_first.set()
            first.join(timeout=2)
            second.join(timeout=2)

        assert len(responses) == 2
        assert sorted(response.status_code for response in responses) == [200, 409]
        content = client.get(f"/threads/{thread['id']}").json()["raw_content"]
        assert content.index("First") < content.index("Reply 1")
        assert "Second" not in content


def test_missing_thread_mutations_return_404():
    with tempfile.TemporaryDirectory() as tmp:
        client = make_client(tmp)

        assert client.post(
            "/threads/missing/messages",
            json={"role": "assistant", "content": "Nope"},
        ).status_code == 404
        assert client.post(
            "/threads/missing/edit",
            json={"new_content": "# Missing"},
        ).status_code == 404
        assert client.post(
            "/threads/missing/refork",
            json={
                "old_child_thread_id": "also-missing",
                "chunk_id": "missing#c0",
                "new_title": "Nope",
            },
        ).status_code == 404


def test_production_frontend_serves_assets_and_spa_routes(tmp_path):
    import main

    frontend_dist = tmp_path / "dist"
    assets = frontend_dist / "assets"
    assets.mkdir(parents=True)
    (frontend_dist / "index.html").write_text("<main>Web Context Graph</main>")
    (assets / "app.js").write_text("window.WCG = true")
    original_dist = main.FRONTEND_DIST
    main.FRONTEND_DIST = frontend_dist
    try:
        client = TestClient(main.app)

        assert client.get("/").text == "<main>Web Context Graph</main>"
        assert client.get("/workspace/deep-link").text == (
            "<main>Web Context Graph</main>"
        )
        assert client.get("/assets/app.js").text == "window.WCG = true"
        assert client.get("/healthz").json() == {
            "ok": True,
            "frontend_built": True,
        }
    finally:
        main.FRONTEND_DIST = original_dist


def test_first_branch_stream_seeds_context_only_through_fork_point():
    with tempfile.TemporaryDirectory() as tmp:
        client = make_client(tmp)
        import main

        root = client.post("/threads", json={"title": "Root"}).json()
        main.store.append_message(root["id"], "user", "Ancestor question")
        main.store.append_message(root["id"], "assistant", "Selected answer")
        main.store.append_message(root["id"], "user", "Later sibling question")
        child = client.post(
            f"/threads/{root['id']}/fork",
            json={"chunk_id": f"{root['id']}#c2", "prompt": "Child direction"},
        ).json()
        streamed_events = [
            {"type": "delta", "content": "Child response"},
            {
                "type": "usage",
                "input_tokens": 8,
                "output_tokens": 2,
                "total_tokens": 10,
            },
        ]

        with patch("main.stream_copilot", return_value=iter(streamed_events)) as stream:
            response = client.post(
                f"/threads/{child['id']}/messages/stream",
                json={"role": "user", "content": "Child direction"},
            )

        assert response.status_code == 200
        prompt = stream.call_args.args[1]
        assert "Selected answer" in prompt
        assert "Child direction" in prompt
        assert "Later sibling question" not in prompt
