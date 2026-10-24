import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Plus, Search } from "lucide-react";
import { api, type Fdr, type Page } from "../lib/api";
import { canEdit, useAuth } from "../lib/auth";
import { formatCurrency, formatDate, daysLabel, labelize } from "../lib/format";
import { Card, DataTable, Pagination, PageHeader, StatusBadge } from "../components/ui";

const LIFECYCLES = [
  "",
  "active",
  "matured",
  "renewed",
  "replaced",
  "released",
  "on_hold",
  "archived",
];
const VERIFICATIONS = [
  "",
  "unverified",
  "pending_review",
  "verified",
  "discrepancies_found",
  "manual_review",
];

export default function Fdrs() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();

  const q = params.get("q") ?? "";
  const lifecycle = params.get("lifecycle") ?? "";
  const verification = params.get("verification") ?? "";
  const page = Number(params.get("page") ?? "1");
  const [search, setSearch] = useState(q);

  const queryString = useMemo(() => {
    const p = new URLSearchParams({ page: String(page), page_size: "10", sort_by: "maturity_date" });
    if (q) p.set("q", q);
    if (lifecycle) p.set("lifecycle", lifecycle);
    if (verification) p.set("verification", verification);
    return p.toString();
  }, [q, lifecycle, verification, page]);

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["fdrs", queryString],
    queryFn: () => api.get<Page<Fdr>>(`/fdr-records?${queryString}`),
  });

  function update(next: Record<string, string>) {
    const p = new URLSearchParams(params);
    Object.entries(next).forEach(([k, v]) => (v ? p.set(k, v) : p.delete(k)));
    if (!("page" in next)) p.delete("page");
    setParams(p, { replace: true });
  }

  return (
    <div>
      <PageHeader
        title="FDR Registry"
        subtitle={
          user?.role === "institution"
            ? "Your institution's fixed deposit records."
            : "Consolidated fixed deposit records across institutions."
        }
        actions={
          canEdit(user?.role) ? (
            <button className="btn-primary" onClick={() => navigate("/fdrs/new")}>
              <Plus className="h-4 w-4" /> Add FDR
            </button>
          ) : undefined
        }
      />

      <Card className="mb-4 p-3">
        <div className="grid gap-3 md:grid-cols-4">
          <form
            className="md:col-span-2"
            onSubmit={(e) => {
              e.preventDefault();
              update({ q: search });
            }}
          >
            <div className="flex gap-2">
              <input
                className="input"
                placeholder="Search reference, bank or institution…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Search FDRs"
              />
              <button className="btn-secondary shrink-0" type="submit">
                <Search className="h-4 w-4" />
              </button>
            </div>
          </form>
          <select
            className="input"
            aria-label="Lifecycle status"
            value={lifecycle}
            onChange={(e) => update({ lifecycle: e.target.value })}
          >
            {LIFECYCLES.map((v) => (
              <option key={v} value={v}>
                {v ? labelize(v) : "All lifecycle"}
              </option>
            ))}
          </select>
          <select
            className="input"
            aria-label="Verification status"
            value={verification}
            onChange={(e) => update({ verification: e.target.value })}
          >
            {VERIFICATIONS.map((v) => (
              <option key={v} value={v}>
                {v ? labelize(v) : "All verification"}
              </option>
            ))}
          </select>
        </div>
      </Card>

      <Card>
        <DataTable
          columns={[
            {
              header: "Reference",
              render: (r: Fdr) => (
                <span className="font-medium text-slate-800">{r.fdr_reference_number}</span>
              ),
            },
            { header: "Institution", render: (r: Fdr) => r.institution_name ?? "—" },
            { header: "Bank", render: (r: Fdr) => r.bank_name },
            {
              header: "Amount",
              render: (r: Fdr) => formatCurrency(r.deposit_amount),
              className: "text-right",
            },
            {
              header: "Maturity",
              render: (r: Fdr) => (
                <span className="whitespace-nowrap">
                  {formatDate(r.maturity_date)}
                  <span className="ml-1 text-xs text-slate-400">
                    {r.days_to_maturity != null ? daysLabel(r.days_to_maturity) : ""}
                  </span>
                </span>
              ),
            },
            { header: "Lifecycle", render: (r: Fdr) => <StatusBadge value={r.lifecycle_status} /> },
            { header: "Verification", render: (r: Fdr) => <StatusBadge value={r.verification_status} /> },
            {
              header: "Flags",
              render: (r: Fdr) =>
                r.open_discrepancies ? (
                  <span className="rounded-full bg-rose-50 px-2 py-0.5 text-xs font-medium text-rose-700">
                    {r.open_discrepancies}
                  </span>
                ) : (
                  <span className="text-slate-400">0</span>
                ),
              className: "text-right",
            },
          ]}
          rows={data?.items ?? []}
          rowKey={(r) => r.id}
          loading={isLoading}
          error={error ? (error as Error).message : null}
          onRetry={() => refetch()}
          emptyTitle="No FDR records match these filters"
          emptyHint="Adjust the filters or add a new fixed deposit record."
          onRowClick={(r) => navigate(`/fdrs/${r.id}`)}
        />
        {data && (
          <Pagination
            page={data.page}
            pages={data.pages}
            total={data.total}
            onPage={(p) => update({ page: String(p) })}
          />
        )}
        {isFetching && !isLoading && (
          <p className="px-4 pb-2 text-xs text-slate-400">Refreshing…</p>
        )}
      </Card>
    </div>
  );
}
