import json
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from markdown_it import MarkdownIt

from chunking import chunk_anchors, chunk_markdown, chunk_markdown_with_protected_ids


FIXTURES = json.loads(
    (Path(__file__).resolve().parents[1] / "fixtures/table-rows.json").read_text()
)
TABLE = "| Command | Purpose |\n| :--- | ---: |\n| /help | Help |\n| /plan | Plan |\n| /diff | Diff |"


@pytest.mark.parametrize("fixture", FIXTURES, ids=lambda fixture: fixture["name"])
def test_row_source_maps_match_shared_rendering_fixtures(fixture):
    chunks = chunk_markdown(fixture["markdown"], "t")
    rows = [row for chunk in chunks for row in chunk.table_rows]
    assert [(row["table_index"], row["row_index"]) for row in rows] == [
        (row["table_index"], row["row_index"]) for row in fixture["rows"]
    ]
    parser = MarkdownIt("commonmark").enable("table")
    for row, expected in zip(rows, fixture["rows"]):
        tokens = parser.parse(row["text"])
        in_body = False
        cells = []
        for token in tokens:
            if token.type == "tbody_open":
                in_body = True
            if in_body and token.type == "inline":
                cells.append("".join(
                    child.content for child in token.children
                    if child.type in {"text", "code_inline"}
                ))
        assert cells == expected["cells"]


def test_rows_preserve_coarse_ids_and_legacy_whole_table_anchor():
    text = f"Intro\n\n{TABLE}\n\nAfter\n\n- First\n- Second"
    chunks = chunk_markdown(text, "t")
    assert [chunk.id for chunk in chunks] == ["t#c0", "t#c1", "t#c2", "t#c3.0", "t#c3.1"]
    protected = chunk_markdown_with_protected_ids(text, "t", {"t#c1"})
    assert chunks == protected
    anchors = chunk_anchors(chunks)
    assert anchors["t#c1"] == TABLE
    assert anchors["t#c1.row1"] == TABLE.rsplit("\n", 1)[0]
    assert chunks[1].table_rows[1]["text"] == (
        "| Command | Purpose |\n| :--- | ---: |\n| /plan | Plan |"
    )


def test_fences_split_by_legacy_blank_lines_never_advertise_rows():
    text = f"```md\n\n{TABLE}\n\n```\n\nReal text"
    assert not any(chunk.table_rows for chunk in chunk_markdown(text, "t"))


def test_second_table_row_cutoff_keeps_first_table_and_excludes_later_content():
    text = FIXTURES[1]["markdown"] + "\n***\nLater paragraph"
    chunk = chunk_markdown(text, "t")[0]
    assert [row["id"] for row in chunk.table_rows] == ["t#c0.row0", "t#c0.row1"]
    assert chunk_anchors([chunk])["t#c0.row1"] == FIXTURES[1]["markdown"]
    assert "Second" not in chunk_anchors([chunk])["t#c0.row0"]


def test_trailing_whitespace_does_not_hide_final_row():
    chunk = chunk_markdown(TABLE + "   \n", "t")[0]
    assert len(chunk.table_rows) == 3
    assert chunk_anchors([chunk])["t#c0.row2"] == TABLE


def test_three_space_indented_table_keeps_body_targets():
    text = "\n".join("   " + line for line in TABLE.splitlines())
    chunk = chunk_markdown(text, "t")[0]
    assert len(chunk.table_rows) == 3
    assert chunk_anchors([chunk])["t#c0.row1"].endswith("| /plan | Plan |")


def test_rows_remain_available_inside_a_protected_legacy_mixed_chunk():
    text = f"## Options\n- A\n***\n{TABLE}"
    chunks = chunk_markdown_with_protected_ids(text, "t", {"t#c0"})
    assert len(chunks) == 1
    assert chunks[0].id == "t#c0"
    assert len(chunks[0].table_rows) == 3
    assert chunk_anchors(chunks)["t#c0.row1"].endswith("| /plan | Plan |")


@pytest.fixture
def client(tmp_path, monkeypatch):
    import main
    monkeypatch.setattr(main, "VAULT_ROOT", tmp_path)
    monkeypatch.setattr(main, "store", main.ThreadStore(vault_root=tmp_path))
    with patch("main.ask_copilot", return_value="Synthetic response"), TestClient(
        main.app, base_url="http://localhost"
    ) as client:
        yield client


def create_table(client):
    root = client.post("/threads", json={"title": "Commands"}).json()
    response = client.post(f"/threads/{root['id']}/messages", json={
        "role": "assistant", "content": f"Before\n\n{TABLE}\n\nAfter table",
    })
    assert response.status_code == 200
    data = client.get(f"/threads/{root['id']}").json()
    table = next(chunk for chunk in data["chunks"] if chunk["table_rows"])
    return root["id"], table


def fork(client, parent, anchor, title="Child"):
    response = client.post(f"/threads/{parent}/fork", json={"chunk_id": anchor, "title": title})
    assert response.status_code == 200, response.text
    return response.json()["id"]


