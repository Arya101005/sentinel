import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ClipboardList, Download, FilterX } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { useLogEvent } from '@/lib/queries';
import { APPLICATION_TYPE_LABELS, formatCurrency, formatDateTime } from '@/lib/format';
import type { ApplicationStatus, ApplicationType, ReleaseApplication } from '@/lib/types';
import { downloadCsv, toCsv } from '@/lib/csv';
import { errorMessage } from '@/lib/utils';
import {
  Alert,
  Button,
  EmptyState,
  Input,
  PageHeader,
  Select,
  Spinner,
} from '@/components/ui/primitives';
import { ApplicationStatusBadge, Table, TableShell, Tabs } from '@/components/ui/data-display';
import { useToast } from '@/components/ui/overlays';

type Group = 'in_progress' | 'decided' | 'all';

const IN_PROGRESS: ApplicationStatus[] = ['submitted', 'under_review', 'info_required', 'resubmitted'];
const DECIDED: ApplicationStatus[] = ['approved', 'rejected', 'completed'];

export default function ApplicationsPage() {
  const { role } = useAuth();
  const [params, setParams] = useSearchParams();
  const [type, setType] = useState<ApplicationType | ''>((params.get('type') as ApplicationType) ?? '');
  const [group, setGroup] = useState<Group>('in_progress');
  const [search, setSearch] = useState('');
  const [exporting, setExporting] = useState(false);
  const { push } = useToast();
  const logEvent = useLogEvent();

  const query = useQuery({
    queryKey: ['applications', type, group],
    queryFn: async (): Promise<ReleaseApplication[]> => {
      let request = supabase
        .from('release_applications')
        .select(
          '*, fdr_records(id, fdr_reference_number, issuing_bank, maturity_date, deposit_amount, institutions(institution_name, institution_code))',
        )
        .order('created_at', { ascending: false })
        .limit(500);
      if (type) request = request.eq('application_type', type);
      if (group === 'in_progress') request = request.in('status', IN_PROGRESS);
      if (group === 'decided') request = request.in('status', DECIDED);
      const { data, error } = await request;
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as ReleaseApplication[];
    },
  });

  const rows = useMemo(() => {
    const list = query.data ?? [];
    if (!search.trim()) return list;
    const term = search.trim().toLowerCase();
    return list.filter(
      (application) =>
        application.application_no.toLowerCase().includes(term) ||
        (application.fdr_records?.fdr_reference_number ?? '').toLowerCase().includes(term) ||
        (application.fdr_records?.institutions?.institution_name ?? '').toLowerCase().includes(term),
    );
  }, [query.data, search]);

  const handleExport = async () => {
    setExporting(true);
    try {
      if (rows.length === 0) {
        push({ title: 'Nothing to export', description: 'No applications in this view.', tone: 'info' });
        return;
      }
      const csv = toCsv(rows, [
        { key: 'application_no', label: 'Application number' },
        { key: 'type', label: 'Type', value: (row) => APPLICATION_TYPE_LABELS[row.application_type] },
        { key: 'fdr', label: 'FDR reference', value: (row) => row.fdr_records?.fdr_reference_number ?? '' },
        { key: 'institution', label: 'Institution', value: (row) => row.fdr_records?.institutions?.institution_name ?? '' },
        { key: 'status', label: 'Status' },
        { key: 'amount_claimed', label: 'Amount claimed', value: (row) => row.amount_claimed ?? '' },
        { key: 'reason', label: 'Reason', value: (row) => row.reason ?? '' },
        { key: 'submitted_at', label: 'Submitted', value: (row) => formatDateTime(row.submitted_at) },
        { key: 'decided_at', label: 'Decided', value: (row) => formatDateTime(row.decided_at) },
        { key: 'decision_note', label: 'Decision note', value: (row) => row.decision_note ?? '' },
      ]);
      downloadCsv('release-renewal-applications', csv);
      await logEvent.mutateAsync({
        action: 'report.export',
        entity_type: 'release_applications',
        summary: `Exported ${rows.length} release/renewal applications`,
        metadata: { type, group, rows: rows.length },
      });
      push({ title: 'CSV exported', description: `${rows.length} application(s) exported and audited.`, tone: 'success' });
    } catch (error) {
      push({ title: 'Export failed', description: errorMessage(error), tone: 'error' });
    } finally {
      setExporting(false);
    }
  };

  const counts = {
    inProgress: (query.data ?? []).filter((application) => IN_PROGRESS.includes(application.status)).length,
    awaiting: (query.data ?? []).filter((application) => ['submitted', 'resubmitted'].includes(application.status)).length,
  };

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Module F"
        title="Release & renewal tracking"
        description={
          <span>
            Controlled lifecycle: draft → submitted → under review → additional information → resubmitted → approved or
            rejected → completed. Approval and completion remain official decisions; this application never moves money.
            {role === 'read_only_auditor' ? ' You have read-only access.' : ''}
          </span>
        }
        actions={
          <Button variant="outline" size="sm" onClick={handleExport} loading={exporting}>
            <Download className="h-3.5 w-3.5" /> Export CSV
          </Button>
        }
      />

      {group === 'in_progress' && counts.awaiting > 0 && (
        <Alert tone="info" title={`${counts.awaiting} application(s) awaiting first review`}>
          Open an application to record the officer decision. The database enforces the allowed transitions and blocks
          self-approval.
        </Alert>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Tabs<Group>
          value={group}
          onChange={setGroup}
          options={[
            { value: 'in_progress', label: 'In progress', count: counts.inProgress },
            { value: 'decided', label: 'Decided / closed' },
            { value: 'all', label: 'All' },
          ]}
        />
        <Select
          aria-label="Filter by request type"
          className="w-[190px]"
          value={type}
          onChange={(event) => {
            const next = (event.target.value as ApplicationType | '') ?? '';
            setType(next);
            const updated = new URLSearchParams(params);
            if (next) updated.set('type', next);
            else updated.delete('type');
            setParams(updated, { replace: true });
          }}
        >
          <option value="">All request types</option>
          <option value="release">Release requests</option>
          <option value="renewal">Renewal requests</option>
        </Select>
        <Input
          aria-label="Search applications"
          placeholder="Search application, FDR or institution…"
          className="max-w-xs"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        {(type || search) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setType('');
              setSearch('');
              const updated = new URLSearchParams(params);
              updated.delete('type');
              setParams(updated, { replace: true });
            }}
          >
            <FilterX className="h-3.5 w-3.5" /> Clear
          </Button>
        )}
      </div>

      {query.error && (
        <Alert tone="danger" title="Applications could not be loaded">
          {errorMessage(query.error)}
        </Alert>
      )}

      <TableShell>
        {query.isLoading ? (
          <Spinner label="Loading applications…" />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<ClipboardList className="h-5 w-5" />}
            title="No applications in this view"
            description="Create a release or renewal request from an FDR record to start the workflow."
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <th>Application</th>
                <th>FDR / institution</th>
                <th>Type</th>
                <th>Status</th>
                <th className="text-right">Amount claimed</th>
                <th>Submitted</th>
                <th>Decided</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((application) => (
                <tr key={application.id}>
                  <td>
                    <Link to={`/applications/${application.id}`} className="font-medium text-navy-800 hover:underline">
                      {application.application_no}
                    </Link>
                  </td>
                  <td>
                    <Link to={`/fdrs/${application.fdr_id}`} className="text-xs font-medium text-slate-700 hover:underline">
                      {application.fdr_records?.fdr_reference_number ?? '—'}
                    </Link>
                    <p className="max-w-[200px] truncate text-[11px] text-slate-500">
                      {application.fdr_records?.institutions?.institution_name ?? ''}
                    </p>
                  </td>
                  <td className="text-xs">{APPLICATION_TYPE_LABELS[application.application_type]}</td>
                  <td>
                    <ApplicationStatusBadge status={application.status} />
                  </td>
                  <td className="whitespace-nowrap text-right text-xs">
                    {application.amount_claimed ? formatCurrency(application.amount_claimed) : '—'}
                  </td>
                  <td className="whitespace-nowrap text-[11px] text-slate-500">{formatDateTime(application.submitted_at)}</td>
                  <td className="whitespace-nowrap text-[11px] text-slate-500">{formatDateTime(application.decided_at)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </TableShell>
    </div>
  );
}
