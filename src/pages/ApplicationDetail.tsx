import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, FileText, Gavel, Info, Send } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { useLogEvent, useProfiles, useSettings } from '@/lib/queries';
import { availableTransitions } from '@/lib/workflow';
import { APPLICATION_TYPE_LABELS, formatCurrency, formatDate, formatDateTime, humanize } from '@/lib/format';
import type { ApplicationEvent, ApplicationStatus, FdrRecord, ReleaseApplication } from '@/lib/types';
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
  Field,
  PageHeader,
  Spinner,
  Textarea,
} from '@/components/ui/primitives';
import { ApplicationStatusBadge, MaturityBadge } from '@/components/ui/data-display';
import { Dialog, useToast } from '@/components/ui/overlays';
import { classifyMaturity, todayInPolicyZone } from '@/lib/maturity';

type ApplicationRow = ReleaseApplication & { fdr_records?: FdrRecord & { institutions?: { institution_name: string; institution_code: string } | null } };

export default function ApplicationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { role, profile } = useAuth();
  const queryClient = useQueryClient();
  const { push } = useToast();
  const profiles = useProfiles();
  const settings = useSettings();
  const logEvent = useLogEvent();
  const [target, setTarget] = useState<ApplicationStatus | null>(null);
  const [note, setNote] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const today = todayInPolicyZone();

  const applicationQuery = useQuery({
    queryKey: ['application', id],
    queryFn: async (): Promise<ApplicationRow | null> => {
      const { data, error } = await supabase
        .from('release_applications')
        .select(
          '*, fdr_records(id, institution_id, fdr_reference_number, issuing_bank, branch_name, deposit_amount, issue_date, maturity_date, validity_status, renewal_status, administrative_status, verification_status, notes, submitted_at, last_verified_at, archived_at, is_demo, created_by, created_at, updated_at, institutions(institution_name, institution_code))',
        )
        .eq('id', id)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return (data as ApplicationRow | null) ?? null;
    },
  });

  const eventsQuery = useQuery({
    queryKey: ['application-events', id],
    queryFn: async (): Promise<ApplicationEvent[]> => {
      const { data, error } = await supabase
        .from('application_events')
        .select('*')
        .eq('application_id', id)
        .order('created_at', { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as ApplicationEvent[];
    },
  });

  const application = applicationQuery.data;
  const applySelfApproval = settings.data?.allowSelfApproval ?? false;

  const transitions = useMemo(() => {
    if (!application || !role) return [];
    return availableTransitions(application.status as ApplicationStatus, {
      actorRole: role,
      actorId: profile?.id ?? null,
      requestedBy: application.requested_by,
      allowSelfApproval: applySelfApproval,
    });
  }, [application, role, profile?.id, applySelfApproval]);

  const transition = useMutation({
    mutationFn: async (input: { status: ApplicationStatus; note: string }) => {
      if (!application) throw new Error('Application not loaded');
      const { error } = await supabase.rpc('fn_transition_application', {
        p_application_id: application.id,
        p_new_status: input.status,
        p_note: input.note || null,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: async (_data, variables) => {
      await logEvent.mutateAsync({
        action: `application.${variables.status}`,
        entity_type: 'release_applications',
        entity_id: application?.id,
        summary: `${application?.application_no} moved to ${humanize(variables.status)}`,
        metadata: { note: variables.note },
      });
      setTarget(null);
      setNote('');
      setFormError(null);
      push({ title: 'Status updated', description: 'The transition, decision and observation were recorded.', tone: 'success' });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['application', id] }),
        queryClient.invalidateQueries({ queryKey: ['application-events', id] }),
        queryClient.invalidateQueries({ queryKey: ['applications'] }),
        queryClient.invalidateQueries({ queryKey: ['fdr', application?.fdr_id] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] }),
        queryClient.invalidateQueries({ queryKey: ['notifications-unread'] }),
      ]);
    },
    onError: (error) => setFormError(errorMessage(error)),
  });

  const nameOf = (actorId: string | null) => {
    if (!actorId) return 'System';
    const match = (profiles.data ?? []).find((entry) => entry.id === actorId);
    if (match) return match.full_name || match.email;
    if (actorId === profile?.id) return profile?.full_name || 'You';
    return 'AICTE user';
  };

  if (applicationQuery.isLoading) return <Spinner label="Loading application…" />;
  if (applicationQuery.error) {
    return (
      <Alert tone="danger" title="The application could not be loaded">
        {errorMessage(applicationQuery.error)}
      </Alert>
    );
  }
  if (!application) {
    return (
      <div className="space-y-3">
        <Alert tone="warning" title="Application not found or not accessible">
          This application does not exist, or it belongs to an institution outside your authorised scope.
        </Alert>
        <Link to="/applications">
          <Button variant="outline" size="sm">
            <ArrowLeft className="h-3.5 w-3.5" /> Back to applications
          </Button>
        </Link>
      </div>
    );
  }

  const fdr = application.fdr_records;
  const maturity = fdr
    ? classifyMaturity(
        {
          maturity_date: fdr.maturity_date,
          validity_status: fdr.validity_status,
          archived_at: fdr.archived_at,
          release_application_statuses: [application.status],
        },
        today,
        settings.data?.warningDays ?? [30, 15, 7],
      )
    : null;

  return (
    <div className="space-y-4">
      <Link to="/applications" className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-navy-800">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to applications
      </Link>

      <PageHeader
        eyebrow={APPLICATION_TYPE_LABELS[application.application_type]}
        title={application.application_no}
        description={
          <div className="flex flex-wrap items-center gap-1.5">
            <ApplicationStatusBadge status={application.status} />
            {fdr && (
              <Link to={`/fdrs/${application.fdr_id}`} className="text-xs font-medium text-navy-700 hover:underline">
                {fdr.fdr_reference_number} · {fdr.institutions?.institution_name}
              </Link>
            )}
            {maturity && <MaturityBadge state={maturity.state} label={maturity.label} />}
          </div>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Request details</CardTitle>
              <CardDescription>Submitted by the institution. Decisions are recorded separately below.</CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                {[
                  ['Application number', application.application_no],
                  ['Type', APPLICATION_TYPE_LABELS[application.application_type]],
                  ['Institution', fdr?.institutions?.institution_name ?? '—'],
                  ['FDR reference', fdr?.fdr_reference_number ?? '—'],
                  ['Deposit amount', fdr ? formatCurrency(fdr.deposit_amount) : '—'],
                  ['Maturity date', fdr ? formatDate(fdr.maturity_date) : '—'],
                  ['Amount claimed', application.amount_claimed ? formatCurrency(application.amount_claimed) : 'Not stated'],
                  ['Submitted', formatDateTime(application.submitted_at)],
                  ['Decided', formatDateTime(application.decided_at)],
                  ['Completed', formatDateTime(application.completed_at)],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
                    <dd className="mt-0.5 text-sm text-slate-800">{value}</dd>
                  </div>
                ))}
                <div className="sm:col-span-2">
                  <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Reason</dt>
                  <dd className="mt-0.5 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
                    {application.reason ?? '—'}
                  </dd>
                </div>
                {application.supporting_notes && (
                  <div className="sm:col-span-2">
                    <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Supporting notes</dt>
                    <dd className="mt-0.5 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
                      {application.supporting_notes}
                    </dd>
                  </div>
                )}
                {application.decision_note && (
                  <div className="sm:col-span-2 rounded-md border border-slate-200 bg-slate-50 p-2.5">
                    <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Decision note</dt>
                    <dd className="mt-0.5 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
                      {application.decision_note}
                    </dd>
                  </div>
                )}
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Workflow timeline</CardTitle>
              <CardDescription>Append-only record of every status transition.</CardDescription>
            </CardHeader>
            <CardContent>
              {eventsQuery.isLoading ? (
                <Spinner label="Loading timeline…" />
              ) : (eventsQuery.data ?? []).length === 0 ? (
                <p className="text-sm text-slate-500">No transitions recorded yet.</p>
              ) : (
                <ol className="relative space-y-4 border-l border-slate-200 pl-4">
                  {(eventsQuery.data ?? []).map((event) => (
                    <li key={event.id} className="relative">
                      <span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full border-2 border-white bg-navy-600" />
                      <p className="text-sm font-medium text-navy-900">
                        {event.previous_status ? `${humanize(event.previous_status)} → ` : ''}
                        {humanize(event.new_status)}
                      </p>
                      <p className="text-[11px] text-slate-500">
                        {formatDateTime(event.created_at)} · {nameOf(event.actor_id)}
                        {event.actor_role ? ` (${humanize(event.actor_role)})` : ''}
                      </p>
                      {event.note && (
                        <p className="mt-1 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs leading-relaxed text-slate-700">
                          {event.note}
                        </p>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Available actions</CardTitle>
              <CardDescription>
                Only transitions permitted for your role are shown. The database function enforces the same rules, including
                the self-approval prohibition.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {transitions.length === 0 ? (
                <p className="text-sm text-slate-500">
                  No action is available to you in this state. {role === 'read_only_auditor' ? 'Auditors cannot change workflow state.' : ''}
                </p>
              ) : (
                transitions.map((option) => (
                  <Button
                    key={option.status}
                    variant={option.status === 'rejected' ? 'danger' : option.status === 'approved' || option.status === 'completed' ? 'success' : 'outline'}
                    size="sm"
                    className="w-full justify-start"
                    onClick={() => {
                      setTarget(option.status);
                      setNote('');
                      setFormError(null);
                    }}
                  >
                    <Send className="h-3.5 w-3.5" /> {option.label}
                  </Button>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Gavel className="h-4 w-4 text-slate-500" /> Decision authority
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-xs leading-relaxed text-slate-600">
              <p>
                <strong className="text-slate-800">Requested by:</strong> {nameOf(application.requested_by)}
              </p>
              <p>
                <strong className="text-slate-800">Approved/rejected by:</strong> {nameOf(application.decided_by)}
              </p>
              <p className="flex items-start gap-1.5">
                <Info className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                Completing this workflow records an administrative outcome only. No financial transfer is initiated by FDR
                Sentinel.
              </p>
            </CardContent>
          </Card>

          {application.status === 'approved' && (
            <Badge tone="success" className="w-full justify-center py-1.5">
              Approved — awaiting completion by the competent authority
            </Badge>
          )}
        </div>
      </div>

      <Dialog
        open={!!target}
        onClose={() => setTarget(null)}
        title={target ? `Move application to "${humanize(target)}"` : 'Update status'}
        description="The transition, your identity, the timestamp and the note are recorded permanently."
        footer={
          <>
            <Button variant="outline" onClick={() => setTarget(null)}>
              Cancel
            </Button>
            <Button
              loading={transition.isPending}
              onClick={() => {
                if (!target) return;
                const needsNote = ['info_required', 'rejected', 'approved', 'completed'].includes(target);
                if (needsNote && note.trim().length < 5) {
                  setFormError('A note is required for this action.');
                  return;
                }
                transition.mutate({ status: target, note: note.trim() });
              }}
            >
              Confirm
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {formError && (
            <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {formError}
            </div>
          )}
          <Alert tone="info">
            Approving a request is a recommendation for the competent authority's decision. Completion records the final
            administrative outcome after the official procedure.
          </Alert>
          <Field label="Note / observation" htmlFor="transition-note" hint="Required for information requests, approvals, rejections and completion.">
            <Textarea
              id="transition-note"
              rows={4}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Record what was reviewed and the basis for this decision."
            />
          </Field>
        </div>
      </Dialog>

      <p className="flex items-center gap-1.5 text-[11px] text-slate-500">
        <FileText className="h-3.5 w-3.5" /> All transitions are enforced by public.fn_transition_application() in
        PostgreSQL, not by this page.
      </p>
    </div>
  );
}
