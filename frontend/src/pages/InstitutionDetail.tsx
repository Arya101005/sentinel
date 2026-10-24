import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { api, type Fdr, type Institution, type Page } from "../lib/api";
import { formatCurrency, formatDate, daysLabel } from "../lib/format";
import { Card, DataTable, ErrorState, KpiCard, PageHeader, Spinner, StatusBadge } from "../components/ui";

interface InstitutionDetailT extends Institution {
  active_fdr_count: number;
  matured_without_application: number;
  open_discrepancies: number;
  open_applications: number;
}

export default function InstitutionDetail() {
  const { id } = useParams();
  const navigate = useNavigate();

  const detail = useQuery({
    queryKey: ["institution", id],
    queryFn: () => api.get<InstitutionDetailT>(`/institutions/${id}`),
  });
  const fdrs = useQuery({
    queryKey: ["institution-fdrs", id],
    queryFn: () => api.get<Page<Fdr>>(`/fdr-records?institution_id=${id}&page_size=50`),
  });

  if (detail.isLoading) return <Spinner label="Loading institution…" />;
  if (detail.error) return <ErrorState message={(detail.error as Error).message} onRetry={() => detail.refetch()} />;
  const inst = detail.data!;

  return (
    <div>
      <button className="mb-3 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700" onClick={() => navigate(-1)}>
        <ArrowLeft className="h-4 w-4" /> Back
      </button>
      <PageHeader title={inst.institution_name} subtitle={`${inst.institution_code} · ${inst.region} · ${inst.institution_type}`} />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Active FDRs" value={inst.active_fdr_count} onClick={() => navigate(`/fdrs`)} />
        <KpiCard
          label="Matured w/o application"
          value={inst.matured_without_application}
          severity={inst.matured_without_application ? "high" : undefined}
          onClick={() => navigate("/non-applicants")}
        />
        <KpiCard label="Open discrepancies" value={inst.open_discrepancies} severity={inst.open_discrepancies ? "medium" : undefined} onClick={() => navigate("/discrepancies")} />
        <KpiCard label="Open applications" value={inst.open_applications} onClick={() => navigate("/applications")} />
      </div>

      <Card className="mt-4 p-5">
        <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
          <div><dt className="text-xs uppercase text-slate-400">Contact email</dt><dd className="text-sm text-slate-700">{inst.contact_email ?? "—"}</dd></div>
          <div><dt className="text-xs uppercase text-slate-400">Phone</dt><dd className="text-sm text-slate-700">{inst.contact_phone ?? "—"}</dd></div>
          <div className="sm:col-span-2"><dt className="text-xs uppercase text-slate-400">Address</dt><dd className="text-sm text-slate-700">{inst.address ?? "—"}</dd></div>
        </dl>
        {inst.is_demo && <p className="mt-3 text-xs text-amber-600">Synthetic demo institution.</p>}
      </Card>

      <Card className="mt-4">
        <div className="border-b border-slate-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-800">FDR records</h2>
        </div>
        <DataTable
          columns={[
            { header: "Reference", render: (r: Fdr) => r.fdr_reference_number },
            { header: "Bank", render: (r: Fdr) => r.bank_name },
            { header: "Amount", render: (r: Fdr) => formatCurrency(r.deposit_amount), className: "text-right" },
            {
              header: "Maturity",
              render: (r: Fdr) => (
                <span className="whitespace-nowrap">
                  {formatDate(r.maturity_date)}{" "}
                  {r.days_to_maturity != null && <span className="text-xs text-slate-400">({daysLabel(r.days_to_maturity)})</span>}
                </span>
              ),
            },
            { header: "Lifecycle", render: (r: Fdr) => <StatusBadge value={r.lifecycle_status} /> },
          ]}
          rows={fdrs.data?.items ?? []}
          rowKey={(r) => r.id}
          loading={fdrs.isLoading}
          emptyTitle="No FDR records for this institution"
          onRowClick={(r) => navigate(`/fdrs/${r.id}`)}
        />
      </Card>
    </div>
  );
}
