import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, ArrowLeft, ExternalLink, Pencil, Plus, ShieldAlert } from "lucide-react";
import {
  api,
  type Application,
  type Discrepancy,
  type DocumentRec,
  type Fdr,
  type Page,
} from "../lib/api";
import { canEdit, useAuth } from "../lib/auth";
import { formatCurrency, formatDate, formatDateTime, daysLabel, labelize } from "../lib/format";
import {
  Alert,
  Badge,
  Card,
  ConfirmDialog,
  DataTable,
  Field,
  Modal,
  PageHeader,
  Spinner,
  ErrorState,
  StatusBadge,
  useToast,
} from "../components/ui";

interface LifecycleEvent {
  id: number;
  event_type: string;
  previous_value?: string | null;
  new_value?: string | null;
  actor_name?: string | null;
  comment?: string | null;
  created_at: string;
}

function Row({ label, value }: { label: string; value?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-slate-100 py-2 sm:flex-row sm:gap-4">
      <dt className="w-48 shrink-0 text-xs font-medium uppercase tracking-wide text-slate-400">
        {label}
      </dt>
      <dd className="text-sm text-slate-700">{value ?? "—"}</dd>
    </div>
  );
}

export default function FdrDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const { user } = useAuth();
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkType, setLinkType] = useState<"renewal" | "replacement">("renewal");
  const [linkRef, setLinkRef] = useState("");
  const [linkAmount, setLinkAmount] = useState("");
  const [linkMaturity, setLinkMaturity] = useState("");

  const detail = useQuery({
    queryKey: ["fdr", id],
    queryFn: () => api.get<Fdr>(`/fdr-records/${id}`),
  });
  const history = useQuery({
    queryKey: ["fdr-history", id],
    queryFn: () => api.get<LifecycleEvent[]>(`/fdr-records/${id}/lifecycle-history`),
  });
  const discrepancies = useQuery({
    queryKey: ["fdr-disc", id],
    queryFn: () => api.get<Page<Discrepancy>>(`/discrepancies?fdr_id=${id}&include_resolved=true`),
  });
  const documents = useQuery({
    queryKey: ["fdr-docs", id],
    queryFn: () => api.get<Page<DocumentRec>>(`/documents?fdr_id=${id}`),
  });
  const applications = useQuery({
    queryKey: ["fdr-apps", id],
    queryFn: () => api.get<Page<Application>>(`/applications?fdr_id=${id}`),
  });

  const archive = useMutation({
    mutationFn: () => api.post<Fdr>(`/fdr-records/${id}/archive`, { reason: "Archived from detail view" }),
    onSuccess: () => {
      toast.push("Record archived.", "success");
      setConfirmArchive(false);
      qc.invalidateQueries({ queryKey: ["fdr", id] });
      qc.invalidateQueries({ queryKey: ["fdrs"] });
    },
    onError: (e: Error) => toast.push(e.message, "error"),
  });

  const link = useMutation({
    mutationFn: () =>
      api.post<Fdr>(`/fdr-records/${id}/link`, {
        link_type: linkType,
        new_fdr: {
          fdr_reference_number: linkRef,
          bank_name: detail.data?.bank_name ?? "",
          deposit_amount: linkAmount,
          maturity_date: linkMaturity || undefined,
          issue_date: new Date().toISOString().slice(0, 10),
        },
        comment: `${linkType} created from detail view`,
      }),
    onSuccess: () => {
      toast.push(`${labelize(linkType)} linked; previous record preserved.`, "success");
      setLinkOpen(false);
      qc.invalidateQueries({ queryKey: ["fdr", id] });
      qc.invalidateQueries({ queryKey: ["fdrs"] });
    },
    onError: (e: Error) => toast.push(e.message, "error"),
  });

  if (detail.isLoading) return <Spinner label="Loading record…" />;
  if (detail.error) return <ErrorState message={(detail.error as Error).message} onRetry={() => detail.refetch()} />;
  const fdr = detail.data!;
  const editable = canEdit(user?.role) && !fdr.archived_at;

  return (
    <div>
      <button className="mb-3 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700" onClick={() => navigate(-1)}>
        <ArrowLeft className="h-4 w-4" /> Back
      </button>

      <PageHeader
        title={fdr.fdr_reference_number}
        subtitle={`${fdr.institution_name ?? ""} · ${fdr.bank_name}`}
        actions={
          editable && (
            <>
              <button className="btn-secondary" onClick={() => navigate(`/fdrs/${id}/edit`)}>
                <Pencil className="h-4 w-4" /> Edit
              </button>
              <button className="btn-secondary" onClick={() => setLinkOpen(true)}>
                <Plus className="h-4 w-4" /> Link {labelize(linkType)}
              </button>
              <button className="btn-secondary" onClick={() => setConfirmArchive(true)}>
                <Archive className="h-4 w-4" /> Archive
              </button>
            </>
          )
        }
      />

      {fdr.is_demo && (
        <div className="mb-4">
          <Alert tone="warn">Synthetic demo record — not a real deposit.</Alert>
        </div>
      )}
      {fdr.archived_at && (
        <div className="mb-4">
          <Alert tone="warn">This record was archived on {formatDateTime(fdr.archived_at)}.</Alert>
        </div>
      )}
      {fdr.link_type && (
        <div className="mb-4">
          <Alert>
            Linked as a <strong>{fdr.link_type}</strong>
            {fdr.renewal_parent_id ? ` of FDR #${fdr.renewal_parent_id}` : ""}. Previous records are
            preserved and excluded from active counts.
          </Alert>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <h2 className="mb-2 text-sm font-semibold text-slate-800">Deposit details</h2>
          <dl>
            <Row label="Reference" value={<span className="font-mono">{fdr.fdr_reference_number}</span>} />
            <Row label="Institution" value={fdr.institution_name} />
            <Row label="Region" value={fdr.region} />
            <Row label="Bank" value={fdr.bank_name} />
            <Row label="Branch" value={fdr.branch_name} />
            <Row label="Deposit amount" value={<span className="font-medium">{formatCurrency(fdr.deposit_amount, true)}</span>} />
            <Row label="Issue date" value={formatDate(fdr.issue_date)} />
            <Row label="Maturity date" value={
              <span>
                {formatDate(fdr.maturity_date)}
                {fdr.days_to_maturity != null && (
                  <span className="ml-2 text-xs text-slate-400">{daysLabel(fdr.days_to_maturity)}</span>
                )}
              </span>
            } />
            <Row label="Lifecycle" value={<StatusBadge value={fdr.lifecycle_status} />} />
            <Row label="Verification" value={<StatusBadge value={fdr.verification_status} />} />
            <Row label="Release status" value={<StatusBadge value={fdr.release_application_status} />} />
            <Row label="Monitoring category" value={fdr.monitoring_category ? labelize(fdr.monitoring_category) : "—"} />
            <Row label="Notes" value={fdr.eligibility_notes ?? fdr.remarks} />
          </dl>
        </Card>

        <div className="space-y-4">
          <Card>
            <div className="border-b border-slate-200 px-4 py-3">
              <h2 className="text-sm font-semibold text-slate-800">Lifecycle history</h2>
            </div>
            <div className="max-h-96 overflow-y-auto px-4 py-3">
              {history.isLoading && <Spinner />}
              <ol className="space-y-3">
                {(history.data ?? []).map((ev) => (
                  <li key={ev.id} className="border-l-2 border-teal-500 pl-3">
                    <p className="text-sm font-medium text-slate-700">{labelize(ev.event_type)}</p>
                    {ev.previous_value && ev.new_value && (
                      <p className="text-xs text-slate-500">
                        {ev.previous_value} → {ev.new_value}
                      </p>
                    )}
                    {ev.comment && <p className="text-xs text-slate-500">{ev.comment}</p>}
                    <p className="text-xs text-slate-400">
                      {ev.actor_name ?? "system"} · {formatDateTime(ev.created_at)}
                    </p>
                  </li>
                ))}
                {!history.isLoading && !history.data?.length && (
                  <li className="text-sm text-slate-400">No history recorded.</li>
                )}
              </ol>
            </div>
          </Card>

          <Card className="p-4">
            <h2 className="mb-2 text-sm font-semibold text-slate-800">Open discrepancies</h2>
            {(discrepancies.data?.items ?? []).length ? (
              <ul className="space-y-2">
                {discrepancies.data!.items.map((d) => (
                  <li key={d.id} className="rounded border border-slate-200 p-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">{labelize(d.discrepancy_type)}</span>
                      <Badge>{d.severity}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">{d.explanation}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-400">No discrepancies on this record.</p>
            )}
            <Link className="mt-2 inline-flex items-center gap-1 text-xs text-teal-700 hover:underline" to="/discrepancies">
              Open queue <ExternalLink className="h-3 w-3" />
            </Link>
          </Card>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <h2 className="text-sm font-semibold text-slate-800">Supporting documents</h2>
            {editable && (
              <button className="btn-secondary" onClick={() => navigate("/documents")}>
                <Plus className="h-4 w-4" /> Upload
              </button>
            )}
          </div>
          <DataTable
            columns={[
              { header: "File", render: (d: DocumentRec) => d.original_filename },
              { header: "Type", render: (d: DocumentRec) => labelize(d.document_type) },
              { header: "Extraction", render: (d: DocumentRec) => <StatusBadge value={d.extraction_status} /> },
            ]}
            rows={documents.data?.items ?? []}
            rowKey={(d) => d.id}
            loading={documents.isLoading}
            emptyTitle="No documents uploaded"
            onRowClick={(d) => navigate(`/documents/${d.id}`)}
          />
        </Card>

        <Card>
          <div className="border-b border-slate-200 px-4 py-3">
            <h2 className="text-sm font-semibold text-slate-800">Release applications</h2>
          </div>
          <DataTable
            columns={[
              { header: "Reference", render: (a: Application) => a.application_reference },
              { header: "Status", render: (a: Application) => <StatusBadge value={a.application_status} /> },
              { header: "Submitted", render: (a: Application) => formatDate(a.submitted_at) },
            ]}
            rows={applications.data?.items ?? []}
            rowKey={(a) => a.id}
            loading={applications.isLoading}
            emptyTitle="No release application recorded"
            emptyHint="A matured deposit without an application appears in the non-applicant queue."
            onRowClick={(a) => navigate(`/applications/${a.id}`)}
          />
        </Card>
      </div>

      <ConfirmDialog
        open={confirmArchive}
        title="Archive FDR record"
        message={`Archive ${fdr.fdr_reference_number}? It will be excluded from active monitoring. History is preserved; this cannot be undone from the UI.`}
        confirmLabel="Archive"
        danger
        busy={archive.isPending}
        onConfirm={() => archive.mutate()}
        onCancel={() => setConfirmArchive(false)}
      />

      <Modal
        open={linkOpen}
        onClose={() => setLinkOpen(false)}
        title={`Link a ${linkType}`}
        footer={
          <>
            <button className="btn-secondary" onClick={() => setLinkOpen(false)}>Cancel</button>
            <button
              className="btn-primary"
              disabled={!linkRef || !linkAmount || link.isPending}
              onClick={() => link.mutate()}
            >
              {link.isPending ? "Linking…" : "Create & link"}
            </button>
          </>
        }
      >
        <p className="mb-3 text-sm text-slate-600">
          The current record is preserved and marked as {linkType === "renewal" ? "renewed" : "replaced"}; the new
          record becomes the active deposit. Neither is overwritten.
        </p>
        <div className="mb-3">
          <span className="label">Link type</span>
          <select className="input" value={linkType} onChange={(e) => setLinkType(e.target.value as "renewal" | "replacement")}>
            <option value="renewal">Renewal</option>
            <option value="replacement">Replacement</option>
          </select>
        </div>
        <Field label="New FDR reference" error={!linkRef ? "Required" : undefined}>
          <input className="input" value={linkRef} onChange={(e) => setLinkRef(e.target.value)} />
        </Field>
        <Field label="Deposit amount (INR)" error={!linkAmount ? "Required" : undefined}>
          <input className="input" type="number" min="1" value={linkAmount} onChange={(e) => setLinkAmount(e.target.value)} />
        </Field>
        <Field label="Maturity date">
          <input className="input" type="date" value={linkMaturity} onChange={(e) => setLinkMaturity(e.target.value)} />
        </Field>
        {fdr.bank_name && (
          <p className="flex items-center gap-1 text-xs text-slate-400">
            <ShieldAlert className="h-3.5 w-3.5" /> Bank defaults to {fdr.bank_name}.
          </p>
        )}
      </Modal>
    </div>
  );
}
