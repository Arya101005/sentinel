import { Link } from 'react-router-dom';
import { CalendarDays, Sparkles } from 'lucide-react';

/**
 * Dashboard hero: a compact "maturity horizon".
 *
 * Every number comes from fn_dashboard_summary — the same aggregate the metric
 * cards use — so the visual can never drift from the tables it summarises.
 * Each segment is a link to the filtered queue it represents, and a conventional
 * legend sits beside the visual so the picture is never the only way to read
 * the data. Motion is opt-in via prefers-reduced-motion (see index.css).
 */

export interface HorizonBucket {
  bucket: string;
  c: number;
}

interface Segment {
  key: string;
  label: string;
  color: string;
  to: string;
}

const SEGMENTS: Segment[] = [
  { key: 'matured', label: 'Matured', color: '#dc2626', to: '/maturity?tab=matured' },
  { key: 'today', label: 'Today', color: '#f59e0b', to: '/maturity?tab=today' },
  { key: '0-7 days', label: 'Next 7 days', color: '#f97316', to: '/maturity?tab=seven' },
  { key: '8-15 days', label: '8–15 days', color: '#0ea5e9', to: '/maturity?tab=upcoming' },
  { key: '16-30 days', label: '16–30 days', color: '#6366f1', to: '/maturity?tab=upcoming' },
  { key: '31-90 days', label: '31–90 days', color: '#10b981', to: '/fdrs?maturity=active' },
  { key: 'over 90 days', label: 'Beyond 90 days', color: '#64748b', to: '/fdrs?maturity=active' },
];

export function MaturityHorizon({
  buckets,
  today,
  warningDays,
}: {
  buckets: HorizonBucket[];
  today: string;
  warningDays: number[];
}) {
  const counts = new Map(buckets.map((bucket) => [bucket.bucket, bucket.c]));
  const rows = SEGMENTS.map((segment) => ({ ...segment, count: counts.get(segment.key) ?? 0 }));
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  const active = rows.filter((row) => row.key !== 'matured' && row.key !== 'today');
  const nearest = active.find((row) => row.count > 0);
  const matured = counts.get('matured') ?? 0;

  if (total === 0) {
    return (
      <section
        aria-label="Maturity horizon"
        className="rounded-xl border border-slate-200 bg-white p-5"
      >
        <div className="flex flex-col items-center justify-center gap-2 py-6 text-center">
          <span className="rounded-2xl bg-slate-100 p-4 text-slate-400">
            <CalendarDays className="h-6 w-6" />
          </span>
          <p className="text-sm font-medium text-slate-600">The horizon is clear</p>
          <p className="max-w-md text-xs leading-relaxed text-slate-500">
            No live records fall inside any monitoring window yet. Register an FDR or load the labelled demonstration
            dataset to see the horizon populate with real values.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section
      aria-label="Maturity horizon"
      className="overflow-hidden rounded-xl border border-slate-200 bg-white"
    >
      <div className="grid gap-0 md:grid-cols-[1.5fr_1fr]">
        {/* Visual half — every figure is clickable through to its queue. */}
        <div className="relative border-b border-slate-100 p-5 md:border-b-0 md:border-r">
          <div className="flex items-baseline justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-navy-500">
                Maturity horizon
              </p>
              <p className="mt-0.5 text-xs text-slate-500">
                Live instruments by distance to maturity · {today} (Asia/Kolkata)
              </p>
            </div>
            <span className="rounded-full bg-navy-50 px-2.5 py-1 text-xs font-semibold text-navy-700">
              {total} live
            </span>
          </div>

          <div className="horizon-float mt-3 flex flex-wrap items-end gap-1.5" role="list">
            {rows.map((row) => {
              const share = total > 0 ? Math.max(row.count / total, row.count > 0 ? 0.03 : 0) : 0;
              const height = 14 + Math.round(share * 84);
              return (
                <Link
                  key={row.key}
                  to={row.to}
                  role="listitem"
                  title={`${row.count} record(s) — open the ${row.label} queue`}
                  className="group flex w-[64px] flex-col items-center gap-1.5 rounded-md px-1 py-1 transition hover:bg-slate-50 motion-reduce:transition-none"
                >
                  <span className="text-[11px] font-semibold text-slate-700">{row.count}</span>
                  <span
                    className="w-full rounded-t-md rounded-b-sm opacity-90 transition group-hover:opacity-100 motion-reduce:transition-none"
                    style={{ height, backgroundColor: row.color }}
                    aria-hidden="true"
                  />
                  <span className="text-center text-[9px] leading-tight text-slate-500">{row.label}</span>
                </Link>
              );
            })}
          </div>
        </div>

        {/* Interpretation half — a floating "instrument card" summarising what matters now. */}
        <div className="relative flex flex-col justify-center gap-3 bg-slate-50/60 p-5">
          <div className="horizon-card rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              <Sparkles className="h-3.5 w-3.5 text-amber-500" /> What needs attention
            </p>
            <dl className="mt-2.5 space-y-1.5 text-sm">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-slate-600">Matured, no release application recorded</dt>
                <dd className={matured > 0 ? 'font-semibold text-red-600' : 'font-semibold text-slate-400'}>
                  {matured}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-slate-600">Nearest populated window</dt>
                <dd className="font-medium text-slate-800">{nearest ? nearest.label : '—'}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-slate-600">Warning intervals</dt>
                <dd className="font-medium text-slate-800">{warningDays.join(' / ')} days</dd>
              </div>
            </dl>
            <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
              A matured record is a follow-up prompt, not a finding of non-compliance.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
