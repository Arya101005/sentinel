import type { VercelRequest, VercelResponse } from '@vercel/node';
import { assertMethod, handleError, sendJson } from './_lib/http';
import { requireAdmin, requireUser } from './_lib/supabase';

/**
 * GET /api/diagnostics — confirms that server-only configuration exists and the
 * database/storage can be reached. Presence flags only: no secret value, token
 * or connection string is ever returned.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    assertMethod(req, ['GET']);
    const context = await requireUser(req);
    requireAdmin(context);
    const { admin, profile } = context;

    const checks: Array<{ name: string; ok: boolean; detail: string }> = [];

    checks.push({
      name: 'Supabase URL (server)',
      ok: Boolean(process.env.SUPABASE_URL),
      detail: process.env.SUPABASE_URL ? 'configured' : 'missing',
    });
    checks.push({
      name: 'Supabase secret key (server)',
      ok: Boolean(process.env.SUPABASE_SECRET_KEY),
      detail: process.env.SUPABASE_SECRET_KEY ? 'configured' : 'missing',
    });
    checks.push({
      name: 'Cron secret',
      ok: Boolean(process.env.CRON_SECRET),
      detail: process.env.CRON_SECRET
        ? 'configured (scheduled scans authorised)'
        : 'missing — the cron endpoint will reject unauthorised calls',
    });

    const { data: settings, error: settingsError } = await admin
      .from('system_settings')
      .select('key')
      .limit(20);
    checks.push({
      name: 'Database (service role)',
      ok: !settingsError && (settings ?? []).length > 0,
      detail: settingsError ? settingsError.message : `${(settings ?? []).length} settings rows readable`,
    });

    const { data: bucket, error: bucketError } = await admin.storage.getBucket('fdr-documents');
    checks.push({
      name: 'Private storage bucket',
      ok: !bucketError && Boolean(bucket) && bucket?.public === false,
      detail: bucketError ? bucketError.message : bucket ? `fdr-documents (public=${String(bucket.public)})` : 'not found',
    });

    const { data: rpcData, error: rpcError } = await admin.rpc('fn_setup_status');
    checks.push({
      name: 'Database functions',
      ok: !rpcError && Boolean(rpcData),
      detail: rpcError ? rpcError.message : 'fn_setup_status reachable',
    });

    const environment = process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'development';
    const ok = checks.every((check) => check.ok);
    sendJson(res, 200, {
      ok,
      environment,
      checks,
      caller: { id: profile.id, email: profile.email, role: profile.role },
    });
  } catch (error) {
    handleError(res, error, 'diagnostics');
  }
}
