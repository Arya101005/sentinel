import { supabase } from './supabase';
import type { Profile, Role } from './types';

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const response = await fetch(path, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });

  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { error: text.slice(0, 400) };
    }
  }
  if (!response.ok) {
    const message =
      (payload as { error?: string; message?: string } | null)?.error ??
      (payload as { message?: string } | null)?.message ??
      `Request failed (${response.status})`;
    throw new ApiError(message, response.status);
  }
  return payload as T;
}

export interface SetupStatus {
  admins: number;
  profiles: number;
  institutions: number;
}

export interface Diagnostics {
  ok: boolean;
  environment: string;
  checks: Array<{ name: string; ok: boolean; detail: string }>;
  caller: { id: string; email: string; role: string } | null;
}

export const api = {
  setupStatus: async (): Promise<SetupStatus> => {
    const { data, error } = await supabase.rpc('fn_setup_status');
    if (error) throw new Error(error.message);
    return data as SetupStatus;
  },

  bootstrap: (body: { email: string; password: string; full_name: string }) =>
    request<{ ok: true; profile: Profile }>('/api/bootstrap', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  listUsers: async (): Promise<{ users: Profile[] }> => request<{ users: Profile[] }>('/api/admin/users'),

  createUser: (body: {
    email: string;
    full_name: string;
    role: Role;
    institution_id?: string;
    password: string;
  }) =>
    request<{ user: Profile }>('/api/admin/users', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  updateUser: (
    userId: string,
    body: Partial<Pick<Profile, 'role' | 'institution_id' | 'is_active' | 'full_name'>>,
  ) =>
    request<{ user: Profile }>('/api/admin/users', {
      method: 'PATCH',
      body: JSON.stringify({ id: userId, ...body }),
    }),

  seedDemoData: () =>
    request<{ ok: true; counts: Record<string, number> }>('/api/admin/demo-data', {
      method: 'POST',
    }),

  removeDemoData: () =>
    request<{ ok: true; removed: Record<string, number> }>('/api/admin/demo-data', {
      method: 'DELETE',
    }),

  runMaturityScan: () =>
    request<{ ok: true; summary: Record<string, number> }>('/api/monitoring/scan', {
      method: 'POST',
    }),

  diagnostics: () => request<Diagnostics>('/api/diagnostics'),
};
