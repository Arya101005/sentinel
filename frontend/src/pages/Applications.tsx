import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { api, type Application, type Page } from "../lib/api";
import { canEdit } from "../lib/auth";
import { useAuth } from "../lib/auth";
import { formatDate, labelize } from "../lib/format";
import { Card, DataTable, Pagination, PageHeader, StatusBadge } from "../components/ui";

const STATUSES = [
  "",
  "draft",
  "submitted",
  "document_checks_pending",
  "under_officer_verification",
  "awaiting_bank_verification",
  "awaiting_clearance",
  "awaiting_authority_decision",
  "approved",
  "release_processing",
  "completed",
  "rejected",
  "on_hold",
];

export default function Applications() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [scope, setScope] = useState("active");

  const qs = new URLSearchParams({ page: String(page), page_size: "10" });
  if (status) qs.set("application_status", status);
  if (scope) qs.set("scope", scope);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["applications", qs.toString()],
    queryFn: () => api.get<Page<Application>>(`/applications?${qs.toString()}`),
  });

  return (
    <div>
      <PageHeader
        title="Release applications"
        subtitle="Track document checks, verification, clearances and authority decisions."
        actions={
          canEdit(user?.role) ? (
            <button className="btn-secondary" onClick={() => navigate("/fdrs")}>
              <Plus className="h-4 w-4" /> New from an FDR
            </button>
          ) : undefined
        }
      />

      <Card className="mb-4 p-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <select className="input" value={scope} onChange={(e) => { setScope(e.target.value); setPage(1); }} aria-label="Scope">
            <option value="active">Active work</option>
            <option value="overdue">Overdue only</option>
            <option value="">All</option>
          </select>
          <select className="input" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Status">
            {STATUSES.map((s) => (
              <option key={s} value={s}>{s ? labelize(s) : "All statuses"}</option>
            ))}
          </select>
          <div className="flex items-center text-sm text-slate-500">{data?.total ?? 0} case(s)</div>
        </div>
      </Card>

      <Card>
        <DataTable
          columns={[
            { header: "Reference", render: (a: Application) => <span className="font-medium">{a.application_reference}</span> },
            { header: "Institution", render: (a: Application) => a.institution_name },
            { header: "FDR", render: (a: Application) => a.fdr_reference_number ?? `#${a.fdr_id}` },
            { header: "Status", render: (a: Application) => <StatusBadge value={a.application_status} /> },
            { header: "Submitted", render: (a: Application) => formatDate(a.submitted_at) },
            {
              header: "Days in stage",
              render: (a: Application) => (
                <span className={a.is_overdue ? "font-medium text-rose-600" : "text-slate-600"}>
                  {a.days_in_current_stage}d{a.is_overdue ? " ⚠" : ""}
                </span>
              ),
            },
            { header: "Assigned", render: (a: Application) => a.assigned_officer_name ?? <span className="text-slate-400">Unassigned</span> },
          ]}
          rows={data?.items ?? []}
          rowKey={(a) => a.id}
          loading={isLoading}
          error={error ? (error as Error).message : null}
          onRetry={() => refetch()}
          emptyTitle="No release applications match these filters"
          onRowClick={(a) => navigate(`/applications/${a.id}`)}
        />
        {data && <Pagination page={data.page} pages={data.pages} total={data.total} onPage={setPage} />}
      </Card>
    </div>
  );
}
