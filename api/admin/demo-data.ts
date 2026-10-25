import type { VercelRequest, VercelResponse } from '@vercel/node';
import { assertMethod, handleError, sendJson } from '../_lib/http';
import { requireAdmin, requireUser } from '../_lib/supabase';
import { removeDemoData, seedDemoData } from '../_lib/seed';

/**
 * POST   /api/admin/demo-data  create/refresh the synthetic demonstration dataset
 * DELETE /api/admin/demo-data  remove only rows explicitly marked is_demo
 *
 * Demo rows are always labelled. Removal never touches real records: the
 * filters are explicit (is_demo = true / dedupe_key LIKE 'demo:%').
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const method = assertMethod(req, ['POST', 'DELETE']);
    const context = await requireUser(req);
    requireAdmin(context);

    if (method === 'POST') {
      const counts = await seedDemoData(context.admin, { id: context.profile.id, email: context.profile.email });
      sendJson(res, 200, { ok: true, counts });
      return;
    }

    const removed = await removeDemoData(context.admin);
    await context.admin.from('audit_events').insert({
      actor_id: context.profile.id,
      actor_email: context.profile.email,
      actor_role: context.profile.role,
      action: 'demo_data.removed',
      entity_type: 'system_settings',
      entity_id: 'demo_data',
      summary: 'Synthetic demonstration dataset removed',
      metadata: removed,
    });
    sendJson(res, 200, { ok: true, removed });
  } catch (error) {
    handleError(res, error, 'admin/demo-data');
  }
}
