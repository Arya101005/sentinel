export interface CsvColumn<T> {
  key: keyof T | string;
  label: string;
  value?: (row: T) => string | number | null | undefined;
}

function escapeCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let text = String(value);
  // Prevent spreadsheet formula injection from user-supplied text.
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function toCsv<T extends object>(rows: T[], columns: CsvColumn<T>[]): string {
  const header = columns.map((column) => escapeCell(column.label)).join(',');
  const body = rows
    .map((row) =>
      columns
        .map((column) => {
          const raw = column.value
            ? column.value(row)
            : (row as Record<string, unknown>)[column.key as string];
          return escapeCell(raw);
        })
        .join(','),
    )
    .join('\r\n');
  return `${header}\r\n${body}`;
}

export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const stamp = new Date().toISOString().slice(0, 10);
  link.href = url;
  link.download = filename.endsWith('.csv') ? filename : `${filename}-${stamp}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
