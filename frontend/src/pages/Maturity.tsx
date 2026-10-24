import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, type Page } from "../lib/api";
import { formatCurrency, formatDate, daysLabel } from "../lib/format";
import { Alert, Card, DataTable, Pagination, PageHeader, StatusBadge } from "../components/ui";

interface Row {
  fdr_id: number;
  fdr_reference_number: string;
  bank_name: string;
  institution_name: string;
  deposit_amount: string;
  maturity_date?: string;
  days_to_maturity?: number;
  verification_status: string;
}

export default function Maturity() {
  const navigate = useNavigate();
  const [threshold, setThreshold] = useState("");
  const [page, setPage] = useState(1);

  const qs = new URLSearchParams({ page: String(page), page_size: "10" });
  if (threshold) qs.set("threshold", threshold);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["upcoming", qs.toString()],
    queryFn: () => api.get<Page<Row>>(`/monitoring/upcoming-maturity?${qs.toString()}`),
  });

  return (
    <div>
      <PageHeader
        title="Upcoming maturity"
        subtitle="Deposits maturing within the configured alert window (demonstration defaults: 90 / 30 / 7 days)."
      />
      <div className="mb-4">
        <Alert tone="info">
          Thresholds are configurable in System settings and are demonstration defaults — not AICTE-mandated intervals.
        </Alert>
      </div>

      <Card className="mb-4 p-3">
        <div className="flex items-center gap-3">
          <span className="text-sm text-slate-600">Alert window:</span>
          <select className="input max-w-xs" value={threshold} onChange={(e) => { setThreshold(e.target.value); setPage(1); }} aria-label="Threshold">
            <option value="">All upcoming</option>
            <option value="7">Within 7 days</option>
            <option value="30">Within 30 days</option>
            <option value="90">Within 90 days</option>
          </select>
          <span className="text-sm text-slate-500">{data?.total ?? 0} deposit(s)</span>
        </div>
      </Card>

      <Card>
        <DataTable
          columns={[
            { header: "FDR", render: (r: Row) => <span className="font-medium">{r.fdr_reference_number}</span> },
            { header: "Institution", render: (r: Row) => r.institution_name },
            { header: "Bank", render: (r: Row) => r.bank_name },
            { header: "Amount", render: (r: Row) => formatCurrency(r.deposit_amount), className: "text-right" },
            {
              header: "Maturity",
              render: (r: Row) => (
                <span className="whitespace-nowrap">
                  {formatDate(r.maturity_date)} <span className="text-xs text-slate-400">({daysLabel(r.days_to_maturity)})</span>
                </span>
              ),
            },
            { header: "Verification", render: (r: Row) => <StatusBadge value={r.verification_status} /> },
          ]}
          rows={data?.items ?? []}
          rowKey={(r) => r.fdr_id}
          loading={isLoading}
          error={error ? (error as Error).message : null}
          onRetry={() => refetch()}
          emptyTitle="No upcoming maturities"
          emptyHint="No deposits mature within the selected window."
          onRowClick={(r) => navigate(`/fdrs/${r.fdr_id}`)}
        />
        {data && <Pagination page={data.page} pages={data.pages} total={data.total} onPage={setPage} />}
      </Card>
    </div>
  );
}