def test_row_fork_context_graph_backlinks_and_nested_lineage(client):
    import main
    root, table = create_table(client)
    anchor = table["table_rows"][1]["id"]
    sibling = fork(client, root, table["id"], "Sibling")
    client.post(f"/threads/{sibling}/messages", json={"role": "assistant", "content": "SIBLING SECRET"})
    child = fork(client, root, anchor)
    data = client.get(f"/threads/{child}").json()
    assert "| Command | Purpose |" in data["content"]
    assert "| :--- | ---: |" in data["content"]
    assert "/help" in data["content"] and "/plan" in data["content"]
    assert "/diff" not in data["content"]
    assert "After table" not in data["content"] and "SIBLING SECRET" not in data["content"]
    inherited_table = next(chunk for chunk in data["chunks"] if chunk["table_rows"])
    assert inherited_table["id"] == table["id"]
    assert inherited_table["is_ancestor"]
    assert [row["id"] for row in inherited_table["table_rows"]] == [
        row["id"] for row in table["table_rows"][:2]
    ]
    with patch("main.ask_copilot", return_value="Child response") as ask:
        client.post(f"/threads/{child}/messages", json={"role": "user", "content": "Explain this"})
        prompt = ask.call_args.args[1]
        assert "/plan" in prompt and "/diff" not in prompt and "SIBLING SECRET" not in prompt
    child_data = client.get(f"/threads/{child}").json()
    own_anchor = next(chunk["id"] for chunk in child_data["chunks"] if chunk["text"] == "**assistant:** Child response")
    grandchild = fork(client, child, own_anchor, "Grandchild")
    assert "/diff" not in client.get(f"/threads/{grandchild}").json()["content"]
    assert main.store.load_meta(child).forked_from["chunk_id"] == anchor
    assert {"thread_id": child, "chunk_id": anchor} in main.store.load_meta(root).forked_children
    assert {"source": root, "target": child, "chunk_id": anchor} in client.get("/graph").json()["edges"]
    assert anchor in (main.VAULT_ROOT / "index.md").read_text()
    files = client.get(f"/files/{child}").json()
    assert next(thread for thread in files["threads"] if thread["id"] == child)["forked_from"]["chunk_id"] == anchor
    assert "/diff" in client.get(f"/threads/{sibling}").json()["content"]


def test_row_anchor_edit_protects_prefix_but_allows_later_rows(client):
    import main
    root, table = create_table(client)
    fork(client, root, table["table_rows"][1]["id"])
    original = main.store.read_content(root)
    for edited in [
        original.replace("/plan", "/changed"),
        original.replace("/help", "/changed"),
        original.replace("Purpose", "Changed"),
        original.replace("| :--- | ---: |", "| ---: | ---: |"),
        original.replace("| /help | Help |\n", ""),
        original.replace("| /help | Help |", "| inserted | New |\n| /help | Help |"),
    ]:
        assert client.post(f"/threads/{root}/edit", json={"new_content": edited}).status_code == 409
        assert main.store.read_content(root) == original
    edited = original.replace("/diff", "/later").replace("After table", "Later text")
    assert client.post(f"/threads/{root}/edit", json={"new_content": edited}).status_code == 200


def test_row_refork_validates_before_delete_and_keeps_legacy_whole_table(client):
    root, table = create_table(client)
    legacy = fork(client, root, table["id"], "Whole table")
    anchor = table["table_rows"][1]["id"]
    old = fork(client, root, anchor)
    payload = {"old_child_thread_id": old, "chunk_id": anchor + "99", "new_title": "Replacement"}
    assert client.post(f"/threads/{root}/refork", json=payload).status_code == 400
    assert client.get(f"/threads/{old}").status_code == 200
    payload["chunk_id"] = anchor
    response = client.post(f"/threads/{root}/refork", json=payload)
    assert response.status_code == 200
    replacement = response.json()["new_thread"]["id"]
    assert client.get(f"/threads/{old}").status_code == 404
    assert "/diff" not in client.get(f"/threads/{replacement}").json()["content"]
    assert "/diff" in client.get(f"/threads/{legacy}").json()["content"]
    assert client.post(f"/threads/{root}/fork", json={"chunk_id": anchor + "99", "title": "Bad"}).status_code == 400


@pytest.mark.parametrize("legacy_list", [False, True])
def test_interrupted_stream_has_no_final_row_targets(client, legacy_list):
    import main
    root = client.post("/threads", json={"title": "Interrupted"}).json()["id"]
    if legacy_list:
        main.store.append_message(root, "assistant", "- A\n- B")
        main.store.create_thread(
            title="Legacy list branch",
            forked_from={"thread_id": root, "chunk_id": f"{root}#c1"},
        )

    def interrupted(*_args):
        yield {"type": "delta", "content": TABLE[:-4]}
        raise RuntimeError("Synthetic interruption")

    with patch("main.stream_copilot", side_effect=interrupted):
        response = client.post(f"/threads/{root}/messages/stream", json={"role": "user", "content": "Commands"})
    assert '"type": "error"' in response.text
    data = client.get(f"/threads/{root}").json()
    assert not any(chunk["table_rows"] for chunk in data["chunks"])
    chunks = chunk_markdown(main.store.read_content(root), root)
    row = next(row for chunk in chunks for row in chunk.table_rows)
    assert client.post(f"/threads/{root}/fork", json={"chunk_id": row["id"], "title": "Bad"}).status_code == 400
