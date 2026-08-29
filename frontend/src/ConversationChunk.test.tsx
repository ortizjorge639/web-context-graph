import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { ConversationChunk } from "./ConversationChunk";

test("renders assistant GitHub-flavored Markdown", () => {
  render(
    <ConversationChunk
      role="assistant"
      content={"## Answer\n\nUse **bold** text and visit [GitHub](https://github.com).\n\n| A | B |\n| - | - |\n| 1 | 2 |"}
    />,
  );

  expect(screen.getByRole("heading", { name: "Answer" })).toBeInTheDocument();
  expect(screen.getByText("bold").tagName).toBe("STRONG");
  expect(screen.getByRole("link", { name: "GitHub" })).toHaveAttribute("target", "_blank");
  expect(screen.getByRole("table")).toBeInTheDocument();
  expect(screen.queryByText("Lineage App")).not.toBeInTheDocument();
});

test("keeps user Markdown syntax as plain text", () => {
  render(<ConversationChunk role="user" content="**not bold**" />);

  expect(screen.getByText("**not bold**")).toBeInTheDocument();
  expect(screen.queryByText("not bold")).not.toBeInTheDocument();
});

test("sanitizes embedded HTML in assistant Markdown", () => {
  const { container } = render(
    <ConversationChunk
      role="assistant"
      content={'Safe <script>alert("unsafe")</script><img src="x" onerror="alert(1)">'}
    />,
  );

  expect(container.querySelector("script")).not.toBeInTheDocument();
  expect(container.querySelector("img")).not.toHaveAttribute("onerror");
});

test("shows response metrics on an assistant continuation block", () => {
  render(
    <ConversationChunk
      role="content"
      content="Final paragraph."
      metrics={{
        model: "gpt-test",
        input_tokens: 10,
        output_tokens: 3,
        total_tokens: 13,
        elapsed_ms: 900,
        timestamp: "2026-08-28T00:00:00Z",
        first_chunk_order: 1,
        last_chunk_order: 2,
      }}
    />,
  );

  expect(screen.getByText("gpt-test")).toBeInTheDocument();
  expect(screen.getByText("3 tokens")).toBeInTheDocument();
});
