import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Flag, Info, ShieldQuestion } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { RULE_LABELS } from '@/lib/discrepancies';
import { DISCREPANCY_STATUS_LABELS, formatDateTime } from '@/lib/format';
import type { DiscrepancyFlag } from '@/lib/types';
import { cn, errorMessage } from '@/lib/utils';
import { Alert, Badge, Button, EmptyState, Spinner, Textarea, Field, Select } from './ui/primitives';
import { Dialog, useToast } from './ui/overlays';
import { DiscrepancyStatusBadge } from './ui/data-display';

const SEVERITY: Record<string, { tone: 'danger' | 'warning' | 'info'; icon: typeof Flag }> = {
  critical: { tone: 'danger', icon: AlertTriangle },
  warning: { tone: 'warning', icon: Flag },
  info: { tone: 'info', icon: Info },
};

export function DiscrepancyPanel({ fdrId, canReview }: { fdrId: string; canReview: boolean }) {
  const queryClient = useQueryClient();
  const { push } = useToast();
  const [reviewing, setReviewing] = useState<DiscrepancyFlag | null>(null);
  const [status, setStatus] = useState<'under_review' | 'resolved' | 'accepted'>('resolved');
  const [note, setNote] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const flagsQuery = useQuery({
    queryKey: ['discrepancy-flags', fdrId],
    queryFn: async (): Promise<DiscrepancyFlag[]> => {
      const { data, error } = await supabase
        .from('discrepancy_flags')
        .select('*')
        .eq('fdr_id', fdrId)
        .order('detected_at', { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as DiscrepancyFlag[];
    },
  });

  const review = useMutation({
    mutationFn: async (input: { id: string; status: string; note: string }) => {
      const { error } = await supabase.rpc('fn_review_discrepancy', {
        p_flag_id: input.id,
        p_status: input.status,
        p_note: input.note || null,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => {
      push({ title: 'Review recorded', description: 'The flag status and your observation were saved to the audit trail.', tone: 'success' });
      setReviewing(null);
      setNote('');
      setFormError(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['discrepancy-flags'] }),
        queryClient.invalidateQueries({ queryKey: ['fdr-review-queue'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] }),
      ]);
    },
    onError: (error) => setFormError(errorMessage(error)),
  });

  const open = (flag: DiscrepancyFlag) => {
    setReviewing(flag);
    setStatus(flag.status === 'open' ? 'under_review' : 'resolved');
    setNote(flag.reviewer_notes ?? '');
    setFormError(null);
  };

  if (flagsQuery.isLoading) return <Spinner label="Loading verification findings…" />;
  if (flagsQuery.error) {
    return (
      <Alert tone="danger" title="Findings could not be loaded">
        {errorMessage(flagsQuery.error)}
      </Alert>
    );
  }

  const flags = flagsQuery.data ?? [];
  if (flags.length === 0) {
    return (
      <EmptyState
        icon={<CheckCircle2 className="h-5 w-5" />}
        title="No verification findings"
        description="No deterministic rule has been triggered for this record. This does not confirm the FDR's authenticity — an officer review is still required."
      />
    );
  }

  return (
    <div className="space-y-3">
      <Alert tone="info" title="These are review prompts, not conclusions">
        Each flag names the rule, the submitted value and the comparison value. Resolving a flag records a human decision; it
        does not certify the instrument.
      </Alert>

      <ul className="space-y-2.5">
        {flags.map((flag) => {
          const severity = SEVERITY[flag.severity] ?? SEVERITY.warning;
          const Icon = severity.icon;
          return (
            <li
              key={flag.id}
              className={cn(
                'rounded-lg border bg-white p-3.5',
                flag.severity === 'critical' ? 'border-red-200' : flag.severity === 'warning' ? 'border-amber-200' : 'border-slate-200',
              )}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex min-w-0 items-start gap-2.5">
                  <span
                    className={cn(
                      'mt-0.5 rounded-md p-1.5',
                      flag.severity === 'critical'
                        ? 'bg-red-50 text-red-600'
                        : flag.severity === 'warning'
                          ? 'bg-amber-50 text-amber-600'
                          : 'bg-sky-50 text-sky-600',
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-navy-900">
                      {RULE_LABELS[flag.rule_code] ?? flag.rule_code.replace(/_/g, ' ')}
                    </p>
                    <p className="text-[11px] uppercase tracking-wide text-slate-500">
                      {flag.field_name.replace(/_/g, ' ')} · detected {formatDateTime(flag.detected_at)}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <Badge tone={severity.tone}>{flag.severity}</Badge>
                  <DiscrepancyStatusBadge status={flag.status} />
                </div>
              </div>

              <p className="mt-2 text-sm leading-relaxed text-slate-700">{flag.explanation}</p>

              {(flag.submitted_value || flag.compared_value) && (
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <div className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Submitted / record value</p>
                    <p className="mt-0.5 break-words text-xs text-slate-800">{flag.submitted_value ?? '—'}</p>
                  </div>
                  <div className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                      Comparison / document value
                    </p>
                    <p className="mt-0.5 break-words text-xs text-slate-800">{flag.compared_value ?? '—'}</p>
                  </div>
                </div>
              )}

              {flag.reviewer_notes && (
                <div className="mt-2 rounded-md border border-slate-200 bg-white px-2.5 py-2">
                  <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                    <ShieldQuestion className="h-3 w-3" /> Reviewer observation
                  </p>
                  <p className="mt-0.5 text-xs leading-relaxed text-slate-700">{flag.reviewer_notes}</p>
                  <p className="mt-1 text-[10px] text-slate-400">Reviewed {formatDateTime(flag.reviewed_at)}</p>
                </div>
              )}

              {canReview && (
                <div className="mt-2.5 flex justify-end">
                  <Button variant="outline" size="sm" onClick={() => open(flag)}>
                    Record review
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <Dialog
        open={!!reviewing}
        onClose={() => setReviewing(null)}
        title="Record discrepancy review"
        description="Your observation is stored with your account and timestamp and cannot be edited by ordinary users."
        footer={
          <>
            <Button variant="outline" onClick={() => setReviewing(null)}>
              Cancel
            </Button>
            <Button
              loading={review.isPending}
              onClick={() => {
                if (!reviewing) return;
                if (status === 'accepted' && note.trim().length < 5) {
                  setFormError('An explanation is required when accepting a discrepancy.');
                  return;
                }
                review.mutate({ id: reviewing.id, status, note: note.trim() });
              }}
            >
              Save review
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
          <Field label="Review decision" htmlFor="review-status">
            <Select id="review-status" value={status} onChange={(event) => setStatus(event.target.value as typeof status)}>
              <option value="under_review">{DISCREPANCY_STATUS_LABELS.under_review}</option>
              <option value="resolved">{DISCREPANCY_STATUS_LABELS.resolved}</option>
              <option value="accepted">{DISCREPANCY_STATUS_LABELS.accepted}</option>
            </Select>
          </Field>
          <Field
            label="Observation"
            htmlFor="review-note"
            hint="Required when accepting a discrepancy. This is the official explanation of record."
          >
            <Textarea
              id="review-note"
              rows={4}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="e.g. Verified against the original receipt dated 12 Mar 2024; the submitted amount was corrected by the institution."
            />
          </Field>
        </div>
      </Dialog>
    </div>
  );
}
