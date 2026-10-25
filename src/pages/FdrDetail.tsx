import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useForm, type FieldErrors, type UseFormRegister } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Resolver } from 'react-hook-form';
import {
  ArrowLeft,
  Archive,
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  FilePlus2,
  FileText,
  History,
  Pencil,
  Plus,
  Save,
  ShieldAlert,
  ShieldCheck,
  X,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { useInstitutions, useLogEvent, useProfiles, useSettings } from '@/lib/queries';
import { can } from '@/lib/permissions';
import { classifyMaturity, todayInPolicyZone } from '@/lib/maturity';
import { findLikelyDuplicates, type DuplicateCandidate } from '@/lib/duplicates';
import { runDiscrepancyRules } from '@/lib/verification';
import { fdrFormSchema, applicationSchema, type FdrFormValues } from '@/lib/validation';
import type { FdrDocument, FdrRecord, Institution, ReleaseApplication, VerificationEvent } from '@/lib/types';
import {
  ADMINISTRATIVE_LABELS,
  APPLICATION_TYPE_LABELS,
  RENEWAL_LABELS,
  VERIFICATION_LABELS,
  formatCurrency,
  formatDate,
  formatDateTime,
  humanize,
} from '@/lib/format';
import { errorMessage } from '@/lib/utils';
import { DocumentPanel } from '@/components/DocumentPanel';
import { DiscrepancyPanel } from '@/components/DiscrepancyPanel';
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
  Textarea,
} from '@/components/ui/primitives';
import {
  AdministrativeBadge,
  ApplicationStatusBadge,
  MaturityBadge,
  RenewalBadge,
  Tabs,
  VerificationBadge,
} from '@/components/ui/data-display';
import { Dialog, useToast } from '@/components/ui/overlays';

type TabKey = 'overview' | 'documents' | 'discrepancies' | 'applications' | 'timeline';

function toFormValues(record: FdrRecord): FdrFormValues {
  return {
    institution_id: record.institution_id,
    fdr_reference_number: record.fdr_reference_number,
    issuing_bank: record.issuing_bank,
    branch_name: record.branch_name ?? undefined,
    deposit_amount: record.deposit_amount,
    issue_date: record.issue_date,
    maturity_date: record.maturity_date,
    notes: record.notes ?? undefined,
  };
}

