import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { ConversationChunk } from "./ConversationChunk";
import fixtures from "../../fixtures/table-rows.json";

for (const fixture of fixtures) {
  test(`renders row addresses in parser order: ${fixture.name}`, () => {
    const tableRows = fixture.rows.map((row, index) => ({
      ...row, id: `t#c0.row${index}`, text: "", end_offset: 0,
    }));
    const { container } = render(<ConversationChunk role="assistant" content={fixture.markdown}
      tableRows={tableRows} onBranchRow={vi.fn()} />);
    for (const [index, expected] of fixture.rows.entries()) {
      const row = container.querySelector(`[data-chunk-id="t#c0.row${index}"]`);
      expect(row).not.toBeNull();
      expect(Array.from(row!.querySelectorAll("td:not(.table-row-actions)"), (cell) => cell.textContent)).toEqual(expected.cells);
    }
    expect(screen.queryAllByRole("button", { name: /^Branch from table row/ })).toHaveLength(fixture.rows.length);
  });
}

const tableContent = "| Command | Purpose |\n| :--- | ---: |\n| `/help` | [Help](https://example.com) |\n| `/plan` | Plan |";
const tableRows = [
  { id: "t#c1.row0", table_index: 0, row_index: 0, text: "", end_offset: 0 },
  { id: "t#c1.row1", table_index: 0, row_index: 1, text: "", end_offset: 0 },
];

test("selects and branches body rows without selecting the entire table or hijacking links", () => {
  const onSelect = vi.fn();
  const onSelectRow = vi.fn();
  const onBranchRow = vi.fn();
  const onBranch = vi.fn();
  render(<ConversationChunk role="assistant" content={tableContent} tableRows={tableRows}
    onSelect={onSelect} onSelectRow={onSelectRow} onBranchRow={onBranchRow}
    onBranch={onBranch} selectedRowId="t#c1.row1" />);
  expect(screen.getAllByRole("table")).toHaveLength(1);
  fireEvent.click(screen.getByText("/plan"));
  expect(onSelectRow).toHaveBeenLastCalledWith(tableRows[1]);
  expect(onSelect).not.toHaveBeenCalled();
  expect(screen.getByText("/plan").closest("tr")).toHaveClass("table-row-selected");
  expect(screen.getByText("/plan").closest("article")).not.toHaveClass("message-selected");
  expect(screen.getByText("Plan")).toHaveStyle({ textAlign: "right" });
  fireEvent.keyDown(screen.getByRole("row", { name: "Table row 1" }), { key: "Enter" });
  expect(onSelectRow).toHaveBeenLastCalledWith(tableRows[0]);
  onSelectRow.mockClear();
  fireEvent.click(screen.getByRole("link", { name: "Help" }));
  expect(onSelect).not.toHaveBeenCalled();
  expect(onSelectRow).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Branch from table row 2" }));
  expect(onBranchRow).toHaveBeenCalledWith(tableRows[1]);
  fireEvent.click(screen.getByRole("button", { name: "Branch from this chunk" }));
  expect(onBranch).toHaveBeenCalledOnce();
  expect(within(screen.getByRole("row", { name: "Table row 2" })).getByRole("button")).toBeVisible();
});

test("does not expose row actions while streaming or on read-only ancestor content", () => {
  const { rerender } = render(<ConversationChunk role="assistant" content={tableContent} streaming
    tableRows={tableRows} onBranchRow={vi.fn()} />);
  expect(screen.queryByLabelText("Branch from table row 1")).not.toBeInTheDocument();
  rerender(<ConversationChunk role="assistant" content={tableContent} tableRows={tableRows} />);
  expect(screen.queryByLabelText("Branch from table row 1")).not.toBeInTheDocument();
  expect(screen.getByText("/plan").closest("tr")).toHaveAttribute("data-chunk-id", "t#c1.row1");
});

test("sanitizes table cells without breaking inline code or reference links", () => {
  const { container } = render(<ConversationChunk role="assistant"
    content={'| A | B |\n| - | - |\n| <img src=x onerror=alert(1)> | [Help][docs] |\n\n[docs]: https://example.com'} />);
  expect(container.querySelector("img")).not.toHaveAttribute("onerror");
  expect(screen.getByRole("link", { name: "Help" })).toHaveAttribute("href", "https://example.com");
});

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

test("marks a clicked chunk as selectable without hijacking action buttons", () => {
  const onSelect = vi.fn();
  const onBranch = vi.fn();
  const { container } = render(
    <ConversationChunk
      role="assistant"
      content="Branchable answer"
      onSelect={onSelect}
      onBranch={onBranch}
      selected
    />,
  );

  const chunk = container.querySelector(".message-block");
  expect(chunk).toHaveClass("message-selected");
  expect(chunk).toHaveAttribute("aria-selected", "true");

  fireEvent.click(screen.getByText("Branchable answer"));
  expect(onSelect).toHaveBeenCalledTimes(1);

  fireEvent.click(screen.getByLabelText("Branch from this chunk"));
  expect(onBranch).toHaveBeenCalledTimes(1);
  expect(onSelect).toHaveBeenCalledTimes(1);
});
