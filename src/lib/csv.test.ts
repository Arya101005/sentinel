import { describe, expect, it } from 'vitest';
import { toCsv } from './csv';

interface Row {
  name: string;
  note: string;
  amount: number | null;
}

describe('CSV encoding', () => {
  it('writes a header and escapes special characters', () => {
    const csv = toCsv<Row>(
      [
        { name: 'Normal', note: 'plain', amount: 1000 },
        { name: 'Comma, inside', note: 'He said "hello"', amount: null },
        { name: 'Newline\nhere', note: 'line1\r\nline2', amount: 2.5 },
      ],
      [
        { key: 'name', label: 'Institution' },
        { key: 'note', label: 'Note' },
        { key: 'amount', label: 'Amount (INR)' },
      ],
    );
    expect(csv.split('\r\n')[0]).toBe('Institution,Note,Amount (INR)');
    expect(csv).toContain('"Comma, inside"');
    expect(csv).toContain('"He said ""hello"""');
    expect(csv).toContain('"Newline\nhere"');
    expect(csv.trimEnd().endsWith(',2.5')).toBe(true);
  });

  it('neutralises spreadsheet formula injection', () => {
    const csv = toCsv<Row>([{ name: '=HYPERLINK("http://evil")', note: '+SUM(1)', amount: null }], [
      { key: 'name', label: 'Institution' },
      { key: 'note', label: 'Note' },
      { key: 'amount', label: 'Amount' },
    ]);
    const body = csv.split('\r\n')[1];
    expect(body).not.toMatch(/^=HYPERLINK/);
    expect(body).toContain("'=HYPERLINK");
    expect(body).toContain("'+SUM(1)");
  });

  it('supports computed columns', () => {
    const csv = toCsv<Row>([{ name: 'A', note: '', amount: 1200 }], [
      { key: 'name', label: 'Name' },
      { key: 'amount', label: 'Amount', value: (row) => (row.amount ? row.amount.toFixed(2) : '') },
    ]);
    expect(csv).toContain('A,1200.00');
    expect(csv).toContain('');
  });
});
