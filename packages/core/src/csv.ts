/** A spreadsheet would run a cell starting with = + - @ (or tab/CR) as a formula; a leading ' keeps it text. */
export function csvCell(value: string): string {
  const v = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** RFC 4180 (CRLF, quoted where needed) with a UTF-8 BOM so Excel reads Vietnamese text correctly. */
export function csvDocument(lines: readonly (readonly string[])[]): string {
  return `\uFEFF${lines.map((cells) => cells.map(csvCell).join(',')).join('\r\n')}\r\n`;
}
