import type { VercelRequest, VercelResponse } from '@vercel/node';
import { assertMethod, handleError, sendJson } from '../_lib/http.js';
import { requireCronOrAdmin } from '../_lib/supabase.js';
import { runMaturityScan } from '../_lib/alerts.js';

/**
 * GET|POST /api/monitoring/scan
 *
 * Called daily by the Vercel cron schedule (Authorization: Bearer $CRON_SECRET)
 * and on demand by an administrator from the UI. Runs with no user session, so
 * it must not depend on a browser. Notifications are written with a unique
 * dedupe_key per event/recipient, which makes repeated execution idempotent.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    assertMethod(req, ['GET', 'POST']);
    const { admin, actor } = await requireCronOrAdmin(req);
    const summary = await runMaturityScan(admin);

    if (actor) {
      await admin.from('audit_events').insert({
        actor_id: actor.id,
        actor_email: actor.email,
        actor_role: actor.role,
        action: 'monitoring.scan_run',
        entity_type: 'system_settings',
        entity_id: 'maturity_scan',
        summary: `Manual maturity scan: ${summary.notifications_created} notification(s) created`,
        metadata: { ...summary },
      });
    }

    sendJson(res, 200, { ok: true, summary });
  } catch (error) {
    handleError(res, error, 'monitoring/scan');
  }
}
