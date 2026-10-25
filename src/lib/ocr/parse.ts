/**
 * Field extraction from OCR / PDF text.
 *
 * These are heuristics that produce *candidate* values for a human to confirm.
 * They never mark a value as verified, and a failure to parse never discards
 * the uploaded document.
 */

export interface ParsedOcrFields {
  fdr_reference_number: string | null;
  issuing_bank: string | null;
  branch_name: string | null;
  deposit_amount: string | null;
  issue_date: string | null;
  maturity_date: string | null;
  institution_name: string | null;
}

export interface ParsedOcrResult {
  fields: ParsedOcrFields;
  confidence: Record<keyof ParsedOcrFields, number | null>;
  /**
   * Provenance: the source line of the document text each candidate value was
   * read from, so a reviewer can see *where* an extracted value came from.
   * Empty when the value could not be tied back to a specific line.
   */
  sources: Record<keyof ParsedOcrFields, string | null>;
}

export interface OcrWord {
  text: string;
  confidence: number;
}

const MONTHS: Record<string, number> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function toIso(year: number, month: number, day: number): string | null {
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  if (year < 100) year += year >= 70 ? 1900 : 2000;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** Converts common Indian receipt date formats into yyyy-mm-dd. */
export function normalizeDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const text = raw.replace(/\s+/g, ' ').trim();

  // ISO: 2025-03-12
  const iso = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) return toIso(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  // Day-month-name: 12 Mar 2025 / 12 March, 2025 / 12-Mar-25
  const named = text.match(/\b(\d{1,2})[\s\-./]*([A-Za-z]{3,9})[\s\-.,/]*(\d{2,4})\b/);
  if (named) {
    const month = MONTHS[named[2].toLowerCase()];
    if (month) return toIso(Number(named[3]), month, Number(named[1]));
  }

  // Month-name-first: Mar 12, 2025
  const namedFirst = text.match(/\b([A-Za-z]{3,9})[\s\-./]*(\d{1,2})[\s\-.,/]*(\d{2,4})\b/);
  if (namedFirst) {
    const month = MONTHS[namedFirst[1].toLowerCase()];
    if (month) return toIso(Number(namedFirst[3]), month, Number(namedFirst[2]));
  }

  // Numeric: 12/03/2025, 12-03-25, 12.03.2025
  const numeric = text.match(/\b(\d{1,2})[\s\-./](\d{1,2})[\s\-./](\d{2,4})\b/);
  if (numeric) {
    let first = Number(numeric[1]);
    let second = Number(numeric[2]);
    const year = Number(numeric[3]);
    // Indian receipts are day-first; only flip when the day cannot be first.
    if (first <= 12 && second > 12) {
      const swap = first;
      first = second;
      second = swap;
    }
    return toIso(year, second, first);
  }

  return null;
}

/** Parses an amount, including Indian grouping, "Rs."/"₹", lakh/crore words. */
export function parseAmount(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let text = raw.toLowerCase().replace(/[₹$]/g, ' ');
  const multiplierMatch = text.match(/\b(lakh|lakhs|lac|lacs|crore|crores|cr)\b/);
  const multiplier = multiplierMatch
    ? /crore|cr\b/.test(multiplierMatch[1])
      ? 10_000_000
      : 100_000
    : 1;
  text = text.replace(/\b(rs|inr|rupees?|lakhs?|lacs?|crores?|cr)\b\.?/g, ' ');
  const match = text.match(/-?\d[\d,]*(?:\.\d{1,2})?/);
  if (!match) return null;
  const numeric = Number(match[0].replace(/,/g, '')) * multiplier;
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return numeric.toFixed(2);
}

function confidenceFor(line: string, words: OcrWord[]): number | null {
  if (!words.length) return null;
  const normalizedLine = line.toLowerCase();
  const matched = words.filter((word) => {
    const token = word.text.trim().toLowerCase();
    return token.length > 1 && normalizedLine.includes(token);
  });
  if (!matched.length) return null;
  const total = matched.reduce((sum, word) => sum + word.confidence, 0);
  return Math.round((total / matched.length) * 10) / 10;
}

function cleanValue(value: string): string {
  return value.replace(/^[\s:.\-–]+/, '').replace(/\s{2,}/g, ' ').replace(/[.,;:]+$/, '').trim();
}