function FdrFields({
  register,
  errors,
  institutions,
  institutionLocked,
}: {
  register: UseFormRegister<FdrFormValues>;
  errors: FieldErrors<FdrFormValues>;
  institutions: Institution[];
  institutionLocked: boolean;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Institution" htmlFor="institution_id" error={errors.institution_id?.message} required>
        <Select
          id="institution_id"
          disabled={institutionLocked}
          aria-invalid={!!errors.institution_id}
          {...register('institution_id')}
        >
          <option value="">Select an institution…</option>
          {institutions.map((institution) => (
            <option key={institution.id} value={institution.id}>
              {institution.institution_name} ({institution.institution_code})
            </option>
          ))}
        </Select>
      </Field>

      <Field label="FDR reference number" htmlFor="fdr_reference_number" error={errors.fdr_reference_number?.message} required>
        <Input
          id="fdr_reference_number"
          aria-invalid={!!errors.fdr_reference_number}
          placeholder="e.g. SBI/FDR/2024/00123"
          {...register('fdr_reference_number')}
        />
      </Field>

      <Field label="Issuing bank" htmlFor="issuing_bank" error={errors.issuing_bank?.message} required>
        <Input id="issuing_bank" aria-invalid={!!errors.issuing_bank} placeholder="e.g. State Bank of India" {...register('issuing_bank')} />
      </Field>

      <Field label="Branch (optional)" htmlFor="branch_name" error={errors.branch_name?.message}>
        <Input id="branch_name" placeholder="e.g. Connaught Place, New Delhi" {...register('branch_name')} />
      </Field>

      <Field
        label="Deposit amount (INR)"
        htmlFor="deposit_amount"
        error={errors.deposit_amount?.message}
        hint="Stored as an exact numeric value, never floating point."
        required
      >
        <Input
          id="deposit_amount"
          type="number"
          step="0.01"
          min="0"
          inputMode="decimal"
          aria-invalid={!!errors.deposit_amount}
          {...register('deposit_amount')}
        />
      </Field>

      <Field label="Issue date" htmlFor="issue_date" error={errors.issue_date?.message} required>
        <Input id="issue_date" type="date" aria-invalid={!!errors.issue_date} {...register('issue_date')} />
      </Field>

      <Field label="Maturity date" htmlFor="maturity_date" error={errors.maturity_date?.message} required>
        <Input id="maturity_date" type="date" aria-invalid={!!errors.maturity_date} {...register('maturity_date')} />
      </Field>

      <Field label="Notes (optional)" htmlFor="notes" error={errors.notes?.message} className="sm:col-span-2">
        <Textarea id="notes" rows={2} placeholder="Any context for reviewers (linked release file, renewal reference, etc.)" {...register('notes')} />
      </Field>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Create                                                                     */
/* -------------------------------------------------------------------------- */
function CreateFdr() {
  const { role, profile, institutionId } = useAuth();
  const institutions = useInstitutions();
  const navigate = useNavigate();
  const { push } = useToast();
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [duplicates, setDuplicates] = useState<DuplicateCandidate[]>([]);
  const [pendingValues, setPendingValues] = useState<ReturnType<typeof fdrFormSchema.parse> | null>(null);

  const today = todayInPolicyZone();
  const nextYear = `${Number(today.slice(0, 4)) + 1}${today.slice(4)}`;
  const form = useForm<FdrFormValues>({
    resolver: zodResolver(fdrFormSchema) as unknown as Resolver<FdrFormValues>,
    defaultValues: {
      institution_id: institutionId ?? '',
      fdr_reference_number: '',
      issuing_bank: '',
      branch_name: '',
      deposit_amount: '' as unknown as number,
      issue_date: today,
      maturity_date: nextYear,
      notes: '',
    },
  });

  const createRecord = async (parsed: ReturnType<typeof fdrFormSchema.parse>) => {
    setSaving(true);
    setFormError(null);
    try {
      const { data, error } = await supabase
        .from('fdr_records')
        .insert({
          institution_id: parsed.institution_id,
          fdr_reference_number: parsed.fdr_reference_number,
          issuing_bank: parsed.issuing_bank,
          branch_name: parsed.branch_name ?? null,
          deposit_amount: parsed.deposit_amount,
          issue_date: parsed.issue_date,
          maturity_date: parsed.maturity_date,
          notes: parsed.notes ?? null,
          created_by: profile?.id ?? null,
          verification_status: 'pending',
        })
        .select('*')
        .single();

      if (error) {
        if (error.code === '23505') {
          throw new Error('An FDR with this reference number already exists for the institution. Open the existing record instead of creating a duplicate.');
        }
        throw new Error(error.message);
      }

      const record = data as FdrRecord;
      await runDiscrepancyRules(record, { hasDocument: false }).catch(() => undefined);
      await queryClient.invalidateQueries({ queryKey: ['fdrs'] });
      await queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] });
      push({
        title: 'FDR record created',
        description: 'Upload the FDR receipt next so an officer can compare the document with these values.',
        tone: 'success',
      });
      navigate(`/fdrs/${record.id}`);
    } catch (error) {
      setFormError(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const onSubmit = form.handleSubmit(async (values) => {
    const parsedResult = fdrFormSchema.safeParse(values);
    if (!parsedResult.success) {
      setFormError(parsedResult.error.issues[0]?.message ?? 'Check the highlighted fields.');
      return;
    }
    const parsed = parsedResult.data;
    setFormError(null);

    const { data: siblings, error: siblingError } = await supabase
      .from('fdr_records')
      .select('id, fdr_reference_number, issuing_bank, deposit_amount, issue_date, maturity_date')
      .eq('institution_id', parsed.institution_id)
      .is('archived_at', null)
      .limit(300);
    if (siblingError) {
      setFormError(siblingError.message);
      return;
    }
    const candidates = findLikelyDuplicates(parsed, (siblings ?? []) as never[]);
    const blocking = candidates.filter((candidate) => candidate.severity === 'critical');
    if (blocking.length > 0) {
      setDuplicates(blocking);
      setPendingValues(parsed);
      return;
    }
    await createRecord(parsed);
  });

  return (
    <div className="space-y-4">
      <div>
        <Link to="/fdrs" className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-navy-800">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to registry
        </Link>
      </div>
      <PageHeader
        eyebrow="Module B"
        title="Register a new FDR"
        description="Only the institution, reference, bank, amount and dates are required. Upload the receipt after saving so the document can be compared with these values."
      />

      <Card>
        <CardHeader>
          <CardTitle>Instrument details</CardTitle>
          <CardDescription>
            Amounts are validated and stored as numeric(14,2). Reference numbers are unique per institution among live
            records — the database rejects accidental duplicates.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} noValidate className="space-y-4">
            {formError && (
              <Alert tone="danger" title="Could not create the record">
                {formError}
              </Alert>
            )}
            <FdrFields
              register={form.register}
              errors={form.formState.errors}
              institutions={institutions.data ?? []}
              institutionLocked={role === 'institution_user'}
            />
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => navigate('/fdrs')}>
                Cancel
              </Button>
              <Button type="submit" loading={saving}>
                <FilePlus2 className="h-4 w-4" /> Create record
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Dialog
        open={duplicates.length > 0}
        onClose={() => {
          setDuplicates([]);
          setPendingValues(null);
        }}
        title="Possible duplicate instrument"
        description="A record with this reference already exists. Records are never merged automatically."
        footer={
          <>
            <Button
              variant="outline"
              onClick={() => {
                setDuplicates([]);
                setPendingValues(null);
              }}
            >
              <X className="h-3.5 w-3.5" /> Cancel
            </Button>
            {role !== 'read_only_auditor' && (
              <Button
                variant="danger"
                loading={saving}
                onClick={() => {
                  if (pendingValues) void createRecord(pendingValues);
                }}
              >
                Create anyway (needs review)
              </Button>
            )}
          </>
        }
      >
        <ul className="space-y-2">
          {duplicates.map((candidate, index) => (
            <li key={`${candidate.record.id}-${index}`} className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm">
              <p className="font-medium text-amber-900">{candidate.record.fdr_reference_number}</p>
              <p className="mt-0.5 text-xs text-amber-800">
                {candidate.record.issuing_bank} · {formatCurrency(candidate.record.deposit_amount)} · matures{' '}
                {formatDate(candidate.record.maturity_date)}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-amber-900">{candidate.reason}</p>
              {candidate.record.id && (
                <Link
                  to={`/fdrs/${candidate.record.id}`}
                  className="mt-1 inline-block text-xs font-medium text-navy-800 underline"
                >
                  Open existing record
                </Link>
              )}
            </li>
          ))}
        </ul>
      </Dialog>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Detail                                                                     */
/* -------------------------------------------------------------------------- */
function ViewFdr({ id }: { id: string }) {
  const { role, profile } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { push } = useToast();
  const settings = useSettings();
  const profiles = useProfiles();
  const logEvent = useLogEvent();
  const institutionsList = useInstitutions();

  const [tab, setTab] = useState<TabKey>('overview');
  const [editing, setEditing] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [verifyOpen, setVerifyOpen] = useState(false);
  const [decision, setDecision] = useState<'in_review' | 'verified' | 'rejected'>('verified');
  const [observations, setObservations] = useState('');
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [applicationOpen, setApplicationOpen] = useState(false);
  const [applicationError, setApplicationError] = useState<string | null>(null);
  const [applicationSaving, setApplicationSaving] = useState(false);
  const pendingPatch = useRef<Record<string, string> | null>(null);

  const fdrQuery = useQuery({
    queryKey: ['fdr', id],
    queryFn: async (): Promise<FdrRecord | null> => {
      const { data, error } = await supabase
        .from('fdr_records')
        .select('*, institutions(id, institution_name, institution_code)')
        .eq('id', id)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return (data as FdrRecord | null) ?? null;
    },
  });

  const eventsQuery = useQuery({
    queryKey: ['verification-events', id],
    queryFn: async (): Promise<VerificationEvent[]> => {
      const { data, error } = await supabase
        .from('verification_events')
        .select('*')
        .eq('fdr_id', id)
        .order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as VerificationEvent[];
    },
  });

  const documentsQuery = useQuery({
    queryKey: ['fdr-documents', id],
    queryFn: async (): Promise<FdrDocument[]> => {
      const { data, error } = await supabase.from('fdr_documents').select('*').eq('fdr_id', id);
      if (error) throw new Error(error.message);
      return (data ?? []) as FdrDocument[];
    },
  });

  const applicationsQuery = useQuery({
    queryKey: ['fdr-applications', id],
    queryFn: async (): Promise<ReleaseApplication[]> => {
      const { data, error } = await supabase
        .from('release_applications')
        .select('*')
        .eq('fdr_id', id)
        .order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as ReleaseApplication[];
    },
  });

  const form = useForm<FdrFormValues>({
    resolver: zodResolver(fdrFormSchema) as unknown as Resolver<FdrFormValues>,
  });

  const record = fdrQuery.data;
  const warningDays = useMemo(() => settings.data?.warningDays ?? [30, 15, 7], [settings.data?.warningDays]);
  const today = todayInPolicyZone();

  const maturity = useMemo(() => {
    if (!record) return null;
    return classifyMaturity(
      {
        maturity_date: record.maturity_date,
        validity_status: record.validity_status,
        archived_at: record.archived_at,
        release_application_statuses: (applicationsQuery.data ?? [])
          .filter((application) => application.application_type === 'release')
          .map((application) => application.status),
      },
      today,
      warningDays,
    );
  }, [record, applicationsQuery.data, today, warningDays]);

  useEffect(() => {
    if (!record || !editing) return;
    form.reset(toFormValues(record));
    if (pendingPatch.current) {
      for (const [key, value] of Object.entries(pendingPatch.current)) {
        form.setValue(key as keyof FdrFormValues, value as never, { shouldDirty: true });
      }
      pendingPatch.current = null;
    }
  }, [record, editing, form]);

  const nameOf = (actorId: string | null | undefined): string => {
    if (!actorId) return 'System';
    const match = (profiles.data ?? []).find((entry) => entry.id === actorId);
    if (match) return match.full_name || match.email;
    if (actorId === profile?.id) return profile?.full_name || 'You';
    return 'AICTE user';
  };

  const applyOcrField = (field: string, value: string) => {
    const key = field as keyof FdrFormValues;
    if (!['fdr_reference_number', 'issuing_bank', 'branch_name', 'deposit_amount', 'issue_date', 'maturity_date'].includes(field)) return;
    if (!editing) {
      pendingPatch.current = { [field]: value };
      setEditing(true);
    } else {
      form.setValue(key, value as never, { shouldDirty: true });
    }
    push({
      title: 'Candidate value applied to the form',
      description: 'It is not saved yet. Compare it with the document, then save the record.',
      tone: 'info',
    });
    setTab('overview');
  };

  const refreshAll = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['fdr', id] }),
      queryClient.invalidateQueries({ queryKey: ['discrepancy-flags', id] }),
      queryClient.invalidateQueries({ queryKey: ['verification-events', id] }),
      queryClient.invalidateQueries({ queryKey: ['fdr-applications', id] }),
      queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] }),
      queryClient.invalidateQueries({ queryKey: ['fdrs'] }),
    ]);
  };

  const saveRecord = form.handleSubmit(async (values) => {
    if (!record) return;
    const parsedResult = fdrFormSchema.safeParse(values);
    if (!parsedResult.success) {
      setFormError(parsedResult.error.issues[0]?.message ?? 'Check the highlighted fields.');
      return;
    }
    const parsed = parsedResult.data;
    setSaving(true);
    setFormError(null);
    try {
      const { data, error } = await supabase
        .from('fdr_records')
        .update({
          institution_id: parsed.institution_id,
          fdr_reference_number: parsed.fdr_reference_number,
          issuing_bank: parsed.issuing_bank,
          branch_name: parsed.branch_name ?? null,
          deposit_amount: parsed.deposit_amount,
          issue_date: parsed.issue_date,
          maturity_date: parsed.maturity_date,
          notes: parsed.notes ?? null,
        })
        .eq('id', record.id)
        .select('*')
        .single();
      if (error) {
        if (error.code === '23505') throw new Error('Another live FDR in this institution already uses that reference number.');
        throw new Error(error.message);
      }
      await runDiscrepancyRules(data as FdrRecord).catch(() => undefined);
      setEditing(false);
      await refreshAll();
      push({ title: 'Record updated', description: 'Verification rules were re-run and the change is in the audit trail.', tone: 'success' });
    } catch (error) {
      setFormError(errorMessage(error));
    } finally {
      setSaving(false);
    }
  });

  const verifyMutation = useMutation({
    mutationFn: async () => {
      if (!record) throw new Error('Record not loaded');
      if (decision === 'rejected' && observations.trim().length < 5) {
        throw new Error('Record an observation explaining the rejection.');
      }
      const { error } = await supabase.rpc('fn_verify_fdr', {
        p_fdr_id: record.id,
        p_decision: decision,
        p_observations: observations.trim() || null,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => {
      setVerifyOpen(false);
      setObservations('');
      await refreshAll();
      push({
        title: `Record marked "${VERIFICATION_LABELS[decision]}"`,
        description: 'The decision was recorded against your account with a timestamp. It reflects a document review, not bank attestation.',
        tone: 'success',
      });
    },
    onError: (error) => setFormError(errorMessage(error)),
  });

  const archiveMutation = useMutation({
    mutationFn: async () => {
      if (!record) throw new Error('Record not loaded');
      const { error } = await supabase
        .from('fdr_records')
        .update({ archived_at: new Date().toISOString(), administrative_status: 'archived' })
        .eq('id', record.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => {
      setArchiveOpen(false);
      await refreshAll();
      push({ title: 'Record archived', description: 'The record is hidden from active monitoring but its history is retained.', tone: 'success' });
    },
    onError: (error) => push({ title: 'Archive failed', description: errorMessage(error), tone: 'error' }),
  });

  const createApplication = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!record) return;
    const formData = new FormData(event.currentTarget);
    const parsed = applicationSchema.safeParse({
      fdr_id: record.id,
      application_type: formData.get('application_type'),
      reason: formData.get('reason'),
      amount_claimed: formData.get('amount_claimed') || undefined,
      supporting_notes: formData.get('supporting_notes') || undefined,
    });
    if (!parsed.success) {
      setApplicationError(parsed.error.issues[0]?.message ?? 'Check the request details.');
      return;
    }
    setApplicationSaving(true);
    setApplicationError(null);
    try {
      const { data, error } = await supabase
        .from('release_applications')
        .insert({
          fdr_id: record.id,
          institution_id: record.institution_id,
          application_type: parsed.data.application_type,
          reason: parsed.data.reason,
          amount_claimed: parsed.data.amount_claimed ?? null,
          supporting_notes: parsed.data.supporting_notes ?? null,
          status: 'submitted',
          requested_by: profile?.id ?? null,
        })
        .select('id, application_no')
        .single();
      if (error) throw new Error(error.message);
      await logEvent.mutateAsync({
        action: 'application.submitted',
        entity_type: 'release_applications',
        entity_id: data.id,
        summary: `${parsed.data.application_type} application ${data.application_no} submitted`,
        metadata: { fdr_id: record.id },
      });
      await refreshAll();
      push({ title: 'Application submitted', description: `${data.application_no} is now waiting for AICTE review.`, tone: 'success' });
      navigate(`/applications/${data.id}`);
    } catch (error) {
      setApplicationError(errorMessage(error));
    } finally {
      setApplicationSaving(false);
    }
  };

  if (fdrQuery.isLoading) return <Spinner label="Loading the FDR record…" />;
  if (fdrQuery.error) {
    return (
      <Alert tone="danger" title="The record could not be loaded">
        {errorMessage(fdrQuery.error)}
      </Alert>
    );
  }
  if (!record) {
    return (
      <div className="space-y-3">
        <Alert tone="warning" title="Record not found or not accessible">
          This record does not exist, or it belongs to an institution outside your authorised scope.
        </Alert>
        <Link to="/fdrs">
          <Button variant="outline" size="sm">
            <ArrowLeft className="h-3.5 w-3.5" /> Back to registry
          </Button>
        </Link>
      </div>
    );
  }

  const editable = can(role, 'edit_fdr') && !record.archived_at;
  const openFlags = (applicationsQuery.data ?? []).length;
  const applications = applicationsQuery.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link to="/fdrs" className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-navy-800">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to registry
        </Link>
        <div className="flex flex-wrap gap-2">
          {can(role, 'submit_application') && !record.archived_at && (
            <Button size="sm" variant="outline" onClick={() => setApplicationOpen(true)}>
              <Plus className="h-3.5 w-3.5" /> New release / renewal request
            </Button>
          )}
          {can(role, 'archive_fdr') && !record.archived_at && (
            <Button size="sm" variant="ghost" onClick={() => setArchiveOpen(true)}>
              <Archive className="h-3.5 w-3.5" /> Archive
            </Button>
          )}
          {can(role, 'verify_fdr') && !record.archived_at && (
            <Button size="sm" onClick={() => setVerifyOpen(true)}>
              <ClipboardCheck className="h-4 w-4" /> Record verification decision
            </Button>
          )}
          {editable && !editing && (
            <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
              <Pencil className="h-3.5 w-3.5" /> Edit
            </Button>
          )}
        </div>
      </div>

      <PageHeader
        eyebrow={record.institutions?.institution_name ?? 'Institution'}
        title={record.fdr_reference_number}
        description={
          <div className="flex flex-wrap items-center gap-1.5">
            {record.is_demo && <Badge tone="warning">Demonstration data</Badge>}
            <VerificationBadge status={record.verification_status} />
            <AdministrativeBadge status={record.administrative_status} />
            <RenewalBadge status={record.renewal_status} />
            {maturity && <MaturityBadge state={maturity.state} label={maturity.label} />}
            {record.archived_at && <Badge tone="outline">Archived</Badge>}
          </div>
        }
      />

      {record.is_demo && (
        <Alert tone="warning" title="Synthetic demonstration record">
          This record is synthetic data created for demonstration. It has not been verified by a bank or by AICTE.
        </Alert>
      )}

      {formError && (
        <Alert tone="danger" title="Action failed">
          {formError}
        </Alert>
      )}

      <Tabs<TabKey>
        value={tab}
        onChange={setTab}
        options={[
          { value: 'overview', label: 'Overview' },
          { value: 'documents', label: 'Documents & OCR', count: documentsQuery.data?.length },
          { value: 'discrepancies', label: 'Discrepancies' },
          { value: 'applications', label: 'Applications', count: openFlags },
          { value: 'timeline', label: 'Verification timeline', count: eventsQuery.data?.length },
        ]}
      />

      {tab === 'overview' && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader className="flex-row items-center justify-between">
              <div>
                <CardTitle>Instrument details</CardTitle>
                <CardDescription>Values submitted by the institution. Officer review is recorded separately.</CardDescription>
              </div>
              {editing && (
                <div className="flex gap-1.5">
                  <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
                    Cancel
                  </Button>
                  <Button size="sm" loading={saving} onClick={() => void saveRecord()}>
                    <Save className="h-3.5 w-3.5" /> Save
                  </Button>
                </div>
              )}
            </CardHeader>
            <CardContent>
              {editing ? (
                <form onSubmit={(event) => { event.preventDefault(); void saveRecord(); }} noValidate>
                  <FdrFields
                    register={form.register}
                    errors={form.formState.errors}
                    institutions={institutionsList.data ?? []}
                    institutionLocked={role === 'institution_user'}
                  />
                  <p className="mt-3 text-[11px] text-slate-500">
                    Saving re-runs the verification rules. Verification and administrative status cannot be changed here —
                    those remain officer decisions.
                  </p>
                </form>
              ) : (
                <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                  {[
                    ['Institution', record.institutions?.institution_name ?? '—'],
                    ['Institution code', record.institutions?.institution_code ?? '—'],
                    ['Issuing bank', record.issuing_bank],
                    ['Branch', record.branch_name ?? '—'],
                    ['Deposit amount', formatCurrency(record.deposit_amount)],
                    ['Issue date', formatDate(record.issue_date)],
                    ['Maturity date', formatDate(record.maturity_date)],
                    ['Days to maturity', maturity ? String(maturity.daysToMaturity) : '—'],
                    ['Renewal status', RENEWAL_LABELS[record.renewal_status]],
                    ['Administrative status', ADMINISTRATIVE_LABELS[record.administrative_status]],
                    ['Submitted', formatDateTime(record.submitted_at)],
                    ['Last officer verification', formatDateTime(record.last_verified_at)],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
                      <dd className="mt-0.5 text-sm text-slate-800">{value}</dd>
                    </div>
                  ))}
                  {record.notes && (
                    <div className="sm:col-span-2">
                      <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Notes</dt>
                      <dd className="mt-0.5 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{record.notes}</dd>
                    </div>
                  )}
                </dl>
              )}
            </CardContent>
          </Card>

          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Provenance</CardTitle>
                <CardDescription>What each value source actually means.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-xs">
                <div className="rounded-md border border-slate-200 bg-slate-50 p-2.5">
                  <p className="font-semibold text-slate-700">Submitted by institution</p>
                  <p className="mt-0.5 text-slate-600">
                    {formatDateTime(record.submitted_at)} · unverified data entry
                  </p>
                </div>
                <div className="rounded-md border border-slate-200 bg-slate-50 p-2.5">
                  <p className="font-semibold text-slate-700">OCR-extracted (candidate only)</p>
                  <p className="mt-0.5 text-slate-600">
                    {documentsQuery.data?.some((document) => document.ocr_status === 'completed')
                      ? 'A document has been processed. See Documents & OCR for values and confidence.'
                      : 'No successful OCR run yet.'}
                  </p>
                </div>
                <div className="rounded-md border border-slate-200 bg-slate-50 p-2.5">
                  <p className="font-semibold text-slate-700">Officer-reviewed</p>
                  <p className="mt-0.5 text-slate-600">
                    {record.last_verified_at
                      ? `${formatDateTime(record.last_verified_at)} · ${VERIFICATION_LABELS[record.verification_status]}`
                      : 'No officer decision recorded.'}
                  </p>
                </div>
                {!settings.data?.externalBankVerification && (
                  <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-slate-500">
                    <ShieldAlert className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                    No independent bank verification service is connected, so no interface in this application can claim
                    bank-verified authenticity.
                  </p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Follow-up</CardTitle>
                <CardDescription>Maturity monitor position</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-slate-700">
                {maturity ? (
                  <>
                    <p className="flex items-center gap-2">
                      <CalendarClock className="h-4 w-4 text-slate-400" />
                      {maturity.requiresFollowUp
                        ? maturity.state === 'matured_no_application'
                          ? 'Matured with no recorded release application. Confirm the current status with the institution.'
                          : 'Inside the configured warning window. Follow up on renewal or release paperwork.'
                        : 'No immediate maturity follow-up is required.'}
                    </p>
                    <Link to="/maturity" className="inline-block text-xs font-medium text-navy-700 hover:underline">
                      Open maturity monitor
                    </Link>
                  </>
                ) : (
                  <p>—</p>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {tab === 'documents' && (
        <DocumentPanel
          fdr={record}
          canEdit={can(role, 'upload_document') && !record.archived_at}
          onApplyField={applyOcrField}
          onFlagsUpdated={() => void refreshAll()}
        />
      )}

      {tab === 'discrepancies' && (
        <DiscrepancyPanel fdrId={record.id} canReview={can(role, 'review_discrepancy')} />
      )}

      {tab === 'applications' && (
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle>Release & renewal requests</CardTitle>
              <CardDescription>Each application follows a controlled lifecycle with recorded decisions.</CardDescription>
            </div>
            {can(role, 'submit_application') && !record.archived_at && (
              <Button size="sm" variant="outline" onClick={() => setApplicationOpen(true)}>
                <Plus className="h-3.5 w-3.5" /> New request
              </Button>
            )}
          </CardHeader>
          <CardContent className="p-0">
            {applicationsQuery.isLoading ? (
              <Spinner label="Loading applications…" />
            ) : applications.length === 0 ? (
              <EmptyState
                title="No release or renewal request"
                description="Create a request when the institution applies for release of the deposit or renewal of the instrument."
              />
            ) : (
              <ul className="divide-y divide-slate-100">
                {applications.map((application) => (
                  <li key={application.id}>
                    <Link
                      to={`/applications/${application.id}`}
                      className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-slate-50"
                    >
                      <div>
                        <p className="text-sm font-medium text-navy-900">{application.application_no}</p>
                        <p className="text-xs text-slate-500">
                          {APPLICATION_TYPE_LABELS[application.application_type]} · submitted{' '}
                          {formatDateTime(application.submitted_at)}
                        </p>
                      </div>
                      <ApplicationStatusBadge status={application.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      {tab === 'timeline' && (
        <Card>
          <CardHeader>
            <CardTitle>Verification timeline</CardTitle>
            <CardDescription>
              Officer decisions and observations for this record. These events are append-only.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {eventsQuery.isLoading ? (
              <Spinner label="Loading timeline…" />
            ) : (eventsQuery.data ?? []).length === 0 ? (
              <EmptyState icon={<History className="h-5 w-5" />} title="No verification decisions yet" />
            ) : (
              <ol className="relative space-y-4 border-l border-slate-200 pl-4">
                {(eventsQuery.data ?? []).map((event) => (
                  <li key={event.id} className="relative">
                    <span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full border-2 border-white bg-navy-600" />
                    <p className="text-sm font-medium text-navy-900">
                      {humanize(event.action)} · {event.previous_status ?? '—'} → {event.new_status ?? '—'}
                    </p>
                    <p className="text-[11px] text-slate-500">
                      {formatDateTime(event.created_at)} · {nameOf(event.actor_id)}
                    </p>
                    {event.observations && (
                      <p className="mt-1 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs leading-relaxed text-slate-700">
                        {event.observations}
                      </p>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      )}

      {/* Verification dialog */}
      <Dialog
        open={verifyOpen}
        onClose={() => setVerifyOpen(false)}
        title="Record a verification decision"
        description="Verification here means an officer compared this record with the uploaded document. It is not a bank authenticity certificate."
        footer={
          <>
            <Button variant="outline" onClick={() => setVerifyOpen(false)}>
              Cancel
            </Button>
            <Button loading={verifyMutation.isPending} onClick={() => verifyMutation.mutate()}>
              <ShieldCheck className="h-4 w-4" /> Save decision
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Decision" htmlFor="verify-decision">
            <Select
              id="verify-decision"
              value={decision}
              onChange={(event) => setDecision(event.target.value as typeof decision)}
            >
              <option value="in_review">Under review</option>
              <option value="verified">Verified against uploaded document</option>
              <option value="rejected">Rejected / document does not match</option>
            </Select>
          </Field>
          <Field
            label="Observation"
            htmlFor="verify-observations"
            hint="Required for a rejection. Stored permanently with your account and timestamp."
          >
            <Textarea
              id="verify-observations"
              rows={4}
              value={observations}
              onChange={(event) => setObservations(event.target.value)}
              placeholder="e.g. Receipt matches the submitted amount and dates; bank stamp legible. No independent bank confirmation was performed."
            />
          </Field>
          <Alert tone="info">
            Unresolved discrepancy flags block the "verified" decision — resolve or accept them first.
          </Alert>
        </div>
      </Dialog>

      {/* Archive dialog */}
      <Dialog
        open={archiveOpen}
        onClose={() => setArchiveOpen(false)}
        title="Archive this record?"
        description="Archived records leave active monitoring. The record and its history are retained; nothing is deleted."
        footer={
          <>
            <Button variant="outline" onClick={() => setArchiveOpen(false)}>
              Cancel
            </Button>
            <Button variant="danger" loading={archiveMutation.isPending} onClick={() => archiveMutation.mutate()}>
              Archive record
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600">
          {record.fdr_reference_number} · {formatCurrency(record.deposit_amount)} · matures {formatDate(record.maturity_date)}
        </p>
      </Dialog>

      {/* Application dialog */}
      <Dialog
        open={applicationOpen}
        onClose={() => setApplicationOpen(false)}
        title="New release or renewal request"
        description="Submitting a request only records the institution's application. No funds are moved by this application."
        footer={null}
      >
        <form className="space-y-3" onSubmit={createApplication}>
          {applicationError && (
            <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {applicationError}
            </div>
          )}
          <Field label="Request type" htmlFor="application_type" required>
            <Select id="application_type" name="application_type" defaultValue="release">
              <option value="release">Release of deposit</option>
              <option value="renewal">Renewal of FDR</option>
            </Select>
          </Field>
          <Field label="Reason / justification" htmlFor="reason" required>
            <Textarea
              id="reason"
              name="reason"
              rows={3}
              placeholder="Explain why release or renewal is requested, with reference to the applicable procedure."
            />
          </Field>
          <Field label="Amount claimed (optional)" htmlFor="amount_claimed">
            <Input id="amount_claimed" name="amount_claimed" type="number" step="0.01" min="0" />
          </Field>
          <Field label="Supporting notes (optional)" htmlFor="supporting_notes">
            <Textarea id="supporting_notes" name="supporting_notes" rows={2} />
          </Field>
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={() => setApplicationOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={applicationSaving}>
              <CheckCircle2 className="h-4 w-4" /> Submit request
            </Button>
          </div>
        </form>
      </Dialog>

      <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-slate-500">
        <FileText className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
        Every create, update, document event and workflow transition is written to the append-only audit trail by database
        triggers and SECURITY DEFINER functions.
      </p>
    </div>
  );
}

export default function FdrDetailPage({ mode }: { mode: 'create' | 'view' }) {
  const { id } = useParams<{ id: string }>();
  if (mode === 'create') return <CreateFdr />;
  if (!id) return <Alert tone="danger" title="Missing record identifier" />;
  return <ViewFdr id={id} />;
}
