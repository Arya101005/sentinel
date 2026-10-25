import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { userInviteSchema } from '../../src/lib/validation.js';
import { assertMethod, handleError, HttpError, readJsonBody, sendJson } from '../_lib/http.js';
import { requireAdmin, requireUser } from '../_lib/supabase.js';

const updateSchema = z.object({
  id: z.string().uuid('A valid user id is required'),
  role: z.enum(['system_admin', 'aicte_officer', 'institution_user', 'read_only_auditor']).optional(),
  institution_id: z.string().uuid().nullable().optional(),
  is_active: z.boolean().optional(),
  full_name: z.string().trim().min(2).max(120).optional(),
});

/**
 * GET   /api/admin/users   list all profiles (administrators only)
 * POST  /api/admin/users   create a confirmed user account with a role
 * PATCH /api/admin/users   change role / institution / active state
 *
 * These operations need elevated privileges, so they run server-side with the
 * service-role key. The caller is always re-authorised from their JWT and the
 * database profile — the browser cannot assert its own role.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const method = assertMethod(req, ['GET', 'POST', 'PATCH']);
    const context = await requireUser(req);
    requireAdmin(context);
    const { admin, profile: actor } = context;

    if (method === 'GET') {
      const { data, error } = await admin.from('profiles').select('*').order('full_name');
      if (error) throw new HttpError(500, error.message);
      sendJson(res, 200, { users: data ?? [] });
      return;
    }

    if (method === 'POST') {
      const body = await readJsonBody<Record<string, unknown>>(req);
      const parsed = userInviteSchema.safeParse(body);
      if (!parsed.success) {
        throw new HttpError(400, parsed.error.issues[0]?.message ?? 'Invalid user details.');
      }
      const { email, full_name, role, institution_id, password } = parsed.data;

      if (role === 'institution_user' && !institution_id) {
        throw new HttpError(400, 'An institution user must be assigned to an institution.');
      }
      if (institution_id) {
        const { data: institution } = await admin.from('institutions').select('id').eq('id', institution_id).maybeSingle();
        if (!institution) throw new HttpError(400, 'The selected institution does not exist.');
      }

      const normalizedEmail = email.trim().toLowerCase();
      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email: normalizedEmail,
        password,
        email_confirm: true,
        user_metadata: { full_name: full_name.trim(), institution_id: institution_id ?? null },
      });
      if (createError || !created.user) {
        throw new HttpError(400, createError?.message ?? 'The user could not be created.');
      }

      const { data: profile, error: profileError } = await admin
        .from('profiles')
        .update({
          role,
          institution_id: institution_id ?? null,
          full_name: full_name.trim(),
          email: normalizedEmail,
        })
        .eq('id', created.user.id)
        .select('*')
        .single();
      if (profileError) {
        await admin.auth.admin.deleteUser(created.user.id).catch(() => undefined);
        throw new HttpError(500, `The user profile could not be configured: ${profileError.message}`);
      }

      await admin.from('audit_events').insert({
        actor_id: actor.id,
        actor_email: actor.email,
        actor_role: actor.role,
        action: 'user.created',
        entity_type: 'profiles',
        entity_id: created.user.id,
        summary: `Created ${normalizedEmail} with role ${role}`,
        metadata: { role, institution_id: institution_id ?? null },
      });

      sendJson(res, 201, { user: profile });
      return;
    }

    // PATCH
    const body = await readJsonBody<Record<string, unknown>>(req);
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      throw new HttpError(400, parsed.error.issues[0]?.message ?? 'Invalid update.');
    }
    const { id, ...changes } = parsed.data;
    if (id === actor.id && (changes.role !== undefined || changes.is_active !== undefined)) {
      throw new HttpError(400, 'You cannot change your own role or disable your own account.');
    }
    if (changes.institution_id) {
      const { data: institution } = await admin.from('institutions').select('id').eq('id', changes.institution_id).maybeSingle();
      if (!institution) throw new HttpError(400, 'The selected institution does not exist.');
    }
    if (changes.role && changes.role !== 'institution_user') {
      const { data: target } = await admin.from('profiles').select('institution_id').eq('id', id).maybeSingle();
      if (!target) throw new HttpError(404, 'User not found.');
    }

    const patch: Record<string, unknown> = {};
    if (changes.role !== undefined) patch.role = changes.role;
    if (changes.institution_id !== undefined) patch.institution_id = changes.institution_id;
    if (changes.is_active !== undefined) patch.is_active = changes.is_active;
    if (changes.full_name !== undefined) patch.full_name = changes.full_name;
    if (Object.keys(patch).length === 0) throw new HttpError(400, 'No changes were supplied.');

    const { data: updated, error: updateError } = await admin
      .from('profiles')
      .update(patch)
      .eq('id', id)
      .select('*')
      .single();
    if (updateError) throw new HttpError(400, updateError.message);

    await admin.from('audit_events').insert({
      actor_id: actor.id,
      actor_email: actor.email,
      actor_role: actor.role,
      action: 'user.updated',
      entity_type: 'profiles',
      entity_id: id,
      summary: `Updated account ${updated.email}`,
      metadata: { changes: Object.keys(patch), role: updated.role },
    });

    sendJson(res, 200, { user: updated });
  } catch (error) {
    handleError(res, error, 'admin/users');
  }
}
