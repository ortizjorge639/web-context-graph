"""
Chunking logic per spec D4/D16: block-level split (paragraph, header+bullets,
multi-option lists) is the primary chunk boundary. Chunking is a
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
    blocks = _split_into_blocks(text)
    return [
        Chunk(id=f"{thread_id}#c{i}", kind="block", order=i, text=block)
        for i, block in enumerate(blocks)
    ]


def _split_into_blocks(text: str) -> list[str]:
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
            while i < len(lines) and (
                re.match(r"^\s*[-*]\s", lines[i]) or re.match(r"^\s*\d+[.)]\s", lines[i])
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
