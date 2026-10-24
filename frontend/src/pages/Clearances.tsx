import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, type Page } from "../lib/api";
import { isOfficer, useAuth } from "../lib/auth";
import { formatDateTime, labelize } from "../lib/format";
import { Alert, Card, DataTable, Pagination, PageHeader, StatusBadge } from "../components/ui";

interface Row {
  clearance_id: number;
  application_id: number;
  application_reference: string;
  institution_name: string;
  fdr_reference_number: string;
  clearance_type: string;
  clearance_label: string;
  status: string;
  assigned_unit?: string | null;
  requested_at: string;
  days_pending: number;
  is_overdue: boolean;
  escalation_threshold_days: number;
}

export default function Clearances() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [page, setPage] = useState(1);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["clearances", page],
    queryFn: () => api.get<Page<Row>>(`/monitoring/pending-clearance?page=${page}&page_size=10`),
  });

  return (
    <div>
      <PageHeader
        title="Clearance tracking"
        subtitle="Cases whose required clearances are outstanding, with elapsed time and escalation threshold."
      />
      <div className="mb-4">
        <Alert tone="info">
          Clearance types are illustrative of publicly described processes — not every case requires every clearance.
          Escalation triggers only when the configured threshold is exceeded.
        </Alert>
      </div>

      <Card>
        <DataTable
          columns={[
            {
              header: "Case",
              render: (r: Row) => (
                <button className="font-medium text-teal-700 hover:underline" onClick={() => navigate(`/applications/${r.application_id}`)}>
                  {r.application_reference}
                </button>
              ),
            },
            { header: "Institution", render: (r: Row) => r.institution_name },
            { header: "FDR", render: (r: Row) => r.fdr_reference_number },
            { header: "Clearance", render: (r: Row) => r.clearance_label ?? labelize(r.clearance_type) },
            { header: "Unit", render: (r: Row) => r.assigned_unit ?? "—" },
            { header: "Status", render: (r: Row) => <StatusBadge value={r.status} /> },
            { header: "Requested", render: (r: Row) => formatDateTime(r.requested_at) },
            {
              header: "Days pending",
              render: (r: Row) => (
                <span className={r.is_overdue ? "font-medium text-rose-600" : "text-slate-600"}>
                  {r.days_pending}d{r.is_overdue ? " ⚠" : ""}
                </span>
              ),
              className: "text-right",
            },
          ]}
          rows={data?.items ?? []}
          rowKey={(r) => r.clearance_id}
          loading={isLoading}
          error={error ? (error as Error).message : null}
          onRetry={() => refetch()}
          emptyTitle="No pending clearances"
          emptyHint="No case currently has an outstanding required clearance."
          onRowClick={(r) => navigate(`/applications/${r.application_id}`)}
        />
        {data && <Pagination page={data.page} pages={data.pages} total={data.total} onPage={setPage} />}
      </Card>
      {!isOfficer(user?.role) && (
        <p className="mt-2 text-xs text-slate-400">You can view clearance status; officers record clearance outcomes.</p>
      )}
    </div>
  );
}
