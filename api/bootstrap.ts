import type { VercelRequest, VercelResponse } from '@vercel/node';
import { bootstrapRequestSchema } from '../src/lib/validation';
import { assertMethod, handleError, HttpError, readJsonBody, sendJson } from './_lib/http';
import { adminClient } from './_lib/supabase';

/**
 * POST /api/bootstrap
 *
 * Creates the very first System Administrator. The endpoint refuses to run as
 * soon as an active administrator exists, so it cannot be used to escalate
 * privileges later. The password is passed straight to Supabase Auth and is
 * never stored or logged by this application.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    assertMethod(req, ['POST']);
    const body = await readJsonBody<Record<string, unknown>>(req);
    const parsed = bootstrapRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new HttpError(400, parsed.error.issues[0]?.message ?? 'Invalid administrator details.');
    }

    const admin = adminClient();
    const { count: existingAdmins, error: countError } = await admin
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('role', 'system_admin');
    if (countError) throw new HttpError(500, `Could not verify setup state: ${countError.message}`);
    if ((existingAdmins ?? 0) > 0) {
      throw new HttpError(409, 'This deployment already has an administrator. Sign in or ask them to create your access.');
    }

    const email = parsed.data.email.trim().toLowerCase();
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password: parsed.data.password,
      email_confirm: true,
      user_metadata: { full_name: parsed.data.full_name.trim() },
    });
    if (createError || !created.user) {
      throw new HttpError(400, createError?.message ?? 'The administrator account could not be created.');
    }

    // Re-check after creation to close the concurrent-bootstrap race window.
    const { count: adminsNow } = await admin
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('role', 'system_admin');
    if ((adminsNow ?? 0) > 1) {
      await admin.auth.admin.deleteUser(created.user.id).catch(() => undefined);
      throw new HttpError(409, 'Another administrator was created concurrently. Sign in with that account.');
    }

    const { data: profile, error: profileError } = await admin
      .from('profiles')
      .update({ role: 'system_admin', full_name: parsed.data.full_name.trim() })
      .eq('id', created.user.id)
      .select('*')
      .single();
    if (profileError) {
      await admin.auth.admin.deleteUser(created.user.id).catch(() => undefined);
      throw new HttpError(500, `The profile could not be promoted: ${profileError.message}`);
    }

    await admin.from('audit_events').insert({
      actor_id: created.user.id,
      actor_email: email,
      actor_role: 'system_admin',
      action: 'bootstrap.administrator_created',
      entity_type: 'profiles',
      entity_id: created.user.id,
      summary: 'First System Administrator provisioned through the one-time bootstrap flow',
      metadata: { email_domain: email.split('@')[1] ?? null },
    });

    sendJson(res, 201, { ok: true, profile });
  } catch (error) {
    handleError(res, error, 'bootstrap');
  }
}
