/** Display formatting helpers (currency, dates, durations, status labels). */

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

const inrPrecise = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
});

export function formatCurrency(value: string | number | null | undefined, precise = false): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = typeof value === "number" ? value : Number(String(value).replace(/,/g, ""));
  if (Number.isNaN(n)) return String(value);
  return (precise ? inrPrecise : inr).format(n);
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function daysLabel(days: number | null | undefined): string {
  if (days === null || days === undefined) return "—";
  if (days > 0) return `in ${days} day${days === 1 ? "" : "s"}`;
  if (days === 0) return "today";
  return `${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} ago`;
}

/** Neutral, human labels for known enum values; falls back to the raw value. */
export function labelize(value: string | null | undefined): string {
  if (!value) return "—";
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

const LIFECYCLE_TONE: Record<string, string> = {
  active: "bg-emerald-50 text-emerald-700 border-emerald-200",
  matured: "bg-amber-50 text-amber-700 border-amber-200",
  renewed: "bg-sky-50 text-sky-700 border-sky-200",
  replaced: "bg-slate-100 text-slate-600 border-slate-200",
  released: "bg-teal-50 text-teal-700 border-teal-200",
  on_hold: "bg-orange-50 text-orange-700 border-orange-200",
  archived: "bg-slate-100 text-slate-500 border-slate-200",
};

const STATUS_TONE: Record<string, string> = {
  verified: "bg-emerald-50 text-emerald-700 border-emerald-200",
  discrepancies_found: "bg-rose-50 text-rose-700 border-rose-200",
  pending_review: "bg-amber-50 text-amber-700 border-amber-200",
  unverified: "bg-slate-100 text-slate-600 border-slate-200",
  manual_review: "bg-orange-50 text-orange-700 border-orange-200",
  completed: "bg-emerald-50 text-emerald-700 border-emerald-200",
  rejected: "bg-rose-50 text-rose-700 border-rose-200",
  open: "bg-rose-50 text-rose-700 border-rose-200",
  resolved: "bg-emerald-50 text-emerald-700 border-emerald-200",
  dismissed: "bg-slate-100 text-slate-600 border-slate-200",
  confirmed: "bg-amber-50 text-amber-700 border-amber-200",
  correction_requested: "bg-sky-50 text-sky-700 border-sky-200",
  pending: "bg-amber-50 text-amber-700 border-amber-200",
  cleared: "bg-emerald-50 text-emerald-700 border-emerald-200",
  high: "bg-rose-50 text-rose-700 border-rose-200",
  medium: "bg-amber-50 text-amber-700 border-amber-200",
  low: "bg-slate-100 text-slate-600 border-slate-200",
};

export function toneFor(value: string | null | undefined): string {
  if (!value) return "bg-slate-100 text-slate-600 border-slate-200";
  return (
    STATUS_TONE[value] ??
    LIFECYCLE_TONE[value] ??
    "bg-slate-100 text-slate-600 border-slate-200"
  );
}
