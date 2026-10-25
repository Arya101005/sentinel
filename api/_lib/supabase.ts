import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import type { VercelRequest } from '@vercel/node';
import WebSocket from 'ws';
import { HttpError } from './http';

// Node 20 (used by some Vercel runtimes) has no global WebSocket. Supabase's
// client constructs a realtime transport eagerly, so provide the polyfill.
// These functions only use REST/Auth/Storage, never realtime subscriptions.
if (!(globalThis as { WebSocket?: unknown }).WebSocket) {
  (globalThis as { WebSocket?: unknown }).WebSocket = WebSocket;
}

export interface ProfileRow {
  id: string;
  email: string;
  full_name: string;
  role: 'system_admin' | 'aicte_officer' | 'institution_user' | 'read_only_auditor';
  institution_id: string | null;
  is_active: boolean;
}

/**
 * Service-role client. Never sent to the browser and never used to render data
 * for a request until that request's user has been authorised.
 */
export function adminClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) {
    throw new HttpError(
      503,
      'Server configuration is incomplete: SUPABASE_URL and SUPABASE_SECRET_KEY must be set in the deployment environment.',
    );
  }
  return createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { 'x-application-name': 'fdr-sentinel-api' } },
  });
}

export interface CallerContext {
  admin: SupabaseClient;
  user: User;
  profile: ProfileRow;
}

/** Validates the caller's Supabase access token and loads their profile. */
export async function requireUser(req: VercelRequest): Promise<CallerContext> {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) throw new HttpError(401, 'Authentication required.');

  const admin = adminClient();
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, 'Your session is invalid or has expired.');

  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('id, email, full_name, role, institution_id, is_active')
    .eq('id', data.user.id)
    .maybeSingle();
  if (profileError) throw new HttpError(500, `Profile lookup failed: ${profileError.message}`);
  if (!profile) throw new HttpError(403, 'No profile is linked to this account.');
  if (!profile.is_active) throw new HttpError(403, 'This account has been disabled.');

  return { admin, user: data.user, profile: profile as ProfileRow };
}

export function requireAdmin(context: CallerContext): void {
  if (context.profile.role !== 'system_admin') {
    throw new HttpError(403, 'Only a System Administrator can perform this action.');
  }
}

/** Authorises a Vercel cron invocation or an administrator session. */
export async function requireCronOrAdmin(req: VercelRequest): Promise<{ admin: SupabaseClient; actor: ProfileRow | null }> {
  const secret = process.env.CRON_SECRET;
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  const query = (req.query as Record<string, string | string[] | undefined>) ?? {};
  // Local development (plain Node request) has no parsed req.query.
  const url = new URL(req.url ?? '/', 'http://localhost');
  const querySecret =
    typeof query.secret === 'string' ? query.secret : (url.searchParams.get('secret') ?? '');

  if (secret && (token === secret || querySecret === secret)) {
    return { admin: adminClient(), actor: null };
  }

  const context = await requireUser(req);
  if (context.profile.role !== 'system_admin') {
    throw new HttpError(403, 'Only the scheduler or a System Administrator can run the monitoring scan.');
  }
  return { admin: context.admin, actor: context.profile };
}
