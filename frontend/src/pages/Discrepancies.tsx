import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Discrepancy, type Page } from "../lib/api";
import { isOfficer, useAuth } from "../lib/auth";
import { labelize } from "../lib/format";
import {
  Badge,
  Card,
  DataTable,
  Modal,
  Pagination,
  PageHeader,
  StatusBadge,
  useToast,
} from "../components/ui";

const STATUSES = ["", "open", "confirmed", "correction_requested", "resolved", "dismissed"];
const TYPES = [
  "",
  "amount_mismatch",
  "date_mismatch",
  "reference_mismatch",
  "bank_mismatch",
  "institution_mismatch",
  "missing_field",
  "potential_duplicate",
  "extraction_failed",
];

type ActionKind = "confirm" | "resolve" | "dismiss" | "request-correction";

export default function Discrepancies() {
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const { user } = useAuth();
  const officer = isOfficer(user?.role);

  const [status, setStatus] = useState("open");
  const [type, setType] = useState("");
  const [page, setPage] = useState(1);
  const [action, setAction] = useState<{ kind: ActionKind; flag: Discrepancy } | null>(null);
  const [note, setNote] = useState("");

  const qs = new URLSearchParams({ page: String(page), page_size: "10" });
  if (status) qs.set("status", status);
  if (type) qs.set("type", type);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["discrepancies", qs.toString()],
    queryFn: () => api.get<Page<Discrepancy>>(`/discrepancies?${qs.toString()}`),
  });

  const runAction = useMutation({
    mutationFn: () => {
      const { kind, flag } = action!;
      const path = `/discrepancies/${flag.id}/${kind}`;
      if (kind === "resolve") return api.post(path, { resolution_notes: note });
      if (kind === "dismiss") return api.post(path, { reason: note });
      if (kind === "request-correction") return api.post(path, { requested_changes: note });
      return api.post(path, { resolution_notes: note });
    },
    onSuccess: () => {
      toast.push(`Discrepancy ${action?.kind === "request-correction" ? "correction requested" : action?.kind + "d"}.`, "success");
      setAction(null);
      setNote("");
      qc.invalidateQueries({ queryKey: ["discrepancies"] });
      qc.invalidateQueries({ queryKey: ["dashboard-summary"] });
    },
    onError: (e: Error) => toast.push(e.message, "error"),
  });

  const needsNote = Boolean(
    action && (action.kind === "resolve" || action.kind === "dismiss" || action.kind === "request-correction"),
  );

  return (
    <div>
      <PageHeader
        title="Discrepancy queue"
        subtitle="Potential mismatches between submitted data and document extraction. Flags are for review — never auto-rejected."
      />

      <Card className="mb-4 p-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <select className="input" aria-label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>{s ? labelize(s) : "All (open + active)"}</option>
            ))}
          </select>
          <select className="input" aria-label="Type" value={type} onChange={(e) => { setType(e.target.value); setPage(1); }}>
            {TYPES.map((t) => (
              <option key={t} value={t}>{t ? labelize(t) : "All types"}</option>
            ))}
          </select>
          <div className="flex items-center text-sm text-slate-500">{data?.total ?? 0} flag(s)</div>
        </div>
      </Card>

      <Card>
        <DataTable
          columns={[
            {
              header: "FDR",
              render: (d: Discrepancy) => (
                <button className="font-medium text-teal-700 hover:underline" onClick={() => d.fdr_id && navigate(`/fdrs/${d.fdr_id}`)}>
                  {d.fdr_reference_number ?? `#${d.fdr_id ?? "—"}`}
                </button>
              ),
            },
            { header: "Institution", render: (d: Discrepancy) => d.institution_name ?? "—" },
            { header: "Type", render: (d: Discrepancy) => <Badge>{labelize(d.discrepancy_type)}</Badge> },
            { header: "Severity", render: (d: Discrepancy) => <StatusBadge value={d.severity} /> },
            {
              header: "Submitted → Extracted",
              render: (d: Discrepancy) => (
                <span className="text-xs">
                  <span className="font-mono">{d.submitted_value ?? "—"}</span>
                  <span className="mx-1 text-slate-400">→</span>
                  <span className="font-mono">{d.extracted_value ?? "—"}</span>
                </span>
              ),
            },
            { header: "Status", render: (d: Discrepancy) => <StatusBadge value={d.status} /> },
            {
              header: "Actions",
              render: (d: Discrepancy) =>
                officer && ["open", "confirmed"].includes(d.status) ? (
                  <div className="flex flex-wrap gap-1">
                    <button className="btn-secondary !px-2 !py-1 text-xs" onClick={() => { setAction({ kind: "confirm", flag: d }); }}>Confirm</button>
                    <button className="btn-primary !px-2 !py-1 text-xs" onClick={() => { setAction({ kind: "resolve", flag: d }); }}>Resolve</button>
                    <button className="btn-secondary !px-2 !py-1 text-xs" onClick={() => { setAction({ kind: "dismiss", flag: d }); }}>Dismiss</button>
                    <button className="btn-secondary !px-2 !py-1 text-xs" onClick={() => { setAction({ kind: "request-correction", flag: d }); }}>Request fix</button>
                  </div>
                ) : (
                  <span className="text-xs text-slate-400">{officer ? "—" : "read-only"}</span>
                ),
            },
          ]}
          rows={data?.items ?? []}
          rowKey={(d) => d.id}
          loading={isLoading}
          error={error ? (error as Error).message : null}
          onRetry={() => refetch()}
          emptyTitle="No discrepancies match these filters"
          emptyHint="No potential mismatches have been flagged for the selected criteria."
        />
        {data && <Pagination page={data.page} pages={data.pages} total={data.total} onPage={setPage} />}
      </Card>

      <Modal
        open={Boolean(action)}
        onClose={() => setAction(null)}
        title={action ? `${labelize(action.kind)} discrepancy` : ""}
        footer={
          <>
            <button className="btn-secondary" onClick={() => setAction(null)}>Cancel</button>
            <button
              className="btn-primary"
              disabled={runAction.isPending || (needsNote && !note.trim())}
              onClick={() => runAction.mutate()}
            >
              {runAction.isPending ? "Saving…" : "Submit"}
            </button>
          </>
        }
      >
        {action && (
          <>
            <p className="mb-2 text-sm text-slate-600">
              {action.flag.explanation ?? "Review the extracted and submitted values before acting."}
            </p>
            <div className="mb-3 rounded border border-slate-200 bg-slate-50 p-2 text-xs">
              <p><span className="text-slate-400">Submitted:</span> <span className="font-mono">{action.flag.submitted_value ?? "—"}</span></p>
              <p><span className="text-slate-400">Extracted:</span> <span className="font-mono">{action.flag.extracted_value ?? "—"}</span></p>
            </div>
            <label className="block">
              <span className="label">
                {action.kind === "dismiss" ? "Reason (required)" : action.kind === "request-correction" ? "Requested changes (required)" : "Resolution notes (required)"}
              </span>
              <textarea className="input" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
            <p className="text-xs text-slate-400">This action is recorded in the audit trail.</p>
          </>
        )}
      </Modal>
    </div>
  );
}
