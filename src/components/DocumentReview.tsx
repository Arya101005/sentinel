import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink, FileText, Minus, Plus, ScanText } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { RULE_LABELS } from '@/lib/discrepancies';
import type { DiscrepancyFlag, FdrDocument, FdrRecord, OcrExtraction } from '@/lib/types';
import type { ParsedOcrFields } from '@/lib/ocr/parse';
import { DISCREPANCY_STATUS_LABELS, formatCurrency, formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Alert, Badge, Button, EmptyState, Spinner } from './ui/primitives';
import { DiscrepancyPanel } from './DiscrepancyPanel';

/**
 * Two-panel review workspace.
 *
 * Left: the stored document itself (short-lived signed URL, zoom, open in a
 * new tab). Right: the submitted record value next to the OCR candidate, its
 * confidence, the source line it was read from, and — underneath — the
 * explainable discrepancy flags with the reviewer's actions.
 *
 * Mismatched fields are highlighted with a one-shot, reduced-motion-aware
 * animation. Nothing here marks a value verified: a candidate stays a
 * candidate until an officer records a decision.
 */

type CompareField = {
  key: keyof ParsedOcrFields;
  label: string;
  submitted: string | null;
  /** True when both values exist and disagree after normalisation. */
  mismatch: (extracted: string, submitted: string | null) => boolean;
  display: (extracted: string) => string;
};

const normalise = (value: string | null | undefined): string => (value ?? '').trim().toLowerCase();

function DocumentPreview({ document }: { document: FdrDocument }) {
  const [scale, setScale] = useState(1);
  const signedUrl = useQuery({
    queryKey: ['fdr-preview-url', document.id],
    staleTime: 4 * 60_000,
    queryFn: async (): Promise<string> => {
      const { data, error } = await supabase.storage.from('fdr-documents').createSignedUrl(document.storage_path, 600);
      if (error || !data) throw new Error(error?.message ?? 'The document link could not be created.');
      return data.signedUrl;
    },
  });

  if (signedUrl.isLoading) return <Spinner label="Opening a secure preview link…" />;
  if (signedUrl.error) {
    return (
      <Alert tone="danger" title="Preview unavailable">
        The signed link could not be created. You can still open the document from the file list above.
      </Alert>
    );
  }

  const isPdf = document.mime_type === 'application/pdf';

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50/70 px-3 py-2">
        <span className="truncate text-xs font-medium text-slate-700">{document.file_name}</span>
        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            aria-label="Zoom out"
            onClick={() => setScale((current) => Math.max(0.6, Math.round((current - 0.15) * 100) / 100))}
          >
            <Minus className="h-3.5 w-3.5" />
          </Button>
          <span className="w-12 text-center text-[11px] text-slate-500">{Math.round(scale * 100)}%</span>
          <Button
            variant="outline"
            size="sm"
            aria-label="Zoom in"
            onClick={() => setScale((current) => Math.min(2, Math.round((current + 0.15) * 100) / 100))}
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => window.open(signedUrl.data, '_blank', 'noopener,noreferrer')}
            title="Open the document in a new tab (the browser's viewer handles paging for PDFs)"
          >
            <ExternalLink className="h-3.5 w-3.5" /> Open
          </Button>
        </div>
      </div>

      <div className="min-h-[320px] flex-1 overflow-auto bg-slate-100 p-3">
        {isPdf ? (
          <object
            data={signedUrl.data}
            type="application/pdf"
            aria-label={`Preview of ${document.file_name}`}
            className="h-[520px] w-full rounded border border-slate-200 bg-white"
            style={{ width: `${scale * 100}%` }}
          >
            <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
              <FileText className="h-6 w-6 text-slate-400" />
              <p className="text-xs text-slate-600">This browser cannot display the PDF inline.</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.open(signedUrl.data, '_blank', 'noopener,noreferrer')}
              >
                <ExternalLink className="h-3.5 w-3.5" /> Open in a new tab
              </Button>
            </div>
          </object>
        ) : (
          <img
            src={signedUrl.data}
            alt={`Preview of ${document.file_name}`}
            className="mx-auto rounded border border-slate-200 bg-white shadow-sm"
            style={{ width: `${scale * 100}%` }}
          />
        )}
      </div>
    </div>
  );
}

