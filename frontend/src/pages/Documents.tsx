import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { UploadCloud } from "lucide-react";
import { api, type DocumentRec, type Page } from "../lib/api";
import { useAuth } from "../lib/auth";
import { formatDateTime, labelize } from "../lib/format";
import { Alert, Card, DataTable, PageHeader, StatusBadge, useToast } from "../components/ui";

const DOC_TYPES = [
  "fdr_receipt",
  "application_form",
  "bank_confirmation",
  "institution_approval",
  "id_proof",
  "supporting",
];

export default function Documents() {
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const { user } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [docType, setDocType] = useState("fdr_receipt");
  const [fdrId, setFdrId] = useState("");
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading, error: loadError, refetch } = useQuery({
    queryKey: ["documents"],
    queryFn: () => api.get<Page<DocumentRec>>("/documents?page_size=50"),
  });

  const upload = useMutation({
    mutationFn: () => {
      const fd = new FormData();
      fd.append("file", file!);
      fd.append("document_type", docType);
      if (fdrId) fd.append("fdr_id", fdrId);
      return api.upload<DocumentRec>("/documents", fd);
    },
    onSuccess: () => {
      toast.push("Document uploaded. Processing is available on the document page.", "success");
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      setError(null);
      qc.invalidateQueries({ queryKey: ["documents"] });
    },
    onError: (e: Error) => {
      setError(e.message);
      toast.push(e.message, "error");
    },
  });

  return (
    <div>
      <PageHeader
        title="Documents"
        subtitle="Upload receipts and supporting files. Type and size are validated server-side; files are stored privately."
      />

      <Card className="mb-4 p-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!file) {
              setError("Choose a file first.");
              return;
            }
            upload.mutate();
          }}
        >
          <div className="grid gap-3 md:grid-cols-4">
            <div className="md:col-span-2">
              <span className="label">File (PDF, PNG or JPEG)</span>
              <input
                ref={fileRef}
                className="input"
                type="file"
                accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                aria-label="Choose file"
              />
              <p className="mt-1 text-xs text-slate-400">Max 10 MB. Content is checked by magic bytes, not extension.</p>
            </div>
            <div>
              <span className="label">Document type</span>
              <select className="input" value={docType} onChange={(e) => setDocType(e.target.value)}>
                {DOC_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {labelize(t)}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col justify-end">
              <span className="label">Link to FDR id (optional)</span>
              <div className="flex gap-2">
                <input
                  className="input"
                  placeholder="e.g. 12"
                  value={fdrId}
                  onChange={(e) => setFdrId(e.target.value.replace(/[^0-9]/g, ""))}
                  aria-label="FDR id"
                />
                <button className="btn-primary shrink-0" type="submit" disabled={upload.isPending || !file}>
                  <UploadCloud className="h-4 w-4" />
                  {upload.isPending ? "Uploading…" : "Upload"}
                </button>
              </div>
            </div>
          </div>
          {error && (
            <div className="mt-3">
              <Alert tone="error">{error}</Alert>
            </div>
          )}
        </form>
      </Card>

      <Card>
        <div className="border-b border-slate-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-800">Uploaded documents</h2>
        </div>
        <DataTable
          columns={[
            { header: "File", render: (d: DocumentRec) => d.original_filename },
            { header: "Type", render: (d: DocumentRec) => labelize(d.document_type) },
            { header: "Extraction", render: (d: DocumentRec) => <StatusBadge value={d.extraction_status} /> },
            { header: "Review", render: (d: DocumentRec) => <StatusBadge value={d.review_status} /> },
            { header: "Uploaded", render: (d: DocumentRec) => formatDateTime(d.uploaded_at) },
          ]}
          rows={data?.items ?? []}
          rowKey={(d) => d.id}
          loading={isLoading}
          error={loadError ? (loadError as Error).message : null}
          onRetry={() => refetch()}
          emptyTitle="No documents uploaded yet"
          emptyHint={user?.role === "institution" ? "Upload a receipt to begin verification." : undefined}
          onRowClick={(d) => navigate(`/documents/${d.id}`)}
        />
      </Card>
    </div>
  );
}
