"""
Chunking logic per spec D4/D16: block-level split (paragraph, header,
individual list item) is the primary chunk boundary. Chunking is a
RENDERING-TIME concern only (per Feature Breakdown) -- this module never
mutates the stored thread.md, it only computes chunk boundaries + stable IDs
for the display layer and for fork/backlink addressing.
"""
from dataclasses import dataclass, field
import re
from markdown_it import MarkdownIt


_markdown = MarkdownIt("commonmark").enable("table")


@dataclass
class Chunk:
    id: str          # "<thread_id>#c<order>", stable per D16/Q5
    kind: str        # "block" | "span" (span is user-selected at render time, not computed here)
    order: int
    text: str
    table_rows: list[dict] = field(default_factory=list)


def chunk_markdown(text: str, thread_id: str) -> list[Chunk]:
    return chunk_markdown_with_protected_ids(text, thread_id, set())


def chunk_markdown_with_protected_ids(
    text: str,
    thread_id: str,
    protected_chunk_ids: set[str],
) -> list[Chunk]:
    chunks: list[Chunk] = []
    for coarse_order, block in enumerate(_split_into_coarse_blocks(text)):
        coarse_id = f"{thread_id}#c{coarse_order}"
        is_protected = coarse_id in protected_chunk_ids
        parts = [block] if is_protected else _split_list_items(block)
        contains_list = any(_is_list_marker(line) for line in block.split("\n"))
        for part_index, part in enumerate(parts):
            if is_protected or not contains_list:
                chunk_id = coarse_id if part_index == 0 else f"{coarse_id}.{part_index}"
            else:
                chunk_id = f"{coarse_id}.{part_index}"
            chunks.append(Chunk(id=chunk_id, kind="block", order=len(chunks), text=part))
    _attach_table_rows(text, chunks)
    return chunks


def _attach_table_rows(text: str, chunks: list[Chunk]) -> None:
    # Parse the complete document so fenced/indented code cannot become row
    # targets just because the legacy coarse splitter separated its lines.
    source_lines = text.splitlines(keepends=True)
    offsets = [0]
    for line in source_lines:
        offsets.append(offsets[-1] + len(line))
    parse_text = re.sub(r"(?m)^\*\*(?:user|assistant|system):\*\* *", "", text)
    tables: list[tuple[int, int, list[tuple[int, int]]]] = []
    table_start = None
    body = False
    rows: list[tuple[int, int]] = []
    for token in _markdown.parse(parse_text):
        if token.type == "table_open" and token.level == 0:
            table_start = token.map[0]
            rows = []
        elif token.type == "tbody_open" and table_start is not None:
            body = True
        elif token.type == "tr_open" and body and token.map:
            rows.append(tuple(token.map))
        elif token.type == "table_close" and table_start is not None:
            tables.append((offsets[table_start], offsets[table_start + 2], rows))
            table_start = None
            body = False

    cursor = 0
    for chunk in chunks:
        start = text.index(chunk.text, cursor)
        end = start + len(chunk.text)
        cursor = end
        table_index = 0
        for header_start, header_end, rows in tables:
            starts_in_chunk = start <= header_start < end
            trimmed_indent = (
                header_start < start < header_end
                and not text[header_start:start].strip()
            )
            if not starts_in_chunk and not trimmed_indent:
                continue
            header = text[header_start:header_end]
            header = re.sub(r"^\*\*(?:user|assistant|system):\*\* *", "", header)
            for row_index, (row_start, row_end) in enumerate(rows):
                # A legacy list split can bisect a table. Never advertise an
                # address unless its complete header and row live in this chunk.
                row_text = text[offsets[row_start]:offsets[row_end]].rstrip()
                row_stop = offsets[row_start] + len(row_text)
                if row_text and row_stop <= end:
                    chunk.table_rows.append({
                        "id": f"{chunk.id}.row{len(chunk.table_rows)}",
                        "table_index": table_index,
                        "row_index": row_index,
                        "text": header + row_text,
                        "end_offset": row_stop - start,
                    })
            table_index += 1


def chunk_anchors(chunks: list[Chunk]) -> dict[str, str]:
    """Resolve both legacy blocks and row prefixes through one address space."""
    anchors = {}
    for chunk in chunks:
        anchors[chunk.id] = chunk.text
        for row in chunk.table_rows:
            anchors[row["id"]] = chunk.text[:row["end_offset"]].rstrip()
    return anchors


def _split_into_coarse_blocks(text: str) -> list[str]:
    lines = text.split("\n")
    blocks: list[str] = []
    current: list[str] = []

    def flush():
        if current:
            joined = "\n".join(current).strip()
            if joined:
                blocks.append(joined)
            current.clear()

    i = 0
    while i < len(lines):
        line = lines[i]
        is_header = bool(re.match(r"^#{1,6}\s", line))
        if is_header:
            flush()
            current.append(line)
            i += 1
            if i < len(lines) and _is_list_marker(lines[i]):
                while (
                    i < len(lines)
                    and lines[i].strip()
                    and not re.match(r"^#{1,6}\s", lines[i])
                ):
                    current.append(lines[i])
                    i += 1
            flush()
            continue
        if line.strip() == "":
            flush()
            i += 1
            continue
        current.append(line)
        i += 1
    flush()
    return blocks


def _is_list_marker(line: str) -> bool:
    return bool(
        re.match(
            r"^\s*(?:\*\*(?:user|assistant|system):\*\*\s*)?(?:[-*]\s|\d+[.)]\s)",
            line,
        )
    )


def _split_list_items(block: str) -> list[str]:
    lines = block.split("\n")
    parts: list[list[str]] = []
    current: list[str] = []

    def flush():
        if current:
            parts.append(current.copy())
            current.clear()

    for line in lines:
        if _is_list_marker(line):
            flush()
        current.append(line)
    flush()
    return ["\n".join(part).strip() for part in parts if "\n".join(part).strip()]
