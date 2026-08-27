from chunking import chunk_markdown, Chunk

def test_chunks_by_paragraph():
    text = "First paragraph.\n\nSecond paragraph."
    chunks = chunk_markdown(text, thread_id="t1")
    assert len(chunks) == 2
    assert chunks[0].id == "t1#c0"
    assert chunks[0].kind == "block"
    assert chunks[0].text == "First paragraph."
    assert chunks[1].id == "t1#c1"
    assert chunks[1].text == "Second paragraph."

def test_chunks_header_with_bullets_as_one_block():
    text = "## Options\n- A) do X\n- B) do Y\n- C) do Z"
    chunks = chunk_markdown(text, thread_id="t1")
    assert len(chunks) == 1
    assert chunks[0].kind == "block"
    assert "A) do X" in chunks[0].text

def test_chunk_ids_stable_across_reparse_of_same_text():
    text = "Para one.\n\nPara two."
    c1 = chunk_markdown(text, thread_id="t1")
    c2 = chunk_markdown(text, thread_id="t1")
    assert [c.id for c in c1] == [c.id for c in c2]
