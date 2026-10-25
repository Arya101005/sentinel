import { useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  Eye,
  FileText,
  Image as ImageIcon,
  RefreshCcw,
  ScanText,
  UploadCloud,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { useLogEvent } from '@/lib/queries';
import { parseOcrText, type ParsedOcrFields } from '@/lib/ocr/parse';
import { runDiscrepancyRules } from '@/lib/verification';
import { validateDocumentFile } from '@/lib/validation';
import { formatDateTime, formatFileSize, humanize } from '@/lib/format';
import type { FdrDocument, FdrRecord, OcrExtraction } from '@/lib/types';
import { errorMessage } from '@/lib/utils';
import { Alert, Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState, Spinner } from './ui/primitives';
import { useToast } from './ui/overlays';

const FIELD_LABELS: Record<keyof ParsedOcrFields, string> = {
  fdr_reference_number: 'FDR reference number',
  issuing_bank: 'Issuing bank',
  branch_name: 'Branch',
  deposit_amount: 'Deposit amount',
  issue_date: 'Issue date',
  maturity_date: 'Maturity date',
  institution_name: 'Institution (from document)',
};

const APPLYABLE_FIELDS = new Set<keyof ParsedOcrFields>([
  'fdr_reference_number',
  'issuing_bank',
  'branch_name',
  'deposit_amount',
  'issue_date',
  'maturity_date',
]);

const OCR_STATUS_TONE = {
  not_processed: 'outline',
  processing: 'info',
  completed: 'success',
  failed: 'danger',
  skipped: 'neutral',
} as const;

interface Progress {
  label: string;
  percent: number;
}

export function DocumentPanel({
  fdr,
  canEdit,
  onApplyField,
  onFlagsUpdated,
}: {
  fdr: FdrRecord;
  canEdit: boolean;
  onApplyField?: (field: keyof ParsedOcrFields, value: string) => void;
  onFlagsUpdated?: () => void;
}) {
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const { push } = useToast();
  const logEvent = useLogEvent();
  const inputRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);

  const documentsQuery = useQuery({
    queryKey: ['fdr-documents', fdr.id],
    queryFn: async (): Promise<FdrDocument[]> => {
      const { data, error: queryError } = await supabase
        .from('fdr_documents')
        .select('*')
        .eq('fdr_id', fdr.id)
        .order('uploaded_at', { ascending: false });
      if (queryError) throw new Error(queryError.message);
      return (data ?? []) as FdrDocument[];
    },
  });

  const extractionsQuery = useQuery({
    queryKey: ['fdr-ocr', fdr.id],
    queryFn: async (): Promise<OcrExtraction[]> => {
      const { data, error: queryError } = await supabase
        .from('ocr_extractions')
        .select('*')
        .eq('fdr_id', fdr.id)
        .order('created_at', { ascending: false });
      if (queryError) throw new Error(queryError.message);
      return (data ?? []) as OcrExtraction[];
    },
  });

  const currentDocument = useMemo(
    () => (documentsQuery.data ?? []).find((document) => document.is_current) ?? null,
    [documentsQuery.data],
  );

  const latestExtraction = useMemo(() => {
    const list = extractionsQuery.data ?? [];
    return list.find((entry) => entry.status === 'completed') ?? list[0] ?? null;
  }, [extractionsQuery.data]);

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['fdr-documents', fdr.id] }),
      queryClient.invalidateQueries({ queryKey: ['fdr-ocr', fdr.id] }),
      queryClient.invalidateQueries({ queryKey: ['discrepancy-flags', fdr.id] }),
      queryClient.invalidateQueries({ queryKey: ['fdr', fdr.id] }),
    ]);
    onFlagsUpdated?.();
  };

  const processDocument = async (document: FdrDocument) => {
    setProcessingId(document.id);
    setError(null);
    setProgress({ label: 'Downloading the stored document…', percent: 3 });
    try {
      const { data: blob, error: downloadError } = await supabase.storage
        .from('fdr-documents')
        .download(document.storage_path);
      if (downloadError || !blob) {
        throw new Error(downloadError?.message ?? 'The stored document could not be downloaded.');
      }

      const file = new File([blob], document.file_name, { type: document.mime_type });
      setProgress({ label: 'Loading the OCR engine…', percent: 6 });
      const { extractDocumentText } = await import('@/lib/ocr/engine');
      const result = await extractDocumentText(file, (update) =>
        setProgress({ label: update.message, percent: Math.max(6, update.progress) }),
      );

      const parsed = parseOcrText(result.text, result.words);
      setProgress({ label: 'Saving extracted values…', percent: 96 });

      const { error: extractionError } = await supabase.from('ocr_extractions').insert({
        document_id: document.id,
        fdr_id: fdr.id,
        engine: result.engine,
        status: 'completed',
        raw_text: result.text.slice(0, 200_000),
        fields: parsed.fields,
        field_confidence: parsed.confidence,
        average_confidence: result.meanConfidence,
        processed_by: profile?.id ?? null,
      });
      if (extractionError) throw new Error(extractionError.message);

      await supabase.from('fdr_documents').update({ ocr_status: 'completed' }).eq('id', document.id);

      await runDiscrepancyRules(fdr, {
        hasDocument: true,
        ocr: {
          fields: parsed.fields,
          average_confidence: result.meanConfidence,
          engine: result.engine,
        },
      });

      await logEvent.mutateAsync({
        action: 'document.ocr_processed',
        entity_type: 'fdr_documents',
        entity_id: document.id,
        summary: `OCR processed ${document.file_name} (${result.engine})`,
        metadata: {
          engine: result.engine,
          pages: result.pages,
          average_confidence: result.meanConfidence,
          fields_found: Object.entries(parsed.fields)
            .filter(([, value]) => Boolean(value))
            .map(([key]) => key),
        },
      });

      setProgress({ label: 'Completed', percent: 100 });
      push({
        title: 'Document processed',
        description:
          'Extracted values are candidates only. Review them against the document; nothing is marked authentic by OCR.',
        tone: 'success',
      });
      await refresh();
    } catch (processingError) {
      const message = errorMessage(processingError);
      setError(message);
      await supabase.from('fdr_documents').update({ ocr_status: 'failed' }).eq('id', document.id);
      await supabase.from('ocr_extractions').insert({
        document_id: document.id,
        fdr_id: fdr.id,
        engine: 'tesseract.js',
        status: 'failed',
        error_message: message.slice(0, 1000),
        processed_by: profile?.id ?? null,
      });
      push({
        title: 'OCR could not process this document',
        description: `${message} The uploaded document is preserved — you can retry or enter the values manually.`,
        tone: 'error',
      });
      await refresh();
    } finally {
      setProcessingId(null);
      setTimeout(() => setProgress(null), 1500);
    }
  };

  const handleUpload = async (file: File) => {
    const validationError = validateDocumentFile(file);
    if (validationError) {
      setError(validationError);
      push({ title: 'File rejected', description: validationError, tone: 'error' });
      return;
    }
    setError(null);
    setProgress({ label: 'Uploading to private storage…', percent: 15 });
    try {
      const extension = file.name.split('.').pop()?.toLowerCase() ?? 'bin';
      const path = `${fdr.institution_id}/${fdr.id}/${crypto.randomUUID()}.${extension}`;

      const { error: uploadError } = await supabase.storage
        .from('fdr-documents')
        .upload(path, file, { contentType: file.type, cacheControl: '3600', upsert: false });
      if (uploadError) throw new Error(uploadError.message);

      await supabase
        .from('fdr_documents')
        .update({ is_current: false, replaced_at: new Date().toISOString() })
        .eq('fdr_id', fdr.id)
        .eq('is_current', true);

      const { data: inserted, error: insertError } = await supabase
        .from('fdr_documents')
        .insert({
          fdr_id: fdr.id,
          institution_id: fdr.institution_id,
          storage_path: path,
          file_name: file.name.slice(0, 200),
          mime_type: file.type,
          size_bytes: file.size,
          document_type: 'fdr_receipt',
          is_current: true,
          ocr_status: 'processing',
          uploaded_by: profile?.id ?? null,
        })
        .select('*')
        .single();
      if (insertError) throw new Error(insertError.message);

      await logEvent.mutateAsync({
        action: 'document.uploaded',
        entity_type: 'fdr_documents',
        entity_id: (inserted as FdrDocument).id,
        summary: `Uploaded ${file.name} (${formatFileSize(file.size)})`,
        metadata: { fdr_id: fdr.id, mime_type: file.type, size_bytes: file.size },
      });

      await refresh();
      await processDocument(inserted as FdrDocument);
    } catch (uploadError) {
      const message = errorMessage(uploadError);
      setError(message);
      setProgress(null);
      push({ title: 'Upload failed', description: message, tone: 'error' });
    }
  };

  const openDocument = async (document: FdrDocument) => {
    const { data, error: signedUrlError } = await supabase.storage
      .from('fdr-documents')
      .createSignedUrl(document.storage_path, 120);
    if (signedUrlError || !data) {
      push({ title: 'Could not open the document', description: signedUrlError?.message, tone: 'error' });
      return;
    }
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
    void logEvent.mutateAsync({
      action: 'document.viewed',
      entity_type: 'fdr_documents',
      entity_id: document.id,
      summary: `Opened ${document.file_name}`,
    });
  };

  const busy = Boolean(processingId) || progress !== null;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>FDR document</CardTitle>
          <CardDescription>
            PDF, PNG, JPEG or WebP up to 10 MB. Files are stored in a private bucket and accessed through short-lived
            signed links. OCR runs in your browser; the document is not sent to any third-party OCR service.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {canEdit && (
            <div>
              <input
                ref={inputRef}
                type="file"
                accept="application/pdf,image/png,image/jpeg,image/webp"
                className="sr-only"
                aria-label="Upload FDR document"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  if (file) void handleUpload(file);
                }}
              />
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                disabled={busy}
                className="flex w-full items-center gap-3 rounded-lg border border-dashed border-slate-300 bg-slate-50/60 px-4 py-4 text-left transition hover:border-navy-300 hover:bg-navy-50/40 disabled:opacity-60"
              >
                <span className="rounded-md bg-white p-2 text-navy-700 ring-1 ring-slate-200">
                  <UploadCloud className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-navy-900">
                    {currentDocument ? 'Replace the current document' : 'Upload the FDR receipt'}
                  </span>
                  <span className="block text-xs text-slate-500">
                    The previous file is retained and marked as replaced so the history is traceable.
                  </span>
                </span>
              </button>
            </div>
          )}

          {progress && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs text-slate-600">
                <span>{progress.label}</span>
                <span>{progress.percent}%</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                <div
                  className="h-full rounded-full bg-navy-700 transition-all"
                  style={{ width: `${progress.percent}%` }}
                />
              </div>
            </div>
          )}

          {error && (
            <Alert tone="danger" title="Document processing problem">
              <p>{error}</p>
              {currentDocument && canEdit && (
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2"
                  disabled={busy}
                  onClick={() => void processDocument(currentDocument)}
                >
                  <RefreshCcw className="h-3.5 w-3.5" /> Retry OCR
                </Button>
              )}
            </Alert>
          )}

          {documentsQuery.isLoading ? (
            <Spinner label="Loading documents…" />
          ) : (documentsQuery.data ?? []).length === 0 ? (
            <EmptyState
              icon={<FileText className="h-5 w-5" />}
              title="No document uploaded"
              description="Without a document an officer can record a verification decision, but the record will remain flagged as missing supporting evidence."
            />
          ) : (
            <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
              {(documentsQuery.data ?? []).map((document) => (
                <li key={document.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                  <span className="rounded bg-slate-100 p-1.5 text-slate-600">
                    {document.mime_type === 'application/pdf' ? (
                      <FileText className="h-4 w-4" />
                    ) : (
                      <ImageIcon className="h-4 w-4" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-navy-900">
                      {document.file_name}
                      {!document.is_current && (
                        <span className="ml-2 text-[10px] font-medium uppercase text-slate-400">replaced</span>
                      )}
                    </p>
                    <p className="text-[11px] text-slate-500">
                      {formatFileSize(document.size_bytes)} · uploaded {formatDateTime(document.uploaded_at)}
                    </p>
                  </div>
                  <Badge tone={OCR_STATUS_TONE[document.ocr_status]}>{humanize(document.ocr_status)}</Badge>
                  <div className="flex items-center gap-1">
                    <Button variant="outline" size="sm" onClick={() => void openDocument(document)}>
                      <Eye className="h-3.5 w-3.5" /> View
                    </Button>
                    {canEdit && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        onClick={() => void processDocument(document)}
                        title="Run OCR again and re-run verification rules"
                      >
                        <ScanText className="h-3.5 w-3.5" />
                        {processingId === document.id ? 'Processing…' : 'OCR'}
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Automatically extracted values
            <Badge tone="warning">unverified</Badge>
          </CardTitle>
          <CardDescription>
            These values are read from the document by OCR and are not confirmed. Compare them with the submitted record
            before applying any change. A successful OCR read is not proof that the FDR is authentic.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {extractionsQuery.isLoading ? (
            <Spinner label="Loading extraction history…" />
          ) : !latestExtraction ? (
            <EmptyState
              icon={<ScanText className="h-5 w-5" />}
              title="No extraction yet"
              description="Upload a document and run OCR to see extracted candidates alongside the submitted values."
            />
          ) : latestExtraction.status === 'failed' ? (
            <Alert tone="warning" title="The last extraction attempt failed">
              <p>{latestExtraction.error_message ?? 'Unknown OCR error.'}</p>
              <p className="mt-1.5">
                The document is preserved. You can retry OCR or enter the field values manually — nothing was overwritten.
              </p>
            </Alert>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                <span>
                  Engine: <strong>{latestExtraction.engine}</strong>
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  Average confidence:{' '}
                  <strong>
                    {latestExtraction.average_confidence === null
                      ? 'not applicable (PDF text layer)'
                      : `${latestExtraction.average_confidence}%`}
                  </strong>
                </span>
                <span aria-hidden="true">·</span>
                <span>{formatDateTime(latestExtraction.created_at)}</span>
              </div>

              <div className="table-shell">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Field</th>
                      <th>Extracted (candidate)</th>
                      <th>Confidence</th>
                      {canEdit && <th className="text-right">Action</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {(Object.keys(FIELD_LABELS) as Array<keyof ParsedOcrFields>).map((field) => {
                      const value = latestExtraction.fields?.[field] ?? null;
                      const confidence = latestExtraction.field_confidence?.[field];
                      return (
                        <tr key={field}>
                          <td className="whitespace-nowrap text-xs font-medium text-slate-600">{FIELD_LABELS[field]}</td>
                          <td className="text-xs">
                            {value ?? <span className="text-slate-400">not detected</span>}
                          </td>
                          <td className="text-xs text-slate-500">
                            {typeof confidence === 'number' ? `${Math.round(confidence)}%` : '—'}
                          </td>
                          {canEdit && (
                            <td className="text-right">
                              {value && APPLYABLE_FIELDS.has(field) && onApplyField ? (
                                <Button variant="ghost" size="sm" onClick={() => onApplyField(field, value)}>
                                  Use value
                                </Button>
                              ) : null}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <details className="rounded-md border border-slate-200 bg-slate-50/60 p-3">
                <summary className="cursor-pointer text-xs font-medium text-slate-600">Raw recognised text</summary>
                <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap break-words text-[11px] leading-relaxed text-slate-600">
                  {latestExtraction.raw_text?.slice(0, 6000) ?? 'No text captured.'}
                </pre>
              </details>

              <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-slate-500">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                The comparison of these values with the submitted record is recorded as explainable discrepancy flags for
                official review. It is not an authenticity decision.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