export function DocumentReview({ fdr, canReview }: { fdr: FdrRecord; canReview: boolean }) {
  const documentsQuery = useQuery({
    queryKey: ['fdr-documents', fdr.id],
    queryFn: async (): Promise<FdrDocument[]> => {
      const { data, error } = await supabase
        .from('fdr_documents')
        .select('*')
        .eq('fdr_id', fdr.id)
        .order('uploaded_at', { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as FdrDocument[];
    },
  });

  const extractionsQuery = useQuery({
    queryKey: ['fdr-ocr', fdr.id],
    queryFn: async (): Promise<OcrExtraction[]> => {
      const { data, error } = await supabase
        .from('ocr_extractions')
        .select('*')
        .eq('fdr_id', fdr.id)
        .order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as OcrExtraction[];
    },
  });

  const flagsQuery = useQuery({
    queryKey: ['discrepancy-flags', fdr.id],
    queryFn: async (): Promise<DiscrepancyFlag[]> => {
      const { data, error } = await supabase
        .from('discrepancy_flags')
        .select('*')
        .eq('fdr_id', fdr.id)
        .order('detected_at', { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as DiscrepancyFlag[];
    },
  });

  const currentDocument = useMemo(
    () => (documentsQuery.data ?? []).find((document) => document.is_current) ?? null,
    [documentsQuery.data],
  );
  const extraction = useMemo(() => {
    const list = extractionsQuery.data ?? [];
    return list.find((entry) => entry.status === 'completed') ?? null;
  }, [extractionsQuery.data]);

  const fields: CompareField[] = useMemo(
    () => [
      {
        key: 'fdr_reference_number',
        label: 'FDR reference',
        submitted: fdr.fdr_reference_number,
        mismatch: (extracted, submitted) => normalise(extracted) !== normalise(submitted),
        display: (value) => value,
      },
      {
        key: 'issuing_bank',
        label: 'Issuing bank',
        submitted: fdr.issuing_bank,
        mismatch: (extracted, submitted) => normalise(extracted) !== normalise(submitted),
        display: (value) => value,
      },
      {
        key: 'branch_name',
        label: 'Branch',
        submitted: fdr.branch_name,
        mismatch: (extracted, submitted) => normalise(extracted) !== normalise(submitted),
        display: (value) => value,
      },
      {
        key: 'deposit_amount',
        label: 'Deposit amount',
        submitted: String(fdr.deposit_amount),
        mismatch: (extracted, submitted) => {
          const left = Number(String(extracted).replace(/[^0-9.]/g, ''));
          const right = Number(submitted ?? NaN);
          return Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) > 0.009;
        },
        display: (value) => {
          const numeric = Number(String(value).replace(/[^0-9.]/g, ''));
          return Number.isFinite(numeric) && numeric > 0 ? formatCurrency(numeric) : value;
        },
      },
      {
        key: 'issue_date',
        label: 'Issue date',
        submitted: fdr.issue_date,
        mismatch: (extracted, submitted) => extracted !== submitted,
        display: (value) => formatDate(value),
      },
      {
        key: 'maturity_date',
        label: 'Maturity date',
        submitted: fdr.maturity_date,
        mismatch: (extracted, submitted) => extracted !== submitted,
        display: (value) => formatDate(value),
      },
    ],
    [fdr],
  );

  if (documentsQuery.isLoading || extractionsQuery.isLoading) {
    return <Spinner label="Loading the review workspace…" />;
  }

  if (!currentDocument) {
    return (
      <EmptyState
        icon={<ScanText className="h-5 w-5" />}
        title="No document to review"
        description="Upload the FDR receipt above to compare the submitted values with what the document actually says."
      />
    );
  }

  const openFlags = (flagsQuery.data ?? []).filter((flag) => flag.status === 'open' || flag.status === 'under_review');
  const flaggedFields = new Set(openFlags.map((flag) => flag.field_name));

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      {/* Left: the document itself */}
      <section aria-label="Document preview" className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-4 py-3">
          <h3 className="text-sm font-semibold text-navy-900">Document</h3>
          <p className="text-[11px] text-slate-500">
            Private storage · short-lived signed link · nothing is re-uploaded for preview.
          </p>
        </div>
        <DocumentPreview document={currentDocument} />
      </section>

      {/* Right: submitted vs extracted, then the explainable flags and actions */}
      <section aria-label="Field comparison and review" className="space-y-4">
        <div className="rounded-xl border border-slate-200 bg-white">
          <div className="border-b border-slate-100 px-4 py-3">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-navy-900">
              Submitted vs extracted
              <Badge tone="warning">candidates, not conclusions</Badge>
            </h3>
            <p className="text-[11px] text-slate-500">
              Left column: what the institution entered. Right column: what OCR read, with confidence and the source
              line it came from.
            </p>
          </div>

          {!extraction ? (
            <div className="p-4">
              <Alert tone="info" title="No completed extraction yet">
                Run OCR from the panel above to fill the extracted column. The document stays exactly as uploaded and
                you can always enter values manually.
              </Alert>
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {fields.map((field) => {
                const extracted = extraction.fields?.[field.key] ?? null;
                const source = extraction.field_sources?.[field.key] ?? null;
                const confidence = extraction.field_confidence?.[field.key];
                const mismatched = extracted !== null && field.mismatch(extracted, field.submitted);
                const flagged = flaggedFields.has(field.key);
                return (
                  <li
                    key={field.key}
                    className={cn(
                      'grid gap-2 px-4 py-3 sm:grid-cols-2',
                      (mismatched || flagged) && 'bg-amber-50/60',
                      mismatched && 'flag-highlight',
                    )}
                  >
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                        {field.label} — submitted
                      </p>
                      <p className="mt-0.5 break-words text-sm text-slate-800">
                        {field.submitted ?? <span className="text-slate-400">not provided</span>}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                        {field.label} — extracted{' '}
                        {typeof confidence === 'number' && (
                          <span className="text-slate-400">({Math.round(confidence)}% conf.)</span>
                        )}
                      </p>
                      <p className="mt-0.5 break-words text-sm text-slate-800">
                        {extracted ? (
                          field.key === 'deposit_amount' || field.key === 'issue_date' || field.key === 'maturity_date'
                            ? field.display(extracted)
                            : extracted
                        ) : (
                          <span className="text-slate-400">not detected</span>
                        )}
                        {mismatched && (
                          <span className="ml-2 rounded bg-amber-200/80 px-1 py-0.5 text-[10px] font-semibold uppercase text-amber-900">
                            differs
                          </span>
                        )}
                      </p>
                      {source && (
                        <p
                          className="mt-0.5 truncate text-[10px] italic text-slate-400"
                          title={`Read from: ${source}`}
                        >
                          from “{source}”
                        </p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="border-t border-slate-100 px-4 py-2.5 text-[11px] leading-relaxed text-slate-500">
            A match between these columns is an internal consistency check only. It never means the instrument was
            authenticated against a bank or AICTE record.
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-navy-900">Findings and reviewer actions</h3>
              <p className="text-[11px] text-slate-500">
                {openFlags.length > 0
                  ? `${openFlags.length} open finding(s) — each names its rule, values and reason.`
                  : 'No open findings on this record.'}
              </p>
            </div>
            {(flagsQuery.data ?? []).length > 0 && (
              <span className="text-[11px] text-slate-400">
                latest status:{' '}
                {DISCREPANCY_STATUS_LABELS[(flagsQuery.data as DiscrepancyFlag[])[0].status]}
              </span>
            )}
          </div>
          <DiscrepancyPanel fdrId={fdr.id} canReview={canReview} />
          {openFlags.length > 0 && (
            <p className="mt-2 text-[11px] text-slate-500">
              Rules in view:{' '}
              {openFlags
                .map((flag) => RULE_LABELS[flag.rule_code] ?? flag.rule_code)
                .slice(0, 4)
                .join(' · ')}
              {openFlags.length > 4 ? ' …' : ''}
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
