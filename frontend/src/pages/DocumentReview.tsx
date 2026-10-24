import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, Download, PlayCircle } from "lucide-react";
import { api, getToken, type DocumentRec, type ExtractedField } from "../lib/api";
import { formatDateTime, labelize } from "../lib/format";
import { Alert, Badge, Card, DataTable, ErrorState, PageHeader, Spinner, StatusBadge, useToast } from "../components/ui";

interface ProcessResult {
  document: DocumentRec;
  flags_created: number[];
  extracted_text_preview: string;
}

export default function DocumentReview() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const [preview, setPreview] = useState<string | null>(null);

  const doc = useQuery({
    queryKey: ["doc", id],
    queryFn: () => api.get<DocumentRec>(`/documents/${id}`),
  });
  const extractions = useQuery({
    queryKey: ["doc-extractions", id],
    queryFn: () => api.get<ExtractedField[]>(`/documents/${id}/extractions`),
  });

  const process = useMutation({
    mutationFn: () => api.post<ProcessResult>(`/documents/${id}/process`),
    onSuccess: (res) => {
      setPreview(res.extracted_text_preview);
      const n = res.flags_created.length;
      toast.push(n ? `Processed — ${n} discrepancy flag(s) raised.` : "Processed — no new discrepancies.", n ? "info" : "success");
      qc.invalidateQueries({ queryKey: ["doc", id] });
      qc.invalidateQueries({ queryKey: ["doc-extractions", id] });
      qc.invalidateQueries({ queryKey: ["discrepancies"] });
    },
    onError: (e: Error) => toast.push(e.message, "error"),
  });

  const reviewField = useMutation({
    mutationFn: ({ fieldId, status, corrected }: { fieldId: number; status: string; corrected?: string }) =>
      api.patch<ExtractedField>(`/documents/${id}/extractions/${fieldId}`, {
        review_status: status,
        ...(corrected ? { corrected_value: corrected } : {}),
      }),
    onSuccess: () => {
      toast.push("Field reviewed.", "success");
      qc.invalidateQueries({ queryKey: ["doc-extractions", id] });
    },
    onError: (e: Error) => toast.push(e.message, "error"),
  });

  const markReviewed = useMutation({
    mutationFn: () => api.post<DocumentRec>(`/documents/${id}/review`, { review_status: "reviewed", comments: "Reviewed from UI" }),
    onSuccess: () => {
      toast.push("Document marked as reviewed.", "success");
      qc.invalidateQueries({ queryKey: ["doc", id] });
    },
    onError: (e: Error) => toast.push(e.message, "error"),
  });

  async function download() {
    try {
      const headers: Record<string, string> = {};
      const t = getToken();
      if (t) headers.Authorization = `Bearer ${t}`;
      const res = await fetch(`/api/v1/documents/${id}/download`, { headers });
      if (!res.ok) throw new Error("Download failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = doc.data?.original_filename ?? "document";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.push((e as Error).message, "error");
    }
  }

  if (doc.isLoading) return <Spinner label="Loading document…" />;
  if (doc.error) return <ErrorState message={(doc.error as Error).message} onRetry={() => doc.refetch()} />;
  const d = doc.data!;

  return (
    <div>
      <button className="mb-3 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700" onClick={() => navigate(-1)}>
        <ArrowLeft className="h-4 w-4" /> Back
      </button>
      <PageHeader
        title={d.original_filename}
        subtitle={`${labelize(d.document_type)} · ${labelize(d.mime_type)} · ${(d.file_size / 1024).toFixed(1)} KB`}
        actions={
          <>
            <button className="btn-secondary" onClick={download}>
              <Download className="h-4 w-4" /> Download
            </button>
            <button className="btn-primary" onClick={() => process.mutate()} disabled={process.isPending}>
              <PlayCircle className="h-4 w-4" /> {process.isPending ? "Processing…" : "Run extraction"}
            </button>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-4 lg:col-span-2">
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <span className="text-sm font-medium text-slate-600">Extraction status:</span>
            <StatusBadge value={d.extraction_status} />
            <span className="text-sm font-medium text-slate-600">Review:</span>
            <StatusBadge value={d.review_status} />
            {d.extraction_status !== "extracted" && (
              <button className="btn-secondary ml-auto" onClick={() => markReviewed.mutate()} disabled={markReviewed.isPending}>
                <CheckCircle2 className="h-4 w-4" /> Mark reviewed
              </button>
            )}
          </div>

          {d.extraction_error && <div className="mb-3"><Alert tone="warn">{d.extraction_error}</Alert></div>}

          <h3 className="mb-1 text-xs font-semibold uppercase text-slate-400">Extracted text</h3>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded bg-slate-50 p-3 text-xs text-slate-700">
            {preview ?? d.extraction_status === "extracted" ? (preview ?? "Run extraction to see the document text.") : "No extracted text stored yet."}
          </pre>

          <h3 className="mb-1 mt-4 text-xs font-semibold uppercase text-slate-400">Extracted fields</h3>
          <DataTable
            columns={[
              { header: "Field", render: (f: ExtractedField) => labelize(f.field_name) },
              { header: "Extracted value", render: (f: ExtractedField) => <span className="font-mono text-xs">{f.extracted_value ?? "—"}</span> },
              {
                header: "Confidence",
                render: (f: ExtractedField) =>
                  f.confidence_score != null ? (
                    <Badge tone={f.confidence_score >= 0.85 ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-amber-50 text-amber-700 border-amber-200"}>
                      {(f.confidence_score * 100).toFixed(0)}%
                    </Badge>
                  ) : (
                    "—"
                  ),
              },
              { header: "Review", render: (f: ExtractedField) => <StatusBadge value={f.review_status} /> },
              {
                header: "Actions",
                render: (f: ExtractedField) => (
                  <div className="flex gap-1">
                    <button
                      className="btn-secondary !px-2 !py-1 text-xs"
                      onClick={() => reviewField.mutate({ fieldId: f.id, status: "confirmed" })}
                      disabled={reviewField.isPending}
                    >
                      Confirm
                    </button>
                    <button
                      className="btn-secondary !px-2 !py-1 text-xs"
                      onClick={() => {
                        const v = window.prompt("Corrected value:", f.normalized_value ?? "");
                        if (v != null) reviewField.mutate({ fieldId: f.id, status: "corrected", corrected: v });
                      }}
                    >
                      Correct
                    </button>
                  </div>
                ),
              },
            ]}
            rows={extractions.data ?? []}
            rowKey={(f) => f.id}
            loading={extractions.isLoading}
            emptyTitle="No fields extracted yet"
            emptyHint="Run extraction to parse fields from the document."
          />
        </Card>

        <Card className="p-4">
          <h3 className="mb-2 text-sm font-semibold text-slate-800">Document metadata</h3>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-2"><dt className="text-slate-400">ID</dt><dd>{d.id}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-slate-400">FDR</dt><dd>{d.fdr_id ? <button className="text-teal-700 hover:underline" onClick={() => navigate(`/fdrs/${d.fdr_id}`)}>#{d.fdr_id}</button> : "—"}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-slate-400">Uploaded by</dt><dd>{d.uploader_name ?? "—"}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-slate-400">Uploaded</dt><dd>{formatDateTime(d.uploaded_at)}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-slate-400">Checksum</dt><dd className="truncate font-mono text-xs">{d.id ? "sha256" : ""}</dd></div>
          </dl>
          <p className="mt-3 text-xs text-slate-400">
            OCR output is a candidate value for review, never proof of authenticity.
          </p>
        </Card>
      </div>
    </div>
  );
}