/** Short, single-line excerpt of the document text a value was read from. */
function sourceSnippet(line: string): string | null {
  const normalized = line.replace(/\s+/g, ' ').trim();
  if (!normalized) return null;
  return normalized.length > 240 ? `${normalized.slice(0, 237)}…` : normalized;
}

/**
 * Removes a following label that got joined into the same line when a PDF text
 * layer is flattened (e.g. "Camp, Pune FDR No: ..."). Extraction must never
 * present guessed text as if it were printed on the document.
 */
function trimTrailingLabel(value: string): string {
  return value
    .replace(/\s+(?:fdr|f\.d\.r|fd|deposit|amount|date|maturity|a\/c|account|ifsc|nominee|branch)\b.*$/i, '')
    .trim();
}

function firstMatch(lines: string[], patterns: RegExp[]): { value: string; line: string } | null {
  for (const pattern of patterns) {
    for (const line of lines) {
      const match = line.match(pattern);
      if (match?.[1]) {
        const value = cleanValue(match[1]);
        if (value.length > 0) return { value, line };
      }
    }
  }
  return null;
}

const BANK_LINE = /\b(bank|bank ltd|bank limited)\b/i;

export function parseOcrText(text: string, words: OcrWord[] = []): ParsedOcrResult {
  const lines = (text ?? '')
    .split(/\r?\n+/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length > 0);

  const result: ParsedOcrFields = {
    fdr_reference_number: null,
    issuing_bank: null,
    branch_name: null,
    deposit_amount: null,
    issue_date: null,
    maturity_date: null,
    institution_name: null,
  };
  const confidence: ParsedOcrResult['confidence'] = {
    fdr_reference_number: null,
    issuing_bank: null,
    branch_name: null,
    deposit_amount: null,
    issue_date: null,
    maturity_date: null,
    institution_name: null,
  };
  const sources: ParsedOcrResult['sources'] = {
    fdr_reference_number: null,
    issuing_bank: null,
    branch_name: null,
    deposit_amount: null,
    issue_date: null,
    maturity_date: null,
    institution_name: null,
  };

  const assign = (key: keyof ParsedOcrFields, match: { value: string; line: string } | null) => {
    if (!match) return;
    const value = trimTrailingLabel(match.value);
    if (!value) return;
    result[key] = value;
    confidence[key] = confidenceFor(match.line, words);
    sources[key] = sourceSnippet(match.line);
  };

  // --- Reference number ----------------------------------------------------
  assign(
    'fdr_reference_number',
    firstMatch(lines, [
      /(?:fdr|f\.d\.r|fd|deposit)\s*(?:receipt)?\s*(?:no\.?|number|ref(?:erence)?|ack(?:nowledgement)?)\s*[:#.-]?\s*([A-Za-z0-9][A-Za-z0-9/_.-]{3,40})/i,
      /(?:receipt|reference|ref)\s*(?:no\.?|number)?\s*[:#.-]\s*([A-Za-z0-9][A-Za-z0-9/_.-]{3,40})/i,
      /\b([A-Z]{2,6}[/-]?\d{4,}[A-Z0-9/-]*)\b/,
    ]),
  );

  // --- Issuing bank --------------------------------------------------------
  const bankLine = lines.find((line) => BANK_LINE.test(line) && line.length <= 90);
  if (bankLine) {
    const withoutLabel = bankLine.replace(/^(?:issued\s+by|bank\s*name|name\s+of\s+(?:the\s+)?bank)\s*[:-]?\s*/i, '');
    const bankMatch = withoutLabel.match(/^(.{3,80}?\bbank\b(?:\s+of\s+[a-z .]{2,40})?(?:\s+(?:ltd|limited))?)/i);
    const value = trimTrailingLabel(cleanValue(bankMatch?.[1] ?? withoutLabel));
    if (value.length >= 3) {
      result.issuing_bank = value;
      confidence.issuing_bank = confidenceFor(bankLine, words);
      sources.issuing_bank = sourceSnippet(bankLine);
    }
  }

  // --- Branch --------------------------------------------------------------
  assign(
    'branch_name',
    firstMatch(lines, [
      /branch(?:\s*name)?\s*[:-]\s*([A-Za-z0-9 ,.'()/&-]{2,60})/i,
    ]),
  );

  // --- Institution ---------------------------------------------------------
  const institutionLabel = firstMatch(lines, [
    /(?:in\s+favou?r\s+of|name\s+of\s+(?:the\s+)?institution|institution\s*name)\s*[:-]?\s*([A-Za-z0-9 ,.'()/&-]{3,90})/i,
  ]);
  if (institutionLabel) {
    assign('institution_name', institutionLabel);
  } else {
    const institutionLine = lines.find((line) =>
      /\b(college|university|institute|polytechnic)\b/i.test(line) && line.length <= 100,
    );
    if (institutionLine) {
      result.institution_name = trimTrailingLabel(cleanValue(institutionLine));
      confidence.institution_name = confidenceFor(institutionLine, words);
      sources.institution_name = sourceSnippet(institutionLine);
    }
  }

  // --- Amount --------------------------------------------------------------
  const amountMatch = firstMatch(lines, [
    /(?:deposit(?:ed)?\s+amount|amount\s+(?:of|deposited)|deposit|principal|value\s+of\s+deposit|sum\s+of)\s*[:-]?\s*(?:rs\.?|inr|₹)?\s*([0-9][0-9,]*(?:\.\d{1,2})?)/i,
    /(?:rs\.?|inr|₹)\s*([0-9][0-9,]*(?:\.\d{1,2})?)/i,
  ]);
  if (amountMatch) {
    const parsed = parseAmount(amountMatch.value);
    if (parsed) {
      result.deposit_amount = parsed;
      confidence.deposit_amount = confidenceFor(amountMatch.line, words);
      sources.deposit_amount = sourceSnippet(amountMatch.line);
    }
  }

  // --- Dates ---------------------------------------------------------------
  const allDates: Array<{ value: string; line: string }> = [];
  for (const line of lines) {
    for (const match of line.matchAll(/\b(\d{1,2}[\s./-][A-Za-z0-9]{2,9}[\s.,/-]\d{2,4}|\d{4}-\d{2}-\d{2}|[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{2,4})\b/g)) {
      const parsed = normalizeDate(match[1]);
      if (parsed) allDates.push({ value: parsed, line });
    }
  }

  const issueMatch = firstMatch(lines, [
    /(?:date\s+of\s+(?:issue|deposit)|issue\s+date|deposited\s+on|deposit\s+date)\s*[:-]?\s*([0-9A-Za-z ,./-]{6,20})/i,
  ]);
  if (issueMatch) {
    const parsed = normalizeDate(issueMatch.value);
    if (parsed) {
      result.issue_date = parsed;
      confidence.issue_date = confidenceFor(issueMatch.line, words);
      sources.issue_date = sourceSnippet(issueMatch.line);
    }
  }

  const maturityMatch = firstMatch(lines, [
    /(?:date\s+of\s+maturity|maturity\s+date|maturing\s+on|maturity\s+on|due\s+date)\s*[:-]?\s*([0-9A-Za-z ,./-]{6,20})/i,
  ]);
  if (maturityMatch) {
    const parsed = normalizeDate(maturityMatch.value);
    if (parsed) {
      result.maturity_date = parsed;
      confidence.maturity_date = confidenceFor(maturityMatch.line, words);
      sources.maturity_date = sourceSnippet(maturityMatch.line);
    }
  }

  // Fallback: use the first two plausible dates in the document.
  const uniqueDates = [...new Map(allDates.map((entry) => [entry.value, entry])).values()];
  if (!result.issue_date && uniqueDates.length > 0) {
    result.issue_date = uniqueDates[0].value;
    confidence.issue_date = confidenceFor(uniqueDates[0].line, words);
    sources.issue_date = sourceSnippet(uniqueDates[0].line);
  }
  if (!result.maturity_date && uniqueDates.length > 1) {
    const later = uniqueDates
      .filter((entry) => entry.value !== result.issue_date)
      .sort((a, b) => a.value.localeCompare(b.value))
      .at(-1);
    if (later) {
      result.maturity_date = later.value;
      confidence.maturity_date = confidenceFor(later.line, words);
      sources.maturity_date = sourceSnippet(later.line);
    }
  }

  // --- Sanity checks -------------------------------------------------------
  if (result.issue_date && result.maturity_date && result.issue_date > result.maturity_date) {
    const swap = result.issue_date;
    result.issue_date = result.maturity_date;
    result.maturity_date = swap;
  }

  return { fields: result, confidence, sources };
}
