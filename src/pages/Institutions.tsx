import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { Resolver } from 'react-hook-form';
import { Building2, Plus } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { institutionSchema, type InstitutionFormValues } from '@/lib/validation';
import type { Institution } from '@/lib/types';
import { formatDateTime } from '@/lib/format';
import { errorMessage } from '@/lib/utils';
import {
  Alert,
  Badge,
  Button,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Select,
  Spinner,
} from '@/components/ui/primitives';
import { Table, TableShell } from '@/components/ui/data-display';
import { Dialog, useToast } from '@/components/ui/overlays';

const TYPES = ['Engineering', 'Management', 'Pharmacy', 'Architecture', 'Hotel Management', 'Applied Arts', 'Other'] as const;

type InstitutionRow = Institution & { fdr_records?: Array<{ count: number }> };

const EMPTY: InstitutionFormValues = {
  institution_code: '',
  institution_name: '',
  institution_type: 'Engineering',
  region: '',
  address: '',
  contact_email: '',
  contact_phone: '',
  status: 'active',
};

export default function InstitutionsPage() {
  const queryClient = useQueryClient();
  const { push } = useToast();
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ['institutions-admin'],
    queryFn: async (): Promise<InstitutionRow[]> => {
      const { data, error } = await supabase
        .from('institutions')
        .select('*, fdr_records(count)')
        .order('institution_name');
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as InstitutionRow[];
    },
  });

  const form = useForm<InstitutionFormValues>({
    resolver: zodResolver(institutionSchema) as unknown as Resolver<InstitutionFormValues>,
    defaultValues: EMPTY,
  });

  const save = useMutation({
    mutationFn: async (values: InstitutionFormValues) => {
      const parsed = institutionSchema.parse(values);
      const payload = {
        institution_code: parsed.institution_code,
        institution_name: parsed.institution_name,
        institution_type: parsed.institution_type,
        region: parsed.region ?? null,
        address: parsed.address ?? null,
        contact_email: parsed.contact_email ?? null,
        contact_phone: parsed.contact_phone ?? null,
        status: parsed.status,
      };
      if (editingId) {
        const { error } = await supabase.from('institutions').update(payload).eq('id', editingId);
        if (error) throw new Error(error.message);
      } else {
        const { error } = await supabase.from('institutions').insert(payload);
        if (error) {
          if (error.code === '23505') throw new Error('An institution with that code already exists.');
          throw new Error(error.message);
        }
      }
    },
    onSuccess: async () => {
      setFormOpen(false);
      setEditingId(null);
      setFormError(null);
      form.reset(EMPTY);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['institutions-admin'] }),
        queryClient.invalidateQueries({ queryKey: ['institutions'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] }),
      ]);
      push({ title: 'Institution saved', description: 'The change is recorded in the audit trail.', tone: 'success' });
    },
    onError: (error) => setFormError(errorMessage(error)),
  });

  const openCreate = () => {
    setEditingId(null);
    form.reset(EMPTY);
    setFormError(null);
    setFormOpen(true);
  };

  const openEdit = (institution: InstitutionRow) => {
    setEditingId(institution.id);
    form.reset({
      institution_code: institution.institution_code,
      institution_name: institution.institution_name,
      institution_type: institution.institution_type as InstitutionFormValues['institution_type'],
      region: institution.region ?? '',
      address: institution.address ?? '',
      contact_email: institution.contact_email ?? '',
      contact_phone: institution.contact_phone ?? '',
      status: institution.status,
    });
    setFormError(null);
    setFormOpen(true);
  };

  const rows = query.data ?? [];

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Administration"
        title="Institutions"
        description="Master data for institutions whose security deposit FDRs are monitored. Institution users are always scoped to exactly one institution by Row Level Security."
        actions={
          <Button size="sm" onClick={openCreate}>
            <Plus className="h-4 w-4" /> Add institution
          </Button>
        }
      />

      {query.error && (
        <Alert tone="danger" title="Institutions could not be loaded">
          {errorMessage(query.error)}
        </Alert>
      )}

      <TableShell>
        {query.isLoading ? (
          <Spinner label="Loading institutions…" />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<Building2 className="h-5 w-5" />}
            title="No institutions yet"
            description="Add institutions before creating institution users or registering FDRs."
            action={<Button size="sm" onClick={openCreate}>Add the first institution</Button>}
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <th>Institution</th>
                <th>Type</th>
                <th>Region</th>
                <th className="text-right">FDRs</th>
                <th>Status</th>
                <th>Updated</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((institution) => (
                <tr key={institution.id}>
                  <td>
                    <p className="text-sm font-medium text-navy-900">
                      {institution.institution_name}
                      {institution.is_demo && (
                        <span className="ml-1.5 rounded bg-amber-100 px-1 py-0.5 text-[9px] font-semibold uppercase text-amber-800">
                          demo
                        </span>
                      )}
                    </p>
                    <p className="text-[11px] text-slate-500">{institution.institution_code}</p>
                  </td>
                  <td className="text-xs">{institution.institution_type}</td>
                  <td className="text-xs">{institution.region ?? '—'}</td>
                  <td className="text-right text-xs">{institution.fdr_records?.[0]?.count ?? 0}</td>
                  <td>
                    <Badge tone={institution.status === 'active' ? 'success' : 'neutral'}>{institution.status}</Badge>
                  </td>
                  <td className="whitespace-nowrap text-[11px] text-slate-500">{formatDateTime(institution.updated_at)}</td>
                  <td className="text-right">
                    <Button variant="outline" size="sm" onClick={() => openEdit(institution)}>
                      Edit
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </TableShell>

      <p className="text-[11px] text-slate-500">
        Institutions with FDR records cannot be deleted (foreign-key restriction); mark them inactive instead so history is
        preserved.
      </p>

      <Dialog
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editingId ? 'Edit institution' : 'Add institution'}
        description="Codes must be unique. Changes are audited."
        footer={
          <>
            <Button variant="outline" onClick={() => setFormOpen(false)}>
              Cancel
            </Button>
            <Button loading={save.isPending} onClick={form.handleSubmit((values) => save.mutate(values))}>
              Save institution
            </Button>
          </>
        }
      >
        <form className="space-y-3" onSubmit={form.handleSubmit((values) => save.mutate(values))} noValidate>
          {formError && (
            <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {formError}
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Institution code" htmlFor="institution_code" error={form.formState.errors.institution_code?.message} required>
              <Input id="institution_code" placeholder="e.g. NIT-TRICHY" className="uppercase" {...form.register('institution_code')} />
            </Field>
            <Field label="Type" htmlFor="institution_type" error={form.formState.errors.institution_type?.message} required>
              <Select id="institution_type" {...form.register('institution_type')}>
                {TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="Institution name" htmlFor="institution_name" error={form.formState.errors.institution_name?.message} required>
            <Input id="institution_name" {...form.register('institution_name')} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Region / state" htmlFor="region" error={form.formState.errors.region?.message}>
              <Input id="region" {...form.register('region')} />
            </Field>
            <Field label="Status" htmlFor="status">
              <Select id="status" {...form.register('status')}>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </Select>
            </Field>
          </div>
          <Field label="Address" htmlFor="address" error={form.formState.errors.address?.message}>
            <Input id="address" {...form.register('address')} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Contact email" htmlFor="contact_email" error={form.formState.errors.contact_email?.message}>
              <Input id="contact_email" type="email" {...form.register('contact_email')} />
            </Field>
            <Field label="Contact phone" htmlFor="contact_phone" error={form.formState.errors.contact_phone?.message}>
              <Input id="contact_phone" {...form.register('contact_phone')} />
            </Field>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
