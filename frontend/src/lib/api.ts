/**
 * Thin API client for the FDR Sentinel backend.
 *
 * - Stores the JWT in localStorage (prototype convenience; documented in README).
 * - Adds the Authorization header automatically.
 * - Normalises error payloads into an `ApiError` with a human-readable message.
 * - In development the Vite proxy forwards `/api` to the backend, so no CORS
 *   configuration is needed locally.
 */

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "";
const PREFIX = `${API_BASE}/api/v1`;

const TOKEN_KEY = "fdr_sentinel_token";
const USER_KEY = "fdr_sentinel_user";

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function setSession(token: string, user: unknown) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}
export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}
export function getStoredUser<T>(): T | null {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

type RequestOptions = {
  method?: string;
  body?: unknown;
  formData?: FormData;
  signal?: AbortSignal;
  headers?: Record<string, string>;
};

async function parseError(res: Response): Promise<ApiError> {
  let message = `Request failed (${res.status})`;
  let code: string | undefined;
  try {
    const data = await res.json();
    const detail = data?.detail;
    if (typeof detail === "string") message = detail;
    else if (detail && typeof detail === "object") {
      message = detail.message || message;
      code = detail.code;
    } else if (data?.message) message = data.message;
  } catch {
    /* non-JSON error body */
  }
  return new ApiError(res.status, message, code);
}

export async function apiFetch<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  let body: BodyInit | undefined;
  if (opts.formData) {
    body = opts.formData;
  } else if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.body);
  }

  const res = await fetch(`${PREFIX}${path}`, {
    method: opts.method ?? (body ? "POST" : "GET"),
    headers,
    body,
    signal: opts.signal,
  });

  if (res.status === 401) {
    // Session expired / invalid — clear so the router redirects to login.
    clearSession();
  }
  if (!res.ok) throw await parseError(res);

  if (res.status === 204) return undefined as T;
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) return (await res.json()) as T;
  return (await res.text()) as unknown as T;
}

export const api = {
  get: <T>(path: string) => apiFetch<T>(path),
  post: <T>(path: string, body?: unknown) => apiFetch<T>(path, { method: "POST", body }),
  patch: <T>(path: string, body?: unknown) => apiFetch<T>(path, { method: "PATCH", body }),
  put: <T>(path: string, body?: unknown) => apiFetch<T>(path, { method: "PUT", body }),
  delete: <T>(path: string) => apiFetch<T>(path, { method: "DELETE" }),
  upload: <T>(path: string, formData: FormData) => apiFetch<T>(path, { method: "POST", formData }),
  csv: async (path: string): Promise<Blob> => {
    const headers: Record<string, string> = {};
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${PREFIX}${path}`, { headers });
    if (!res.ok) throw await parseError(res);
    return res.blob();
  },
};

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------
export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
  pages: number;
}

export interface User {
  id: number;
  display_name: string;
  email: string;
  username?: string;
  role: "admin" | "officer" | "institution" | "auditor";
  institution_id?: number | null;
  institution_name?: string | null;
  is_active: boolean;
  is_competent_authority: boolean;
  created_at: string;
}

export interface Fdr {
  id: number;
  institution_id: number;
  institution_name?: string;
  institution_code?: string;
  region?: string;
  fdr_reference_number: string;
  bank_name: string;
  branch_name?: string | null;
  deposit_amount: string | number;
  currency: string;
  issue_date?: string | null;
  maturity_date?: string | null;
  verification_status: string;
  lifecycle_status: string;
  release_application_status: string;
  renewal_parent_id?: number | null;
  replacement_fdr_id?: number | null;
  link_type?: string | null;
  eligibility_notes?: string | null;
  remarks?: string | null;
  archived_at?: string | null;
  is_demo: boolean;
  monitoring_category?: string;
  days_to_maturity?: number | null;
  open_discrepancies?: number;
  created_at: string;
  updated_at?: string;
}

export interface Institution {
  id: number;
  institution_code: string;
  institution_name: string;
  institution_type: string;
  region: string;
  address?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
  status: string;
  is_demo: boolean;
  created_at: string;
}

export interface Discrepancy {
  id: number;
  fdr_id?: number | null;
  document_id?: number | null;
  field_name?: string | null;
  submitted_value?: string | null;
  extracted_value?: string | null;
  discrepancy_type: string;
  severity: string;
  explanation?: string | null;
  status: string;
  resolution_notes?: string | null;
  resolved_at?: string | null;
  created_at: string;
  fdr_reference_number?: string | null;
  bank_name?: string | null;
  institution_name?: string | null;
}

export interface Application {
  id: number;
  application_reference: string;
  institution_id: number;
  institution_name?: string;
  fdr_id: number;
  fdr_reference_number?: string;
  bank_name?: string;
  deposit_amount?: string;
  maturity_date?: string | null;
  application_status: string;
  completeness_status: string;
  assigned_officer_name?: string | null;
  pending_reason?: string | null;
  submitted_at?: string | null;
  current_stage_started_at: string;
  last_action_at: string;
  days_in_current_stage?: number;
  is_overdue?: boolean;
  open_clearance_count?: number;
  missing_document_count?: number;
}

export interface Clearance {
  id: number;
  application_id: number;
  clearance_type: string;
  clearance_label?: string;
  status: string;
  assigned_unit?: string | null;
  requested_at?: string | null;
  completed_at?: string | null;
  remarks?: string | null;
  days_pending?: number | null;
  is_overdue?: boolean;
}

export interface Notification {
  id: number;
  notification_type: string;
  channel: string;
  title: string;
  message: string;
  sent_at?: string | null;
  read_at?: string | null;
  delivery_status: string;
  is_escalation: boolean;
  created_at: string;
  fdr_reference_number?: string | null;
}

export interface DocumentRec {
  id: number;
  institution_id: number;
  fdr_id?: number | null;
  document_type: string;
  original_filename: string;
  mime_type: string;
  file_size: number;
  extraction_status: string;
  extraction_error?: string | null;
  review_status: string;
  uploader_name?: string | null;
  uploaded_at: string;
  is_demo: boolean;
  download_url: string;
}

export interface ExtractedField {
  id: number;
  document_id: number;
  field_name: string;
  extracted_value?: string | null;
  normalized_value?: string | null;
  confidence_score?: number | null;
  review_status: string;
}

export interface AuditEvent {
  id: number;
  actor_user_id?: number | null;
  actor_name?: string | null;
  action: string;
  entity_type?: string | null;
  entity_id?: string | null;
  timestamp: string;
  reason?: string | null;
}

export interface KpiCard {
  key: string;
  label: string;
  value: number;
  hint?: string;
  route?: string;
  severity?: string | null;
}
