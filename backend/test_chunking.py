from chunking import chunk_markdown, chunk_markdown_with_protected_ids, Chunk

def test_chunks_by_paragraph():
    text = "First paragraph.\n\nSecond paragraph."
    chunks = chunk_markdown(text, thread_id="t1")
    assert len(chunks) == 2
    assert chunks[0].id == "t1#c0"
    assert chunks[0].kind == "block"
    assert chunks[0].text == "First paragraph."
    assert chunks[1].id == "t1#c1"
    assert chunks[1].text == "Second paragraph."

def test_chunks_header_and_each_list_item_separately():
    text = "## Options\n- A) do X\n- B) do Y\n- C) do Z"
    chunks = chunk_markdown(text, thread_id="t1")
    assert [chunk.text for chunk in chunks] == [
        "## Options",
        "- A) do X",
        "- B) do Y",
        "- C) do Z",
    ]
    assert [chunk.id for chunk in chunks] == ["t1#c0.0", "t1#c0.1", "t1#c0.2", "t1#c0.3"]
    assert all(chunk.kind == "block" for chunk in chunks)


def test_ordered_list_item_continuations_stay_with_item():
    text = (
        "Azure AI Foundry best practices:\n\n"
        "1. Architecture/governance - centralize policy.\n"
        "2. Model selection - pick the right model.\n"
        "   Continue this item with evaluation guidance.\n"
        "3. Cost control - route tasks deliberately.\n"
    )
    chunks = chunk_markdown(text, thread_id="t1")
    assert [chunk.text for chunk in chunks] == [
        "Azure AI Foundry best practices:",
        "1. Architecture/governance - centralize policy.",
        "2. Model selection - pick the right model.\n"
        "   Continue this item with evaluation guidance.",
        "3. Cost control - route tasks deliberately.",
    ]
    assert [chunk.id for chunk in chunks] == ["t1#c0", "t1#c1.0", "t1#c1.1", "t1#c1.2"]


def test_header_adjacent_list_item_continuations_stay_with_item():
    chunks = chunk_markdown(
        "## Options\n- A) do X\n  Continue A.\n- B) do Y",
        thread_id="t1",
    )

    assert [chunk.text for chunk in chunks] == [
        "## Options",
        "- A) do X\n  Continue A.",
        "- B) do Y",
    ]
    assert [chunk.id for chunk in chunks] == ["t1#c0.0", "t1#c0.1", "t1#c0.2"]


def test_protected_coarse_chunk_ids_keep_existing_branch_boundaries():
    text = "## Options\n- A) do X\n- B) do Y\n- C) do Z"
    chunks = chunk_markdown_with_protected_ids(
        text,
        thread_id="t1",
        protected_chunk_ids={"t1#c0"},
    )

    assert [chunk.id for chunk in chunks] == ["t1#c0"]
    assert chunks[0].text == text


def test_protected_pure_list_keeps_legacy_coarse_chunk_id():
    text = "Intro\n\n- A) do X\n- B) do Y"
    chunks = chunk_markdown_with_protected_ids(
        text,
        thread_id="t1",
        protected_chunk_ids={"t1#c1"},
    )

    assert [chunk.id for chunk in chunks] == ["t1#c0", "t1#c1"]
    assert chunks[1].text == "- A) do X\n- B) do Y"


def test_role_prefixed_single_list_item_uses_dotted_id():
    chunks = chunk_markdown("**assistant:** - A) do X", thread_id="t1")

    assert [chunk.id for chunk in chunks] == ["t1#c0.0"]
    assert chunks[0].text == "**assistant:** - A) do X"


def test_chunk_ids_stable_across_reparse_of_same_text():
    text = "Para one.\n\nPara two."
    c1 = chunk_markdown(text, thread_id="t1")
    c2 = chunk_markdown(text, thread_id="t1")
    assert [c.id for c in c1] == [c.id for c in c2]
