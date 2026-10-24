import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, type Page } from "../lib/api";
import { formatCurrency, formatDate, daysLabel, labelize } from "../lib/format";
import { Alert, Card, DataTable, Pagination, PageHeader, StatusBadge } from "../components/ui";

interface Row {
  fdr_id: number;
  fdr_reference_number: string;
  bank_name: string;
  institution_name: string;
  deposit_amount: string;
  maturity_date?: string;
  days_since_maturity?: number;
  lifecycle_status: string;
  application_reference?: string | null;
}

export default function NonApplicants() {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["nonapp", page],
    queryFn: () => api.get<Page<Row>>(`/monitoring/matured-no-application?page=${page}&page_size=10`),
  });

  return (
    <div>
      <PageHeader
        title="Matured without application"
        subtitle="Deposits whose maturity date has passed with no release application recorded in this system."
      />
      <div className="mb-4">
        <Alert tone="warn">
          <strong>Review trigger only.</strong> Absence of an application here does not prove the institution has not
          applied through other channels (e.g. the AICTE JFDR portal). A maturity date alone does not establish release
          eligibility.
        </Alert>
      </div>

      <Card>
        <DataTable
          columns={[
            { header: "FDR", render: (r: Row) => <span className="font-medium">{r.fdr_reference_number}</span> },
            { header: "Institution", render: (r: Row) => r.institution_name },
            { header: "Bank", render: (r: Row) => r.bank_name },
            { header: "Amount", render: (r: Row) => formatCurrency(r.deposit_amount), className: "text-right" },
            {
              header: "Matured",
              render: (r: Row) => (
                <span className="whitespace-nowrap">
                  {formatDate(r.maturity_date)}{" "}
                  <span className="text-xs text-slate-400">
                    ({daysLabel(r.days_since_maturity != null ? -Math.abs(r.days_since_maturity) : undefined)})
                  </span>
                </span>
              ),
            },
            { header: "Lifecycle", render: (r: Row) => <StatusBadge value={r.lifecycle_status} /> },
            {
              header: "Application",
              render: (r: Row) =>
                r.application_reference ? (
                  <span className="text-emerald-700">{r.application_reference}</span>
                ) : (
                  <span className="text-rose-600">None recorded</span>
                ),
            },
          ]}
          rows={data?.items ?? []}
          rowKey={(r) => r.fdr_id}
          loading={isLoading}
          error={error ? (error as Error).message : null}
          onRetry={() => refetch()}
          emptyTitle="No matured non-applicants"
          emptyHint="Every matured deposit in this system has a recorded release application."
          onRowClick={(r) => navigate(`/fdrs/${r.fdr_id}`)}
        />
        {data && <Pagination page={data.page} pages={data.pages} total={data.total} onPage={setPage} />}
      </Card>

      <p className="mt-3 text-xs text-slate-400">
        Categories: {labelize("matured_no_application")} is computed from maturity date + absence of an active application.
      </p>
    </div>
  );
}
