import { useMemo } from "react";
import DOMPurify from "dompurify";
import { marked } from "marked";
import type { Token, Tokens } from "marked";
import type { TableRowAnchor } from "./api";
import { BranchIcon } from "./Icons";

function sanitize(html: string) {
  return DOMPurify.sanitize(
    html.replace(/<a /g, '<a target="_blank" rel="noreferrer" '),
    { ADD_ATTR: ["target", "rel"] },
  );
}

function isTable(token: Token): token is Tokens.Table {
  return token.type === "table";
}

export function MarkdownContent({
  content,
  tableRows = [],
  selectedRowId,
  onSelectRow,
  onBranchRow,
  onReforkRow,
  reforkRowIds = [],
}: {
  content: string;
  tableRows?: TableRowAnchor[];
  selectedRowId?: string | null;
  onSelectRow?: (row: TableRowAnchor) => void;
  onBranchRow?: (row: TableRowAnchor) => void;
  onReforkRow?: (row: TableRowAnchor) => void;
  reforkRowIds?: string[];
}) {
  const parts = useMemo(() => {
    const tokens = marked.lexer(content, { gfm: true });
    let tableIndex = 0;
    return tokens.map((token) => isTable(token)
      ? { table: token, tableIndex: tableIndex++ }
      : { html: sanitize(marked.parser(Object.assign([token], { links: tokens.links }))) });
  }, [content]);

  if (!parts.some((part) => part.table)) {
    return <div className="markdown-body-rendered" dangerouslySetInnerHTML={{ __html: parts.map((part) => part.html).join("") }} />;
  }

  return (
    <div className="markdown-body-rendered">
      {parts.map((part, index) => {
        if (!part.table) return <div key={index} className="markdown-fragment" dangerouslySetInnerHTML={{ __html: part.html ?? "" }} />;
        const table = part.table;
        const anchors = tableRows.filter((row) => row.table_index === part.tableIndex);
        const interactive = anchors.length > 0 && !!onBranchRow;
        return (
          <div key={index} className="markdown-table-scroll" role="region" aria-label="Markdown table" tabIndex={0}>
            <table>
              <thead>
                <tr>
                  {table.header.map((cell, column) => (
                    <th key={column} scope="col" style={{ textAlign: table.align[column] ?? undefined }}
                      dangerouslySetInnerHTML={{ __html: sanitize(marked.Parser.parseInline(cell.tokens)) }} />
                  ))}
                  {interactive && <th scope="col" className="table-row-actions">Branch</th>}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((cells, rowIndex) => {
                  const anchor = anchors.find((row) => row.row_index === rowIndex);
                  const selectable = interactive && anchor;
                  return (
                    <tr
                      key={rowIndex}
                      data-chunk-id={anchor?.id}
                      className={anchor && selectedRowId === anchor.id ? "table-row-selected" : undefined}
                      tabIndex={selectable ? 0 : undefined}
                      aria-label={selectable ? `Table row ${rowIndex + 1}` : undefined}
                      onFocus={selectable ? () => onSelectRow?.(anchor) : undefined}
                      onClick={selectable ? (event) => {
                        if ((event.target as HTMLElement).closest("button, a")) return;
                        event.stopPropagation();
                        onSelectRow?.(anchor);
                      } : undefined}
                      onKeyDown={selectable ? (event) => {
                        if (event.target !== event.currentTarget) return;
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          onSelectRow?.(anchor);
                        }
                      } : undefined}
                    >
                      {cells.map((cell, column) => (
                        <td key={column} style={{ textAlign: table.align[column] ?? undefined }}
                          dangerouslySetInnerHTML={{ __html: sanitize(marked.Parser.parseInline(cell.tokens)) }} />
                      ))}
                      {interactive && (
                        <td className="table-row-actions">
                          {anchor && <>
                            <button type="button" aria-label={`Branch from table row ${rowIndex + 1}`}
                              title={`Branch from row ${rowIndex + 1}`}
                              onClick={() => onBranchRow?.(anchor)}><BranchIcon /></button>
                            {reforkRowIds.includes(anchor.id) && (
                              <button type="button" aria-label={`Replace branch from table row ${rowIndex + 1}`}
                                title="Existing branch: replace"
                                onClick={() => onReforkRow?.(anchor)}><BranchIcon /><span>Replace</span></button>
                            )}
                          </>}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}
