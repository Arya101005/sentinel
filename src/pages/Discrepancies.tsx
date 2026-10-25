import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Download, Flag, FilterX } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { useLogEvent } from '@/lib/queries';
import { can } from '@/lib/permissions';
import { RULE_LABELS } from '@/lib/discrepancies';
import { DISCREPANCY_STATUS_LABELS, formatDateTime } from '@/lib/format';
import type { DiscrepancyFlag } from '@/lib/types';
import { downloadCsv, toCsv } from '@/lib/csv';
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
  Textarea,
} from '@/components/ui/primitives';
import { DiscrepancyStatusBadge, Tabs, Table, TableShell } from '@/components/ui/data-display';
import { Dialog, useToast } from '@/components/ui/overlays';

type StatusFilter = 'unresolved' | 'open' | 'under_review' | 'resolved' | 'accepted' | 'all';

const REFRESH_KEYS = [['discrepancy-flags'], ['fdr-review-queue'], ['dashboard-summary'], ['fdrs']];

export default function DiscrepanciesPage() {
  const { role } = useAuth();
  const queryClient = useQueryClient();
  const { push } = useToast();
  const logEvent = useLogEvent();
  const [status, setStatus] = useState<StatusFilter>('unresolved');
  const [severity, setSeverity] = useState('');
  const [search, setSearch] = useState('');
  const [reviewing, setReviewing] = useState<DiscrepancyFlag | null>(null);
  const [decision, setDecision] = useState<'under_review' | 'resolved' | 'accepted'>('resolved');
  const [note, setNote] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const flagsQuery = useQuery({
    queryKey: ['fdr-review-queue', status, severity],
    queryFn: async (): Promise<DiscrepancyFlag[]> => {
      let query = supabase
        .from('discrepancy_flags')
        .select('*, fdr_records(id, fdr_reference_number, issuing_bank, maturity_date, institutions(institution_name, institution_code))')
        .order('detected_at', { ascending: false })
        .limit(500);
      if (status === 'unresolved') query = query.in('status', ['open', 'under_review']);
      else if (status !== 'all') query = query.eq('status', status);
      if (severity) query = query.eq('severity', severity);
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as DiscrepancyFlag[];
    },
  });

  const rows = useMemo(() => {
    const list = flagsQuery.data ?? [];
    if (!search.trim()) return list;
    const term = search.trim().toLowerCase();
    return list.filter(
      (flag) =>
        (flag.fdr_records?.fdr_reference_number ?? '').toLowerCase().includes(term) ||
        (flag.fdr_records?.institutions?.institution_name ?? '').toLowerCase().includes(term) ||
        flag.rule_code.toLowerCase().includes(term) ||
        flag.explanation.toLowerCase().includes(term),
    );
  }, [flagsQuery.data, search]);

  const reviewMutation = useMutation({
    mutationFn: async (input: { id: string; status: string; note: string }) => {
      const { error } = await supabase.rpc('fn_review_discrepancy', {
        p_flag_id: input.id,
        p_status: input.status,
        p_note: input.note || null,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => {
      setReviewing(null);
      setNote('');
      setFormError(null);
      push({ title: 'Review recorded', description: 'The decision and observation are in the audit trail.', tone: 'success' });
      await Promise.all(REFRESH_KEYS.map((key) => queryClient.invalidateQueries({ queryKey: key })));
    },
    onError: (error) => setFormError(errorMessage(error)),
  });

  const handleExport = async () => {
    setExporting(true);
    try {
      if (rows.length === 0) {
        push({ title: 'Nothing to export', description: 'No flags in this view.', tone: 'info' });
        return;
      }
      const csv = toCsv(rows, [
        { key: 'fdr', label: 'FDR reference', value: (row) => row.fdr_records?.fdr_reference_number ?? '' },
        { key: 'institution', label: 'Institution', value: (row) => row.fdr_records?.institutions?.institution_name ?? '' },
        { key: 'rule_code', label: 'Rule code' },
        { key: 'field', label: 'Field', value: (row) => row.field_name },
        { key: 'severity', label: 'Severity' },
        { key: 'submitted', label: 'Submitted value', value: (row) => row.submitted_value ?? '' },
        { key: 'compared', label: 'Comparison value', value: (row) => row.compared_value ?? '' },
        { key: 'explanation', label: 'Explanation' },
        { key: 'status', label: 'Review status', value: (row) => DISCREPANCY_STATUS_LABELS[row.status] },
        { key: 'reviewer_notes', label: 'Reviewer observation', value: (row) => row.reviewer_notes ?? '' },
        { key: 'detected_at', label: 'Detected at', value: (row) => formatDateTime(row.detected_at) },
      ]);
      downloadCsv('discrepancy-flags', csv);
      await logEvent.mutateAsync({
        action: 'report.export',
        entity_type: 'discrepancy_flags',
        summary: `Exported ${rows.length} discrepancy flags`,
        metadata: { status, severity, rows: rows.length },
      });
      push({ title: 'CSV exported', description: `${rows.length} flag(s) exported and audited.`, tone: 'success' });
    } catch (error) {
      push({ title: 'Export failed', description: errorMessage(error), tone: 'error' });
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Module D"
        title="Verification & discrepancy review"
        description="Deterministic rules compare submitted values, OCR-extracted candidates and the wider registry. Each flag is explainable and requires a recorded human decision."
        actions={
          <Button variant="outline" size="sm" onClick={handleExport} loading={exporting}>
            <Download className="h-3.5 w-3.5" /> Export flags
          </Button>
        }
      />

      <Alert tone="info" title="What a flag means">
        A flag identifies an inconsistency or missing evidence for review. It is not a finding of fraud, and clearing a flag
        does not certify the FDR as authentic. External bank verification is not connected.
      </Alert>

      <div className="flex flex-wrap items-center gap-2">
        <Tabs<StatusFilter>
          value={status}
          onChange={setStatus}
          options={[
            { value: 'unresolved', label: 'Unresolved' },
            { value: 'open', label: 'Not reviewed' },
            { value: 'under_review', label: 'Under review' },
            { value: 'resolved', label: 'Resolved' },
            { value: 'accepted', label: 'Accepted' },
            { value: 'all', label: 'All' },
          ]}
        />
        <Select
          aria-label="Filter by severity"
          className="w-[160px]"
          value={severity}
          onChange={(event) => setSeverity(event.target.value)}
        >
          <option value="">Any severity</option>
          <option value="critical">Critical</option>
          <option value="warning">Warning</option>
          <option value="info">Info</option>
        </Select>
        <Input
          aria-label="Search flags"
          placeholder="Search reference, institution or rule…"
          className="max-w-xs"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        {(severity || search) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSeverity('');
              setSearch('');
            }}
          >
            <FilterX className="h-3.5 w-3.5" /> Clear
          </Button>
        )}
      </div>

      {flagsQuery.error && (
        <Alert tone="danger" title="Flags could not be loaded">
          {errorMessage(flagsQuery.error)}
        </Alert>
      )}

      <TableShell>
        {flagsQuery.isLoading ? (
          <Spinner label="Loading review queue…" />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<Flag className="h-5 w-5" />}
            title="No flags in this view"
            description="Upload documents and re-run verification on a record to generate deterministic findings."
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <th>FDR / institution</th>
                <th>Rule</th>
                <th>Values</th>
                <th>Status</th>
                <th>Detected</th>
                <th className="text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((flag) => (
                <tr key={flag.id}>
                  <td>
                    <Link
                      to={`/fdrs/${flag.fdr_id}`}
                      className="font-medium text-navy-800 hover:underline"
                    >
                      {flag.fdr_records?.fdr_reference_number ?? 'Record'}
                    </Link>
                    <p className="max-w-[200px] truncate text-[11px] text-slate-500">
                      {flag.fdr_records?.institutions?.institution_name ?? ''}
                    </p>
                  </td>
                  <td className="max-w-[220px]">
                    <p className="text-xs font-medium text-slate-800">{RULE_LABELS[flag.rule_code] ?? flag.rule_code}</p>
                    <p className="text-[11px] text-slate-500">{flag.field_name.replace(/_/g, ' ')}</p>
                  </td>
                  <td className="max-w-[240px]">
                    <p className="text-[11px] text-slate-500">Submitted: {flag.submitted_value ?? '—'}</p>
                    <p className="text-[11px] text-slate-500">Compared: {flag.compared_value ?? '—'}</p>
                    <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-slate-600">{flag.explanation}</p>
                  </td>
                  <td>
                    <div className="flex flex-col items-start gap-1">
                      <DiscrepancyStatusBadge status={flag.status} />
                      <Badge tone={flag.severity === 'critical' ? 'danger' : flag.severity === 'warning' ? 'warning' : 'info'}>
                        {flag.severity}
                      </Badge>
                    </div>
                  </td>
                  <td className="whitespace-nowrap text-[11px] text-slate-500">{formatDateTime(flag.detected_at)}</td>
                  <td className="text-right">
                    {can(role, 'review_discrepancy') ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setReviewing(flag);
                          setDecision(flag.status === 'open' ? 'under_review' : 'resolved');
                          setNote(flag.reviewer_notes ?? '');
                          setFormError(null);
                        }}
                      >
                        Review
                      </Button>
                    ) : (
                      <span className="text-[11px] text-slate-400">Officer review only</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </TableShell>

      <p className="flex items-center gap-1.5 text-[11px] text-slate-500">
        <AlertTriangle className="h-3.5 w-3.5" /> {rows.length} flag(s) in the current view
      </p>

      <Dialog
        open={!!reviewing}
        onClose={() => setReviewing(null)}
        title="Record review decision"
        description={reviewing ? RULE_LABELS[reviewing.rule_code] ?? reviewing.rule_code : undefined}
        footer={
          <>
            <Button variant="outline" onClick={() => setReviewing(null)}>
              Cancel
            </Button>
            <Button
              loading={reviewMutation.isPending}
              onClick={() => {
                if (!reviewing) return;
                if (decision === 'accepted' && note.trim().length < 5) {
                  setFormError('An explanation is required when accepting a discrepancy.');
                  return;
                }
                reviewMutation.mutate({ id: reviewing.id, status: decision, note: note.trim() });
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
          {reviewing && <p className="rounded-md bg-slate-50 p-2.5 text-xs leading-relaxed text-slate-600">{reviewing.explanation}</p>}
          <Field label="Decision" htmlFor="queue-review-status">
            <Select
              id="queue-review-status"
              value={decision}
              onChange={(event) => setDecision(event.target.value as typeof decision)}
            >
              <option value="under_review">{DISCREPANCY_STATUS_LABELS.under_review}</option>
              <option value="resolved">{DISCREPANCY_STATUS_LABELS.resolved}</option>
              <option value="accepted">{DISCREPANCY_STATUS_LABELS.accepted}</option>
            </Select>
          </Field>
          <Field label="Observation" htmlFor="queue-review-note" hint="Stored with your identity and timestamp; append-only in the audit trail.">
            <Textarea
              id="queue-review-note"
              rows={4}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Describe what you checked and why the flag is resolved or accepted."
            />
          </Field>
        </div>
      </Dialog>
    </div>
  );
}
