import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, Download, Play, ShieldAlert } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { useDashboardSummary, useInstitutions, useLogEvent, useSettings } from '@/lib/queries';
import { api } from '@/lib/api';
import { can } from '@/lib/permissions';
import { addDays, classifyMaturity, hasRecordedApplication, todayInPolicyZone } from '@/lib/maturity';
import type { FdrRecord, ReleaseApplication } from '@/lib/types';
import { formatCurrency, formatDate } from '@/lib/format';
import { downloadCsv, toCsv } from '@/lib/csv';
import { errorMessage } from '@/lib/utils';
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  Input,
  PageHeader,
  Select,
  Spinner,
} from '@/components/ui/primitives';
import { MaturityBadge, Table, TableShell, Tabs } from '@/components/ui/data-display';
import { useToast } from '@/components/ui/overlays';

type AlertTab = 'upcoming' | 'seven' | 'today' | 'matured' | 'no-release';

type Row = FdrRecord & { release_applications?: Pick<ReleaseApplication, 'id' | 'application_type' | 'status'>[] };

export default function MaturityPage() {
  const { role } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as AlertTab | null) ?? 'upcoming';
  const today = todayInPolicyZone();
  const settings = useSettings();
  const institutions = useInstitutions();
  const summary = useDashboardSummary();
  const logEvent = useLogEvent();
  const queryClient = useQueryClient();
  const { push } = useToast();
  const [search, setSearch] = useState('');
  const [institution, setInstitution] = useState('');
  const [exporting, setExporting] = useState(false);
  const warningDays = useMemo(() => settings.data?.warningDays ?? [30, 15, 7], [settings.data?.warningDays]);

  const range = useMemo(() => {
    const widest = warningDays[0] ?? 30;
    switch (tab) {
      case 'seven':
        return { from: today, to: addDays(today, 7) };
      case 'today':
        return { from: today, to: today };
      case 'matured':
      case 'no-release':
        return { from: null as string | null, to: addDays(today, -1) };
      case 'upcoming':
      default:
        return { from: today, to: addDays(today, widest) };
    }
  }, [tab, today, warningDays]);

  const recordsQuery = useQuery({
    queryKey: ['maturity-queue', tab, institution, today, warningDays.join(',')],
    queryFn: async (): Promise<Row[]> => {
      let query = supabase
        .from('fdr_records')
        .select(
          'id, institution_id, fdr_reference_number, issuing_bank, branch_name, deposit_amount, issue_date, maturity_date, validity_status, renewal_status, administrative_status, verification_status, notes, submitted_at, last_verified_at, archived_at, is_demo, created_by, created_at, updated_at, institutions(id, institution_name, institution_code), release_applications(id, application_type, status)',
        )
        .is('archived_at', null)
        .eq('validity_status', 'active')
        .order('maturity_date', { ascending: true })
        .limit(500);
      if (range.from) query = query.gte('maturity_date', range.from);
      if (range.to) query = query.lte('maturity_date', range.to);
      if (institution) query = query.eq('institution_id', institution);
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as Row[];
    },
  });

  const rows = useMemo(() => {
    const all = recordsQuery.data ?? [];
    const filtered = tab === 'no-release'
      ? all.filter((record) => {
          const statuses = (record.release_applications ?? [])
            .filter((application) => application.application_type === 'release')
            .map((application) => application.status);
          return !hasRecordedApplication(statuses);
        })
      : all;
    if (!search.trim()) return filtered;
    const term = search.trim().toLowerCase();
    return filtered.filter(
      (record) =>
        record.fdr_reference_number.toLowerCase().includes(term) ||
        record.issuing_bank.toLowerCase().includes(term) ||
        (record.institutions?.institution_name ?? '').toLowerCase().includes(term),
    );
  }, [recordsQuery.data, search, tab]);

  const scanMutation = useMutation({
    mutationFn: () => api.runMaturityScan(),
    onSuccess: async (result) => {
      push({
        title: 'Monitoring scan completed',
        description: `${result.summary.notifications_created ?? 0} new in-app notification(s) created; ${result.summary.duplicates_skipped ?? 0} duplicate alert(s) skipped.`,
        tone: 'success',
      });
      await queryClient.invalidateQueries();
    },
    onError: (error) => push({ title: 'Scan failed', description: errorMessage(error), tone: 'error' }),
  });

  const handleExport = async () => {
    setExporting(true);
    try {
      if (rows.length === 0) {
        push({ title: 'Nothing to export', description: 'No records in this queue.', tone: 'info' });
        return;
      }
      const csv = toCsv(rows, [
        { key: 'fdr_reference_number', label: 'FDR reference' },
        { key: 'institution', label: 'Institution', value: (row) => row.institutions?.institution_name ?? '' },
        { key: 'issuing_bank', label: 'Bank' },
        { key: 'deposit_amount', label: 'Amount (INR)' },
        { key: 'issue_date', label: 'Issue date' },
        { key: 'maturity_date', label: 'Maturity date' },
        { key: 'days', label: 'Days to maturity', value: (row) => String(classifyMaturity(row, today, warningDays).daysToMaturity) },
        { key: 'state', label: 'Monitoring state', value: (row) => classifyMaturity(row, today, warningDays).state },
        { key: 'verification_status', label: 'Verification' },
        { key: 'is_demo', label: 'Demonstration data', value: (row) => (row.is_demo ? 'Yes' : 'No') },
      ]);
      downloadCsv(`maturity-${tab}`, csv);
      await logEvent.mutateAsync({
        action: 'report.export',
        entity_type: 'maturity_queue',
        summary: `Exported ${rows.length} records from the ${tab} maturity queue`,
        metadata: { tab, institution, rows: rows.length },
      });
      push({ title: 'CSV exported', description: `${rows.length} row(s) exported and audited.`, tone: 'success' });
    } catch (error) {
      push({ title: 'Export failed', description: errorMessage(error), tone: 'error' });
    } finally {
      setExporting(false);
    }
  };

  const counts = {
    upcoming: summary.data?.approaching ?? 0,
    seven: rows.length,
    today: summary.data?.maturing_today ?? 0,
    matured: summary.data?.matured ?? 0,
    'no-release': summary.data?.matured_no_release ?? 0,
  };

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Module E"
        title="Maturity Monitor"
        description={
          <span>
            Maturity status is calculated from the stored dates using the {settings.data?.timezone ?? 'Asia/Kolkata'} policy
            timezone and warning intervals of {warningDays.join(' / ')} days. A matured record is a follow-up item — not a
            finding of non-compliance.
          </span>
        }
        actions={
          <>
            <Button variant="outline" size="sm" onClick={handleExport} loading={exporting}>
              <Download className="h-3.5 w-3.5" /> Export queue
            </Button>
            {(can(role, 'run_maturity_scan') || role === 'aicte_officer') && (
              <Button size="sm" loading={scanMutation.isPending} onClick={() => scanMutation.mutate()}>
                <Play className="h-3.5 w-3.5" /> Run monitoring scan
              </Button>
            )}
          </>
        }
      />

      <Alert tone="warning" title="How to read this queue">
        "Matured — no release application" means no release application is recorded in FDR Sentinel. It does not mean the
        institution failed to apply through the official process. Confirm the status before drawing conclusions.
      </Alert>

      <Tabs<AlertTab>
        value={tab}
        onChange={(value) => {
          const next = new URLSearchParams(params);
          next.set('tab', value);
          setParams(next, { replace: true });
        }}
        options={[
          { value: 'upcoming', label: `Next ${warningDays[0]} days`, count: counts.upcoming },
          { value: 'seven', label: 'Next 7 days', count: counts.seven },
          { value: 'today', label: 'Maturing today', count: counts.today },
          { value: 'matured', label: 'Matured', count: counts.matured },
          { value: 'no-release', label: 'No release application', count: counts['no-release'] },
        ]}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label="Search maturity queue"
          placeholder="Search reference, bank or institution…"
          className="max-w-xs"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        {role !== 'institution_user' && (
          <Select
            aria-label="Filter by institution"
            className="max-w-xs"
            value={institution}
            onChange={(event) => setInstitution(event.target.value)}
          >
            <option value="">All institutions</option>
            {(institutions.data ?? []).map((item) => (
              <option key={item.id} value={item.id}>
                {item.institution_name}
              </option>
            ))}
          </Select>
        )}
        <span className="text-xs text-slate-500">
          {rows.length} record(s) in this view
          {recordsQuery.data?.length === 500 ? ' (first 500 shown)' : ''}
        </span>
      </div>

      {recordsQuery.error && (
        <Alert tone="danger" title="The maturity queue could not be loaded">
          {errorMessage(recordsQuery.error)}
        </Alert>
      )}

      <TableShell>
        {recordsQuery.isLoading ? (
          <Spinner label="Calculating maturity status…" />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<CalendarClock className="h-5 w-5" />}
            title="Nothing in this queue"
            description={
              tab === 'no-release'
                ? 'Every matured record has a recorded release application or has been closed.'
                : 'No records fall into this window right now.'
            }
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <th>FDR reference</th>
                {role !== 'institution_user' && <th>Institution</th>}
                <th>Bank</th>
                <th className="text-right">Amount</th>
                <th>Maturity date</th>
                <th>Position</th>
                <th>Verification</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((record) => {
                const maturity = classifyMaturity(
                  {
                    maturity_date: record.maturity_date,
                    validity_status: record.validity_status,
                    archived_at: record.archived_at,
                    release_application_statuses: (record.release_applications ?? [])
                      .filter((application) => application.application_type === 'release')
                      .map((application) => application.status),
                  },
                  today,
                  warningDays,
                );
                return (
                  <tr key={record.id}>
                    <td>
                      <Link to={`/fdrs/${record.id}`} className="font-medium text-navy-800 hover:underline">
                        {record.fdr_reference_number}
                      </Link>
                      {record.is_demo && (
                        <span className="ml-1.5 rounded bg-amber-100 px-1 py-0.5 text-[9px] font-semibold uppercase text-amber-800">
                          demo
                        </span>
                      )}
                    </td>
                    {role !== 'institution_user' && (
                      <td className="max-w-[200px] truncate text-xs">{record.institutions?.institution_name ?? '—'}</td>
                    )}
                    <td className="text-xs">{record.issuing_bank}</td>
                    <td className="whitespace-nowrap text-right text-xs font-medium">{formatCurrency(record.deposit_amount)}</td>
                    <td className="whitespace-nowrap text-xs">
                      {formatDate(record.maturity_date)}
                      <span className="ml-1 text-[10px] text-slate-400">({maturity.daysToMaturity}d)</span>
                    </td>
                    <td>
                      <MaturityBadge state={maturity.state} label={maturity.label} />
                    </td>
                    <td className="text-xs capitalize text-slate-600">{record.verification_status.replace(/_/g, ' ')}</td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </TableShell>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-amber-600" /> Alerting behaviour
          </CardTitle>
          <CardDescription>
            The daily scan creates in-app notifications for approaching maturity, maturing-today records and matured records
            without a release application. Each event/recipient pair is de-duplicated by a unique key, so repeated runs do
            not duplicate alerts.
            {settings.data?.emailEnabled
              ? ' Email delivery is configured for this deployment.'
              : ' Email delivery is not configured, so only in-app notifications are produced.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="text-xs text-slate-600">
          <Link to="/notifications" className="font-medium text-navy-700 hover:underline">
            View notification history
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
