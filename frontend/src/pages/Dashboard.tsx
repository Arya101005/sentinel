import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AlertOctagon, CalendarClock, ClipboardList, Flag } from "lucide-react";
import { api, type KpiCard, type Page, type Application, type Notification } from "../lib/api";
import { formatCurrency, formatDate, daysLabel, labelize } from "../lib/format";
import {
  Card,
  DataTable,
  EmptyState,
  ErrorState,
  KpiCard as Kpi,
  PageHeader,
  Skeleton,
  StatusBadge,
} from "../components/ui";

interface Summary {
  generated_at: string;
  cards: KpiCard[];
  data_coverage_warning?: string;
}
interface Bucket {
  label: string;
  value: number;
}
interface Series {
  key: string;
  title: string;
  buckets: Bucket[];
}
interface Charts {
  lifecycle_status: Series;
  upcoming_maturity_by_month: Series;
  by_region: Series;
  discrepancy_categories: Series;
  pending_by_stage: Series;
  application_processing_days: Series;
}
interface MaturityRow {
  fdr_id: number;
  fdr_reference_number: string;
  bank_name: string;
  institution_name: string;
  deposit_amount: string;
  maturity_date?: string;
  days_to_maturity?: number;
  days_since_maturity?: number;
}

const PIE_COLORS = ["#0c7f74", "#1f3a5f", "#f59e0b", "#e11d48", "#0ea5e9", "#64748b", "#22c55e"];

