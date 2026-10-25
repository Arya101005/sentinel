import { supabase } from './supabase';
import { detectDiscrepancies, type DetectedFlag, type OcrSnapshot } from './discrepancies';
import { findLikelyDuplicates } from './duplicates';
import { todayInPolicyZone } from './maturity';
import type { FdrRecord } from './types';

export interface RuleRefreshResult {
  flags: DetectedFlag[];
  persisted: number;
}

/**
 * Runs every deterministic rule for a record and persists the findings through
 * fn_upsert_discrepancy_flags(), which re-checks write access server-side.
 * Reviewed flags are never overwritten by a later automated run.
 */
export async function runDiscrepancyRules(
  fdr: FdrRecord,
  options: { ocr?: OcrSnapshot | null; hasDocument?: boolean; candidatesOnly?: boolean } = {},
): Promise<RuleRefreshResult> {
  let hasDocument = options.hasDocument;
  if (hasDocument === undefined) {
    const { data: documents, error: documentError } = await supabase
      .from('fdr_documents')
      .select('id')
      .eq('fdr_id', fdr.id)
      .eq('is_current', true)
      .limit(1);
    if (documentError) throw new Error(documentError.message);
    hasDocument = (documents ?? []).length > 0;
  }

  let ocr = options.ocr ?? null;
  if (ocr === undefined || options.ocr === null) {
    const { data: extractions, error: extractionError } = await supabase
      .from('ocr_extractions')
      .select('fields, average_confidence, engine')
      .eq('fdr_id', fdr.id)
      .eq('status', 'completed')
      .order('created_at', { ascending: false })
      .limit(1);
    if (extractionError) throw new Error(extractionError.message);
    const latest = extractions?.[0];
    ocr = latest
      ? {
          fields: (latest.fields ?? {}) as OcrSnapshot['fields'],
          average_confidence: latest.average_confidence ?? null,
          engine: latest.engine,
        }
      : null;
  }

  const { data: siblings, error: siblingError } = await supabase
    .from('fdr_records')
    .select('id, fdr_reference_number, issuing_bank, deposit_amount, issue_date, maturity_date')
    .eq('institution_id', fdr.institution_id)
    .is('archived_at', null)
    .limit(300);
  if (siblingError) throw new Error(siblingError.message);

  const candidates = findLikelyDuplicates(
    {
      id: fdr.id,
      fdr_reference_number: fdr.fdr_reference_number,
      issuing_bank: fdr.issuing_bank,
      deposit_amount: fdr.deposit_amount,
      issue_date: fdr.issue_date,
      maturity_date: fdr.maturity_date,
    },
    (siblings ?? []) as never[],
  );

  const flags = detectDiscrepancies(
    {
      ...fdr,
      has_current_document: hasDocument,
      ocr,
      candidates,
    },
    todayInPolicyZone(),
  );

  const { data, error } = await supabase.rpc('fn_upsert_discrepancy_flags', {
    p_fdr_id: fdr.id,
    p_flags: flags,
  });
  if (error) throw new Error(error.message);

  return { flags, persisted: typeof data === 'number' ? data : flags.length };
}
