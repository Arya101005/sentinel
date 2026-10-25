import type {
  AdministrativeStatus,
  ApplicationStatus,
  ApplicationType,
  DiscrepancyStatus,
  RenewalStatus,
  VerificationStatus,
} from './types';

const inr = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 2,
  minimumFractionDigits: 0,
});

const inrCompact = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  notation: 'compact',
  maximumFractionDigits: 1,
});

export function formatCurrency(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  const numeric = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(numeric)) return '—';
  return inr.format(numeric);
}

export function formatCompactCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return inrCompact.format(value);
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
    timeZoneName: 'short',
  }).format(date);
}

export function formatRelative(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value).getTime();
  if (Number.isNaN(date)) return '—';
  const diffMinutes = Math.round((date - Date.now()) / 60000);
  const abs = Math.abs(diffMinutes);
  if (abs < 1) return 'just now';
  if (abs < 60) return diffMinutes > 0 ? `in ${abs} min` : `${abs} min ago`;
  if (abs < 1440) {
    const hours = Math.round(abs / 60);
    return diffMinutes > 0 ? `in ${hours} h` : `${hours} h ago`;
  }
  const days = Math.round(abs / 1440);
  return diffMinutes > 0 ? `in ${days} d` : `${days} d ago`;
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function humanize(value: string | null | undefined): string {
  if (!value) return '—';
  return value
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export const VERIFICATION_LABELS: Record<VerificationStatus, string> = {
  pending: 'Pending verification',
  in_review: 'Under review',
  verified: 'Officer verified',
  flagged: 'Flagged for review',
  rejected: 'Rejected',
};

export const ADMINISTRATIVE_LABELS: Record<AdministrativeStatus, string> = {
  registered: 'Registered',
  under_review: 'Under review',
  verified: 'Verified',
  release_pending: 'Release pending',
  released: 'Released',
  renewed: 'Renewed',
  archived: 'Archived',
};

export const RENEWAL_LABELS: Record<RenewalStatus, string> = {
  not_required: 'Not required',
  due: 'Renewal due',
  requested: 'Renewal requested',
  in_progress: 'Renewal in progress',
  completed: 'Renewal completed',
};

export const APPLICATION_STATUS_LABELS: Record<ApplicationStatus, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  under_review: 'Under review',
  info_required: 'Additional information required',
  resubmitted: 'Resubmitted',
  approved: 'Approved',
  rejected: 'Rejected',
  completed: 'Completed',
};

export const APPLICATION_TYPE_LABELS: Record<ApplicationType, string> = {
  release: 'Release request',
  renewal: 'Renewal request',
};

export const DISCREPANCY_STATUS_LABELS: Record<DiscrepancyStatus, string> = {
  open: 'Not reviewed',
  under_review: 'Under review',
  resolved: 'Resolved',
  accepted: 'Accepted with explanation',
};

export function initials(name: string | null | undefined, email?: string | null): string {
  const source = (name ?? '').trim() || (email ?? '').trim();
  if (!source) return '?';
  const parts = source.split(/[\s@._-]+/).filter((part) => /[A-Za-z0-9]/.test(part));
  const letters = parts
    .slice(0, 2)
    .map((part) => part.match(/[A-Za-z0-9]/)?.[0]?.toUpperCase() ?? '')
    .join('');
  return letters || '?';
}
