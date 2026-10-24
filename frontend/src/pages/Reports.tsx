import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, FileDown, FileText } from "lucide-react";
import { api, getToken } from "../lib/api";
import { formatDateTime } from "../lib/format";
import { Alert, Card, DataTable, ErrorState, PageHeader, Pagination, Spinner, useToast } from "../components/ui";

interface ReportMeta {
  report_key: string;
  report_title: string;
  export_csv: boolean;
  export_pdf: boolean;
}
interface ReportPreview {
  report_key: string;
  report_title: string;
  generated_at: string;
  row_count: number;
  columns: { key: string; label: string }[];
  rows: Record<string, unknown>[];
  page: number;
  pages: number;
  filters: Record<string, unknown>;
  data_coverage_warning?: string | null;
}

export default function Reports() {
  const toast = useToast();
  const [selected, setSelected] = useState("");
  const [page, setPage] = useState(1);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [status, setStatus] = useState("");
  const [bank, setBank] = useState("");

  const reportList = useQuery({
    queryKey: ["reports"],
    queryFn: () => api.get<{ reports: ReportMeta[] }>("/reports"),
  });

  const previewQs = useMemo(() => {
    const p = new URLSearchParams({ page: String(page), page_size: "10" });
    if (dateFrom) p.set("date_from", dateFrom);
    if (dateTo) p.set("date_to", dateTo);
    if (status) p.set("status", status);
    if (bank) p.set("bank", bank);
    return p.toString();
  }, [page, dateFrom, dateTo, status, bank]);

  const preview = useQuery({
    queryKey: ["report-preview", selected, previewQs],
    queryFn: () => api.get<ReportPreview>(`/reports/${selected}?${previewQs}`),
    enabled: Boolean(selected),
  });

  async function download(kind: "csv" | "pdf") {
    if (!selected) return;
    try {
      const headers: Record<string, string> = {};
      const t = getToken();
      if (t) headers.Authorization = `Bearer ${t}`;
      const p = new URLSearchParams();
      if (dateFrom) p.set("date_from", dateFrom);
      if (dateTo) p.set("date_to", dateTo);
      if (status) p.set("status", status);
      if (bank) p.set("bank", bank);
      const qs = p.toString() ? `?${p.toString()}` : "";
      const res = await fetch(`/api/v1/reports/${selected}/${kind}${qs}`, { headers });
      if (!res.ok) throw new Error(`Export failed (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `fdr_sentinel_${selected}_${new Date().toISOString().slice(0, 10)}.${kind}`;
      a.click();
      URL.revokeObjectURL(url);
      toast.push(`${kind.toUpperCase()} export downloaded (recorded in the audit trail).`, "success");
    } catch (e) {
      toast.push((e as Error).message, "error");
    }
  }

  const reports = reportList.data?.reports ?? [];

  return (
    <div>
      <PageHeader
        title="Reports & exports"
        subtitle="Every report is generated from live database records. Exports are audit-logged."
      />

      <div className="grid gap-4 lg:grid-cols-4">
        <Card className="p-4 lg:col-span-1">
          <h2 className="mb-2 text-sm font-semibold text-slate-800">Choose a report</h2>
          {reportList.isLoading && <Spinner />}
          <ul className="space-y-1">
            {reports.map((r) => (
              <li key={r.report_key}>
                <button
                  className={`w-full rounded px-2 py-1.5 text-left text-sm ${
                    selected === r.report_key ? "bg-teal-50 font-medium text-teal-800" : "text-slate-700 hover:bg-slate-50"
                  }`}
                  onClick={() => {
                    setSelected(r.report_key);
                    setPage(1);
                  }}
                >
                  {r.report_title}
                </button>
              </li>
            ))}
          </ul>
          {reportList.error && <p className="mt-2 text-xs text-rose-600">{(reportList.error as Error).message}</p>}

          <hr className="my-3 border-slate-200" />
          <h3 className="mb-2 text-xs font-semibold uppercase text-slate-400">Filters</h3>
          <label className="mb-2 block">
            <span className="label">From</span>
            <input className="input" type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} />
          </label>
          <label className="mb-2 block">
            <span className="label">To</span>
            <input className="input" type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }} />
          </label>
          <label className="mb-2 block">
            <span className="label">Status</span>
            <input className="input" placeholder="e.g. active / completed" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} />
          </label>
          <label className="block">
            <span className="label">Bank</span>
            <input className="input" placeholder="Bank name" value={bank} onChange={(e) => { setBank(e.target.value); setPage(1); }} />
          </label>
        </Card>

        <Card className="lg:col-span-3">
          {!selected ? (
            <div className="flex h-full min-h-64 items-center justify-center p-6 text-center text-sm text-slate-500">
              Select a report to preview it.
            </div>
          ) : preview.isLoading ? (
            <div className="p-6"><Spinner label="Generating report…" /></div>
          ) : preview.error ? (
            <ErrorState message={(preview.error as Error).message} onRetry={() => preview.refetch()} />
          ) : preview.data ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
                <div>
                  <h2 className="text-sm font-semibold text-slate-800">{preview.data.report_title}</h2>
                  <p className="text-xs text-slate-400">
                    Generated {formatDateTime(preview.data.generated_at)} · {preview.data.row_count} row(s)
                  </p>
                </div>
                <div className="flex gap-2">
                  <button className="btn-secondary" onClick={() => download("csv")}>
                    <Download className="h-4 w-4" /> CSV
                  </button>
                  <button className="btn-secondary" onClick={() => download("pdf")}>
                    <FileDown className="h-4 w-4" /> PDF
                  </button>
                </div>
              </div>
              {preview.data.data_coverage_warning && (
                <div className="px-4 pt-3">
                  <Alert tone="warn">{preview.data.data_coverage_warning}</Alert>
                </div>
              )}
              <div className="p-4">
                <DataTable
                  columns={preview.data.columns.map((c) => ({
                    header: c.label,
                    render: (row: Record<string, unknown>) => String(row[c.key] ?? "—"),
                  }))}
                  rows={preview.data.rows}
                  rowKey={(row: Record<string, unknown>) => JSON.stringify(row)}
                  emptyTitle="No rows match these filters"
                />
                <Pagination page={preview.data.page} pages={preview.data.pages} total={preview.data.row_count} onPage={setPage} />
              </div>
            </>
          ) : null}
        </Card>
      </div>

      <p className="mt-3 flex items-center gap-1 text-xs text-slate-400">
        <FileText className="h-3.5 w-3.5" /> CSV exports neutralise spreadsheet formula injection and include a UTF-8 BOM
        for Excel.
      </p>
    </div>
  );
}
