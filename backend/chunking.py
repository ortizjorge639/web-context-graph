"""
Chunking logic per spec D4/D16: block-level split (paragraph, header,
individual list item) is the primary chunk boundary. Chunking is a
RENDERING-TIME concern only (per Feature Breakdown) -- this module never
mutates the stored thread.md, it only computes chunk boundaries + stable IDs
for the display layer and for fork/backlink addressing.
"""
from dataclasses import dataclass
import re


@dataclass
class Chunk:
    id: str          # "<thread_id>#c<order>", stable per D16/Q5
    kind: str        # "block" | "span" (span is user-selected at render time, not computed here)
    order: int
    text: str


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
    return chunks


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
