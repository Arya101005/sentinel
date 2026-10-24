import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ShieldAlert } from "lucide-react";
import { api, type Application, type Clearance, type Page } from "../lib/api";
import { isOfficer, useAuth } from "../lib/auth";
import { formatDateTime, labelize } from "../lib/format";
import {
  Alert,
  Card,
  DataTable,
  Field,
  Modal,
  PageHeader,
  Spinner,
  ErrorState,
  StatusBadge,
  useToast,
} from "../components/ui";

interface TimelineEvent {
  id: number;
  previous_status?: string | null;
  new_status?: string | null;
  event_type: string;
  actor_name?: string | null;
  comments?: string | null;
  created_at: string;
}

const REASON_REQUIRED = new Set(["rejected", "needs_correction", "on_hold"]);

export default function ApplicationDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const { user } = useAuth();
  const officer = isOfficer(user?.role);

  const [target, setTarget] = useState("");
  const [reason, setReason] = useState("");
  const [clearanceEdit, setClearanceEdit] = useState<Clearance | null>(null);
  const [clrStatus, setClrStatus] = useState("cleared");
  const [clrRemarks, setClrRemarks] = useState("");

  const detail = useQuery({
    queryKey: ["app", id],
    queryFn: () => api.get<Application>(`/applications/${id}`),
  });
  const timeline = useQuery({
    queryKey: ["app-timeline", id],
    queryFn: () => api.get<TimelineEvent[]>(`/applications/${id}/timeline`),
  });
  const allowed = useQuery({
    queryKey: ["app-allowed", id],
    queryFn: () => api.get<string[]>(`/applications/${id}/allowed-transitions`),
  });
  const clearances = useQuery({
    queryKey: ["app-clearances", id],
    queryFn: () => api.get<Page<Clearance>>(`/clearances?application_id=${id}&page_size=50`),
  });

  const changeStatus = useMutation({
    mutationFn: () =>
      api.patch<Application>(`/applications/${id}/status`, {
        new_status: target,
        reason: reason || undefined,
        comments: reason || undefined,
      }),
    onSuccess: () => {
      toast.push("Status updated.", "success");
      setTarget("");
      setReason("");
      qc.invalidateQueries({ queryKey: ["app", id] });
      qc.invalidateQueries({ queryKey: ["app-timeline", id] });
      qc.invalidateQueries({ queryKey: ["app-allowed", id] });
      qc.invalidateQueries({ queryKey: ["app-clearances", id] });
    },
    onError: (e: Error) => toast.push(e.message, "error"),
  });

  const saveClearance = useMutation({
    mutationFn: () =>
      api.post<Clearance>(`/clearances/${clearanceEdit!.id}`, { status: clrStatus, remarks: clrRemarks || undefined }),
    onSuccess: () => {
      toast.push("Clearance recorded.", "success");
      setClearanceEdit(null);
      setClrRemarks("");
      qc.invalidateQueries({ queryKey: ["app-clearances", id] });
      qc.invalidateQueries({ queryKey: ["app", id] });
    },
    onError: (e: Error) => toast.push(e.message, "error"),
  });

  if (detail.isLoading) return <Spinner label="Loading application…" />;
  if (detail.error) return <ErrorState message={(detail.error as Error).message} onRetry={() => detail.refetch()} />;
  const app = detail.data!;
  const needsReason = REASON_REQUIRED.has(target);
  const canApply = target && (!needsReason || reason.trim().length >= 3);

  return (
    <div>
      <button className="mb-3 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700" onClick={() => navigate(-1)}>
        <ArrowLeft className="h-4 w-4" /> Back
      </button>

      <PageHeader
        title={app.application_reference}
        subtitle={`${app.institution_name} · FDR ${app.fdr_reference_number ?? `#${app.fdr_id}`}`}
        actions={
          <Link className="btn-secondary" to={`/fdrs/${app.fdr_id}`}>
            View FDR
          </Link>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <StatusBadge value={app.application_status} />
        <span className="text-sm text-slate-500">
          In stage {app.days_in_current_stage} day(s)
          {app.is_overdue && <span className="ml-1 font-medium text-rose-600">· overdue</span>}
        </span>
        {app.assigned_officer_name && <span className="text-sm text-slate-500">· Assigned: {app.assigned_officer_name}</span>}
        {app.missing_document_count ? (
          <span className="text-sm text-amber-600">· {app.missing_document_count} required document(s) missing</span>
        ) : null}
      </div>

      {user?.is_competent_authority && (
        <div className="mb-4">
          <Alert>
            <span className="inline-flex items-center gap-1">
              <ShieldAlert className="h-4 w-4" /> You are a designated competent authority and may approve at the
              authority-decision stage.
            </span>
          </Alert>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {/* Status control */}
          <Card className="p-4">
            <h2 className="mb-2 text-sm font-semibold text-slate-800">Advance workflow</h2>
            {!officer && !user ? null : allowed.data?.length ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Move to">
                  <select className="input" value={target} onChange={(e) => setTarget(e.target.value)}>
                    <option value="">Select next stage…</option>
                    {allowed.data.map((s) => (
                      <option key={s} value={s}>
                        {labelize(s)}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field
                  label={needsReason ? "Reason (required)" : "Reason / comments"}
                  error={needsReason && target && !reason.trim() ? "A reason is required for this action" : undefined}
                >
                  <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this changing?" />
                </Field>
                <div className="sm:col-span-2">
                  <button className="btn-primary" disabled={!canApply || changeStatus.isPending} onClick={() => changeStatus.mutate()}>
                    {changeStatus.isPending ? "Applying…" : "Apply transition"}
                  </button>
                </div>
              </div>
            ) : (
              <p className="text-sm text-slate-500">No transitions are permitted from the current stage for your role.</p>
            )}
            <p className="mt-2 text-xs text-slate-400">
              Advancing to the competent-authority stage is blocked until all required clearances are cleared or waived.
              Only the designated competent authority can approve — administrators cannot bypass this control.
            </p>
          </Card>

          {/* Timeline */}
          <Card>
            <div className="border-b border-slate-200 px-4 py-3">
              <h2 className="text-sm font-semibold text-slate-800">Timeline</h2>
            </div>
            <div className="max-h-96 overflow-y-auto px-4 py-3">
              <ol className="space-y-3">
                {(timeline.data ?? []).map((ev) => (
                  <li key={ev.id} className="border-l-2 border-navy-600 pl-3">
                    <p className="text-sm font-medium text-slate-700">
                      {labelize(ev.event_type)}
                      {ev.previous_status && ev.new_status && ev.previous_status !== ev.new_status && (
                        <span className="text-slate-500">: {labelize(ev.previous_status)} → {labelize(ev.new_status)}</span>
                      )}
                    </p>
                    {ev.comments && <p className="text-xs text-slate-500">{ev.comments}</p>}
                    <p className="text-xs text-slate-400">{ev.actor_name ?? "system"} · {formatDateTime(ev.created_at)}</p>
                  </li>
                ))}
                {!timeline.isLoading && !timeline.data?.length && (
                  <li className="text-sm text-slate-400">No events recorded.</li>
                )}
              </ol>
            </div>
          </Card>
        </div>

        {/* Clearances */}
        <Card>
          <div className="border-b border-slate-200 px-4 py-3">
            <h2 className="text-sm font-semibold text-slate-800">Required clearances</h2>
          </div>
          <div className="p-3">
            {clearances.isLoading && <Spinner />}
            <ul className="space-y-2">
              {(clearances.data?.items ?? []).map((c) => (
                <li key={c.id} className="rounded border border-slate-200 p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-slate-700">{c.clearance_label ?? labelize(c.clearance_type)}</span>
                    <StatusBadge value={c.status} />
                  </div>
                  <p className="mt-0.5 text-xs text-slate-400">{c.assigned_unit}</p>
                  {c.days_pending != null && (
                    <p className="text-xs text-slate-500">
                      {c.days_pending} day(s) pending {c.is_overdue && <span className="text-rose-600">· past threshold</span>}
                    </p>
                  )}
                  {c.remarks && <p className="mt-1 text-xs text-slate-500">{c.remarks}</p>}
                  {officer && c.status !== "cleared" && (
                    <button
                      className="btn-secondary mt-2 !px-2 !py-1 text-xs"
                      onClick={() => {
                        setClearanceEdit(c);
                        setClrStatus("cleared");
                        setClrRemarks(c.remarks ?? "");
                      }}
                    >
                      Record clearance
                    </button>
                  )}
                </li>
              ))}
              {!clearances.isLoading && !clearances.data?.items.length && (
                <li className="text-sm text-slate-400">No clearances recorded for this case.</li>
              )}
            </ul>
          </div>
        </Card>
      </div>

      <Modal
        open={Boolean(clearanceEdit)}
        onClose={() => setClearanceEdit(null)}
        title={`Record clearance — ${clearanceEdit?.clearance_label ?? ""}`}
        footer={
          <>
            <button className="btn-secondary" onClick={() => setClearanceEdit(null)}>Cancel</button>
            <button className="btn-primary" disabled={saveClearance.isPending || (clrStatus !== "cleared" && !clrRemarks.trim())} onClick={() => saveClearance.mutate()}>
              {saveClearance.isPending ? "Saving…" : "Save"}
            </button>
          </>
        }
      >
        <Field label="Status">
          <select className="input" value={clrStatus} onChange={(e) => setClrStatus(e.target.value)}>
            {["cleared", "not_cleared", "waived", "in_progress", "pending"].map((s) => (
              <option key={s} value={s}>{labelize(s)}</option>
            ))}
          </select>
        </Field>
        <Field label="Remarks" hint="Required when a clearance is not cleared or waived.">
          <textarea className="input" rows={3} value={clrRemarks} onChange={(e) => setClrRemarks(e.target.value)} />
        </Field>
        <p className="text-xs text-slate-400">Recorded under your account and written to the audit trail.</p>
      </Modal>
    </div>
  );
}
