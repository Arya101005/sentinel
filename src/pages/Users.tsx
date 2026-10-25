import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { Resolver } from 'react-hook-form';
import { ShieldCheck, UserPlus, Users as UsersIcon } from 'lucide-react';
import type { z } from 'zod';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useInstitutions } from '@/lib/queries';
import { userInviteSchema } from '@/lib/validation';
import { ROLE_LABELS, type Profile, type Role } from '@/lib/types';
import { formatDateTime, initials } from '@/lib/format';
import { errorMessage } from '@/lib/utils';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Select,
  Spinner,
} from '@/components/ui/primitives';
import { Table, TableShell } from '@/components/ui/data-display';
import { Dialog, useToast } from '@/components/ui/overlays';

type InviteValues = z.infer<typeof userInviteSchema>;

export default function UsersPage() {
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const institutions = useInstitutions(true);
  const { push } = useToast();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [editing, setEditing] = useState<Profile | null>(null);
  const [editRole, setEditRole] = useState<Role>('institution_user');
  const [editInstitution, setEditInstitution] = useState('');
  const [editActive, setEditActive] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);

  const usersQuery = useQuery({
    queryKey: ['admin-users'],
    queryFn: () => api.listUsers(),
  });

  const form = useForm<InviteValues>({
    resolver: zodResolver(userInviteSchema) as unknown as Resolver<InviteValues>,
    defaultValues: { role: 'institution_user', email: '', full_name: '', password: '', institution_id: '' },
  });

  const createUser = useMutation({
    mutationFn: (values: InviteValues) =>
      api.createUser({
        email: values.email,
        full_name: values.full_name,
        role: values.role,
        institution_id: values.institution_id || undefined,
        password: values.password,
      }),
    onSuccess: async () => {
      setInviteOpen(false);
      form.reset({ role: 'institution_user', email: '', full_name: '', password: '', institution_id: '' });
      setInviteError(null);
      await queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      push({
        title: 'User created',
        description: 'The account is confirmed and can sign in. Share the temporary password through a secure channel — it is not displayed again.',
        tone: 'success',
      });
    },
    onError: (error) => setInviteError(errorMessage(error)),
  });

  const updateUser = useMutation({
    mutationFn: () =>
      api.updateUser(editing!.id, {
        role: editRole,
        institution_id: editInstitution || null,
        is_active: editActive,
      }),
    onSuccess: async () => {
      setEditing(null);
      setFormError(null);
      await queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      push({ title: 'User updated', description: 'The change was validated server-side and written to the audit trail.', tone: 'success' });
    },
    onError: (error) => setFormError(errorMessage(error)),
  });

  const openEdit = (user: Profile) => {
    setEditing(user);
    setEditRole(user.role);
    setEditInstitution(user.institution_id ?? '');
    setEditActive(user.is_active);
    setFormError(null);
  };

  const users = usersQuery.data?.users ?? [];

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Administration"
        title="Users & roles"
        description="Roles and institution assignment are validated by the server (service role) and guarded by database triggers. No user can grant themselves a privileged role."
        actions={
          <Button size="sm" onClick={() => setInviteOpen(true)}>
            <UserPlus className="h-4 w-4" /> Create user
          </Button>
        }
      />

      <Alert tone="info" title="Role model">
        <ul className="list-disc space-y-0.5 pl-4">
          <li><strong>System Administrator</strong> — institutions, users, settings, full record and audit access.</li>
          <li><strong>AICTE Officer</strong> — review records, verification decisions, discrepancies, release/renewal decisions.</li>
          <li><strong>Institution User</strong> — own institution only: submit records, documents, applications.</li>
          <li><strong>Read-only Auditor</strong> — read and export, no modifications or approvals.</li>
        </ul>
      </Alert>

      {usersQuery.error && (
        <Alert tone="danger" title="Users could not be loaded">
          {errorMessage(usersQuery.error)}
        </Alert>
      )}
      {usersQuery.isLoading ? (
        <Spinner label="Loading users…" />
      ) : (
        <TableShell>
          {users.length === 0 ? (
            <EmptyState icon={<UsersIcon className="h-5 w-5" />} title="No users" description="Create the first user account." />
          ) : (
            <Table>
              <thead>
                <tr>
                  <th>User</th>
                  <th>Role</th>
                  <th>Institution</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id}>
                    <td>
                      <div className="flex items-center gap-2.5">
                        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-navy-100 text-[11px] font-semibold text-navy-800">
                          {initials(user.full_name, user.email)}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-navy-900">
                            {user.full_name || '—'}
                            {user.id === profile?.id && (
                              <span className="ml-1.5 text-[10px] font-medium uppercase text-slate-400">you</span>
                            )}
                          </p>
                          <p className="truncate text-[11px] text-slate-500">{user.email}</p>
                        </div>
                      </div>
                    </td>
                    <td>
                      <Badge tone={user.role === 'system_admin' ? 'info' : user.role === 'aicte_officer' ? 'success' : 'neutral'}>
                        {ROLE_LABELS[user.role]}
                      </Badge>
                    </td>
                    <td className="max-w-[220px] truncate text-xs">
                      {institutions.data?.find((institution) => institution.id === user.institution_id)?.institution_name ?? '—'}
                    </td>
                    <td>
                      <Badge tone={user.is_active ? 'success' : 'danger'}>{user.is_active ? 'Active' : 'Disabled'}</Badge>
                    </td>
                    <td className="whitespace-nowrap text-[11px] text-slate-500">{formatDateTime(user.created_at)}</td>
                    <td className="text-right">
                      <Button variant="outline" size="sm" onClick={() => openEdit(user)}>
                        Manage
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </TableShell>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-slate-500" /> Bootstrap and recovery
          </CardTitle>
          <CardDescription>
            The first administrator is created from the one-time <code>/bootstrap</code> page, which stops working as soon as
            an administrator exists. There is no public endpoint that grants privileged roles.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-xs text-slate-600">
          If an administrator is locked out, reset the password through Supabase Auth (recovery email) — role assignment
          cannot be changed by the user themselves.
        </CardContent>
      </Card>

      {/* Invite dialog */}
      <Dialog
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        title="Create a user account"
        description="The account is created with a confirmed email address using the server-side admin API. Share the temporary password through a secure channel."
        footer={null}
      >
        <form
          className="space-y-3"
          onSubmit={form.handleSubmit((values) => createUser.mutate(values))}
          noValidate
        >
          {inviteError && (
            <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {inviteError}
            </div>
          )}
          <Field label="Full name" htmlFor="invite-name" error={form.formState.errors.full_name?.message} required>
            <Input id="invite-name" {...form.register('full_name')} />
          </Field>
          <Field label="Official email" htmlFor="invite-email" error={form.formState.errors.email?.message} required>
            <Input id="invite-email" type="email" {...form.register('email')} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Role" htmlFor="invite-role" error={form.formState.errors.role?.message} required>
              <Select id="invite-role" {...form.register('role')}>
                {(Object.keys(ROLE_LABELS) as Role[]).map((role) => (
                  <option key={role} value={role}>
                    {ROLE_LABELS[role]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Institution" htmlFor="invite-institution" hint="Required for institution users; optional otherwise.">
              <Select id="invite-institution" {...form.register('institution_id')}>
                <option value="">No institution</option>
                {(institutions.data ?? []).map((institution) => (
                  <option key={institution.id} value={institution.id}>
                    {institution.institution_name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field
            label="Temporary password"
            htmlFor="invite-password"
            hint="At least 10 characters. The user should change it after first sign-in."
            error={form.formState.errors.password?.message}
            required
          >
            <Input id="invite-password" type="text" autoComplete="new-password" {...form.register('password')} />
          </Field>
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={() => setInviteOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={createUser.isPending}>
              Create user
            </Button>
          </div>
        </form>
      </Dialog>

      {/* Edit dialog */}
      <Dialog
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing ? `Manage ${editing.full_name || editing.email}` : 'Manage user'}
        description="Role changes are applied through the server API and cannot be performed by the user themselves."
        footer={
          <>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button
              loading={updateUser.isPending}
              onClick={() => {
                if (editing && editing.id === profile?.id && (editRole !== editing.role || !editActive)) {
                  setFormError('You cannot change your own role or disable your own account.');
                  return;
                }
                updateUser.mutate();
              }}
            >
              Save changes
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {formError && (
            <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {formError}
            </div>
          )}
          <Field label="Role" htmlFor="edit-role">
            <Select id="edit-role" value={editRole} onChange={(event) => setEditRole(event.target.value as Role)}>
              {(Object.keys(ROLE_LABELS) as Role[]).map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABELS[role]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Institution" htmlFor="edit-institution">
            <Select id="edit-institution" value={editInstitution} onChange={(event) => setEditInstitution(event.target.value)}>
              <option value="">No institution</option>
              {(institutions.data ?? []).map((institution) => (
                <option key={institution.id} value={institution.id}>
                  {institution.institution_name}
                </option>
              ))}
            </Select>
          </Field>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-slate-300"
              checked={editActive}
              onChange={(event) => setEditActive(event.target.checked)}
            />
            Account is active (can sign in)
          </label>
        </div>
      </Dialog>
    </div>
  );
}