function BarBlock({ series, height = 220 }: { series?: Series; height?: number }) {
  if (!series || !series.buckets.length) return <EmptyState title="No data yet" />;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={series.buckets} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eef1f5" />
        <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={0} angle={-20} textAnchor="end" height={50} />
        <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
        <Tooltip />
        <Bar dataKey="value" fill="#0c7f74" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();

  const summary = useQuery({
    queryKey: ["dashboard-summary"],
    queryFn: () => api.get<Summary>("/monitoring/summary"),
  });
  const charts = useQuery({
    queryKey: ["dashboard-charts"],
    queryFn: () => api.get<Charts>("/monitoring/charts"),
  });
  const upcoming = useQuery({
    queryKey: ["queue-upcoming"],
    queryFn: () => api.get<Page<MaturityRow>>("/monitoring/upcoming-maturity?page_size=5&sort_dir=asc"),
  });
  const nonApplicants = useQuery({
    queryKey: ["queue-nonapp"],
    queryFn: () => api.get<Page<MaturityRow>>("/monitoring/matured-no-application?page_size=5"),
  });
  const overdue = useQuery({
    queryKey: ["queue-overdue"],
    queryFn: () => api.get<Page<Application>>("/applications?scope=overdue&page_size=5"),
  });
  const notifications = useQuery({
    queryKey: ["recent-notifs"],
    queryFn: () => api.get<Page<Notification>>("/notifications?page_size=5"),
  });

  const routeFor = (key: string, fallback: string) => {
    const map: Record<string, string> = {
      matured_no_application: "/non-applicants",
      open_discrepancies: "/discrepancies",
      pending_clearances: "/clearances",
      overdue_cases: "/applications?scope=overdue",
      applications_awaiting_action: "/applications",
      awaiting_verification: "/fdrs?verification=pending_review",
      total_active_fdrs: "/fdrs",
      completed_releases: "/applications?status=completed",
    };
    return map[key] ?? fallback;
  };

  const lifecycleData = charts.data?.lifecycle_status.buckets.filter((b) => b.value > 0) ?? [];

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle="All statistics are computed from this system's records in real time."
      />

      {summary.isLoading && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} rows={1} />
          ))}
        </div>
      )}
      {summary.error && (
        <ErrorState
          message={(summary.error as Error).message}
          onRetry={() => summary.refetch()}
        />
      )}

      {summary.data && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {summary.data.cards.map((c) => (
              <Kpi
                key={c.key}
                label={c.label}
                value={c.value}
                hint={c.hint}
                severity={c.severity}
                onClick={() => navigate(routeFor(c.key, "/fdrs"))}
              />
            ))}
          </div>

          {summary.data.data_coverage_warning && (
            <p className="mt-3 text-xs text-slate-500">
              ⓘ {summary.data.data_coverage_warning}
            </p>
          )}
        </>
      )}

      {/* Charts */}
      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Card className="p-4">
          <h2 className="mb-2 text-sm font-semibold text-slate-800">FDRs by lifecycle status</h2>
          {lifecycleData.length ? (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={lifecycleData} dataKey="value" nameKey="label" innerRadius={45} outerRadius={80}>
                  {lifecycleData.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState title="No records yet" />
          )}
        </Card>

        <Card className="p-4">
          <h2 className="mb-2 text-sm font-semibold text-slate-800">
            Upcoming maturity by month
          </h2>
          <BarBlock series={charts.data?.upcoming_maturity_by_month} />
        </Card>

        <Card className="p-4">
          <h2 className="mb-2 text-sm font-semibold text-slate-800">Active FDRs by region</h2>
          <BarBlock series={charts.data?.by_region} />
        </Card>

        <Card className="p-4">
          <h2 className="mb-2 text-sm font-semibold text-slate-800">Discrepancy categories</h2>
          <BarBlock series={charts.data?.discrepancy_categories} />
        </Card>

        <Card className="p-4">
          <h2 className="mb-2 text-sm font-semibold text-slate-800">Pending cases by stage</h2>
          <BarBlock series={charts.data?.pending_by_stage} />
        </Card>

        <Card className="p-4">
          <h2 className="mb-2 text-sm font-semibold text-slate-800">
            Completed release processing (days)
          </h2>
          <BarBlock series={charts.data?.application_processing_days} />
        </Card>
      </div>

      {/* Operational queues */}
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3">
            <CalendarClock className="h-4 w-4 text-teal-600" />
            <h2 className="text-sm font-semibold text-slate-800">Urgent maturity</h2>
          </div>
          <DataTable
            columns={[
              { header: "FDR", render: (r: MaturityRow) => r.fdr_reference_number },
              { header: "Institution", render: (r: MaturityRow) => r.institution_name },
              {
                header: "Maturity",
                render: (r: MaturityRow) => (
                  <span className="whitespace-nowrap">
                    {formatDate(r.maturity_date)}
                    <span className="ml-1 text-xs text-slate-400">
                      ({daysLabel(r.days_to_maturity)})
                    </span>
                  </span>
                ),
              },
              { header: "Amount", render: (r: MaturityRow) => formatCurrency(r.deposit_amount), className: "text-right" },
            ]}
            rows={upcoming.data?.items ?? []}
            rowKey={(r) => r.fdr_id}
            loading={upcoming.isLoading}
            error={upcoming.error ? (upcoming.error as Error).message : null}
            onRetry={() => upcoming.refetch()}
            emptyTitle="No upcoming maturities"
            emptyHint="No deposits mature within the configured alert window."
            onRowClick={(r) => navigate(`/fdrs/${r.fdr_id}`)}
          />
        </Card>

        <Card>
          <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3">
            <AlertOctagon className="h-4 w-4 text-rose-600" />
            <h2 className="text-sm font-semibold text-slate-800">Matured without application</h2>
          </div>
          <DataTable
            columns={[
              { header: "FDR", render: (r: MaturityRow) => r.fdr_reference_number },
              { header: "Institution", render: (r: MaturityRow) => r.institution_name },
              {
                header: "Matured",
                render: (r: MaturityRow) => (
                  <span className="whitespace-nowrap">
                    {formatDate(r.maturity_date)}
                    <span className="ml-1 text-xs text-slate-400">
                      ({daysLabel(r.days_since_maturity ? -r.days_since_maturity : r.days_to_maturity)})
                    </span>
                  </span>
                ),
              },
              { header: "Amount", render: (r: MaturityRow) => formatCurrency(r.deposit_amount), className: "text-right" },
            ]}
            rows={nonApplicants.data?.items ?? []}
            rowKey={(r) => r.fdr_id}
            loading={nonApplicants.isLoading}
            error={nonApplicants.error ? (nonApplicants.error as Error).message : null}
            onRetry={() => nonApplicants.refetch()}
            emptyTitle="No matured non-applicants"
            emptyHint="Every matured deposit has a recorded release application."
            onRowClick={(r) => navigate(`/fdrs/${r.fdr_id}`)}
          />
        </Card>

        <Card>
          <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3">
            <ClipboardList className="h-4 w-4 text-amber-600" />
            <h2 className="text-sm font-semibold text-slate-800">Overdue cases</h2>
          </div>
          <DataTable
            columns={[
              { header: "Reference", render: (a: Application) => a.application_reference },
              { header: "Institution", render: (a: Application) => a.institution_name },
              { header: "Stage", render: (a: Application) => labelize(a.application_status) },
              {
                header: "Days in stage",
                render: (a: Application) => (
                  <span className="font-medium text-rose-600">{a.days_in_current_stage}d</span>
                ),
                className: "text-right",
              },
            ]}
            rows={overdue.data?.items ?? []}
            rowKey={(a) => a.id}
            loading={overdue.isLoading}
            error={overdue.error ? (overdue.error as Error).message : null}
            onRetry={() => overdue.refetch()}
            emptyTitle="No overdue cases"
            emptyHint="No case has exceeded the configured stage threshold."
            onRowClick={(a) => navigate(`/applications/${a.id}`)}
          />
        </Card>

        <Card>
          <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3">
            <Flag className="h-4 w-4 text-teal-600" />
            <h2 className="text-sm font-semibold text-slate-800">Recent notifications</h2>
          </div>
          <DataTable
            columns={[
              { header: "Title", render: (n: Notification) => n.title },
              { header: "Type", render: (n: Notification) => labelize(n.notification_type) },
              { header: "Status", render: (n: Notification) => <StatusBadge value={n.read_at ? "resolved" : "pending"} /> },
            ]}
            rows={notifications.data?.items ?? []}
            rowKey={(n) => n.id}
            loading={notifications.isLoading}
            error={notifications.error ? (notifications.error as Error).message : null}
            onRetry={() => notifications.refetch()}
            emptyTitle="No notifications"
            onRowClick={() => navigate("/notifications")}
          />
        </Card>
      </div>
    </div>
  );
}
