import * as React from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { Badge, Card, type BadgeTone } from './primitives';
import {
  ADMINISTRATIVE_LABELS,
  APPLICATION_STATUS_LABELS,
  DISCREPANCY_STATUS_LABELS,
  RENEWAL_LABELS,
  VERIFICATION_LABELS,
} from '@/lib/format';
import type {
  AdministrativeStatus,
  ApplicationStatus,
  DiscrepancyStatus,
  RenewalStatus,
  VerificationStatus,
} from '@/lib/types';
import type { MaturityState } from '@/lib/maturity';
import type { PriorityLevel } from '@/lib/priority';

/* -------------------------------------------------------------------------- */
/* Table                                                                       */
/* -------------------------------------------------------------------------- */
export function TableShell({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('table-shell', className)}>{children}</div>;
}

export function Table({ children, className }: { children: React.ReactNode; className?: string }) {
  return <table className={cn('data-table', className)}>{children}</table>;
}

/* -------------------------------------------------------------------------- */
/* Tabs (segmented control)                                                    */
/* -------------------------------------------------------------------------- */
export function Tabs<T extends string>({
  value,
  options,
  onChange,
  className,
}: {
  value: T;
  options: Array<{ value: T; label: string; count?: number }>;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap gap-1 rounded-lg border border-border bg-slate-50 p-1', className)} role="tablist">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
            value === option.value
              ? 'bg-white text-navy-900 shadow-sm ring-1 ring-slate-200'
              : 'text-slate-600 hover:text-navy-900',
          )}
        >
          {option.label}
          {typeof option.count === 'number' && (
            <span
              className={cn(
                'rounded-full px-1.5 py-0.5 text-[10px] font-semibold',
                value === option.value ? 'bg-navy-50 text-navy-800' : 'bg-slate-200/80 text-slate-600',
              )}
            >
              {option.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Pagination                                                                  */
/* -------------------------------------------------------------------------- */
export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-1 py-3 text-xs text-slate-600">
      <span>
        Showing <span className="font-semibold text-slate-800">{from}</span>–
        <span className="font-semibold text-slate-800">{to}</span> of{' '}
        <span className="font-semibold text-slate-800">{total}</span>
      </span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          className="rounded-md border border-input bg-white px-2.5 py-1.5 font-medium disabled:opacity-50"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          Previous
        </button>
        <span className="px-2">
          Page {page} of {totalPages}
        </span>
        <button
          type="button"
          className="rounded-md border border-input bg-white px-2.5 py-1.5 font-medium disabled:opacity-50"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          Next
        </button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Status badges                                                               */
/* -------------------------------------------------------------------------- */
const VERIFICATION_TONE: Record<VerificationStatus, BadgeTone> = {
  pending: 'neutral',
  in_review: 'info',
  verified: 'success',
  flagged: 'warning',
  rejected: 'danger',
};

export function VerificationBadge({ status }: { status: VerificationStatus }) {
  return <Badge tone={VERIFICATION_TONE[status]}>{VERIFICATION_LABELS[status]}</Badge>;
}

const ADMIN_TONE: Record<AdministrativeStatus, BadgeTone> = {
  registered: 'neutral',
  under_review: 'info',
  verified: 'success',
  release_pending: 'warning',
  released: 'success',
  renewed: 'success',
  archived: 'outline',
};

export function AdministrativeBadge({ status }: { status: AdministrativeStatus }) {
  return <Badge tone={ADMIN_TONE[status]}>{ADMINISTRATIVE_LABELS[status]}</Badge>;
}

export function RenewalBadge({ status }: { status: RenewalStatus }) {
  const tone: BadgeTone =
    status === 'completed' ? 'success' : status === 'due' ? 'warning' : status === 'not_required' ? 'outline' : 'info';
  return <Badge tone={tone}>{RENEWAL_LABELS[status]}</Badge>;
}

const APP_TONE: Record<ApplicationStatus, BadgeTone> = {
  draft: 'outline',
  submitted: 'info',
  under_review: 'warning',
  info_required: 'danger',
  resubmitted: 'info',
  approved: 'success',
  rejected: 'danger',
  completed: 'success',
};

export function ApplicationStatusBadge({ status }: { status: ApplicationStatus }) {
  return <Badge tone={APP_TONE[status]}>{APPLICATION_STATUS_LABELS[status]}</Badge>;
}

const FLAG_TONE: Record<DiscrepancyStatus, BadgeTone> = {
  open: 'danger',
  under_review: 'warning',
  resolved: 'success',
  accepted: 'info',
};

export function DiscrepancyStatusBadge({ status }: { status: DiscrepancyStatus }) {
  return <Badge tone={FLAG_TONE[status]}>{DISCREPANCY_STATUS_LABELS[status]}</Badge>;
}

const MATURITY_TONE: Record<MaturityState, BadgeTone> = {
  archived: 'outline',
  closed: 'outline',
  matured_no_application: 'danger',
  matured_with_application: 'warning',
  due_today: 'warning',
  approaching: 'info',
  active: 'success',
};

export function MaturityBadge({ state, label }: { state: MaturityState; label: string }) {
  return <Badge tone={MATURITY_TONE[state]}>{label}</Badge>;
}

/* -------------------------------------------------------------------------- */
/* Priority (deterministic, always shown with its reasons)                     */
/* -------------------------------------------------------------------------- */
const PRIORITY_TONE: Record<PriorityLevel, BadgeTone> = {
  urgent: 'danger',
  high: 'warning',
  normal: 'info',
  low: 'outline',
};

const PRIORITY_LABELS: Record<PriorityLevel, string> = {
  urgent: 'Urgent',
  high: 'High',
  normal: 'Normal',
  low: 'Routine',
};

export function PriorityBadge({
  level,
  score,
  reasons,
}: {
  level: PriorityLevel;
  score: number;
  reasons: string[];
}) {
  return (
    <span
      className="inline-flex max-w-[220px] flex-col gap-1"
      title={`Priority score ${score}. ${reasons.join(' ')}`}
    >
      <Badge tone={PRIORITY_TONE[level]}>
        {PRIORITY_LABELS[level]} · {score}
      </Badge>
      <span className="line-clamp-2 text-[10px] leading-snug text-slate-500">{reasons[0]}</span>
      <span className="sr-only">{reasons.join(' ')}</span>
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Metric card                                                                 */
/* -------------------------------------------------------------------------- */
export function MetricCard({
  label,
  value,
  hint,
  icon,
  tone = 'neutral',
  to,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  icon?: React.ReactNode;
  tone?: 'neutral' | 'danger' | 'warning' | 'success' | 'info';
  to?: string;
}) {
  const accent = {
    neutral: 'bg-slate-100 text-slate-600',
    danger: 'bg-red-50 text-red-600',
    warning: 'bg-amber-50 text-amber-600',
    success: 'bg-emerald-50 text-emerald-600',
    info: 'bg-sky-50 text-sky-600',
  }[tone];

  const body = (
    <Card className="h-full transition-shadow hover:shadow-md">
      <div className="flex items-start justify-between gap-3 p-4">
        <div className="min-w-0">
          <p className="truncate text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
          <p className="mt-1.5 text-2xl font-semibold leading-none tracking-tight text-navy-900">{value}</p>
          {hint && <p className="mt-1.5 line-clamp-2 text-[11px] leading-snug text-slate-500">{hint}</p>}
        </div>
        {icon && <div className={cn('rounded-md p-2', accent)}>{icon}</div>}
      </div>
    </Card>
  );

  if (to) {
    return (
      <Link to={to} className="block rounded-lg focus-visible:ring-2">
        {body}
      </Link>
    );
  }
  return body;
}
