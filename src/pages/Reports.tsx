import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { BarChart3, Download, FileSpreadsheet } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { useDashboardSummary, useInstitutions, useLogEvent, useSettings } from '@/lib/queries';
import { addDays, classifyMaturity, hasRecordedApplication, todayInPolicyZone } from '@/lib/maturity';
import { RULE_LABELS } from '@/lib/discrepancies';
import { APPLICATION_TYPE_LABELS, DISCREPANCY_STATUS_LABELS, formatCurrency, formatDate, formatDateTime, humanize } from '@/lib/format';
import type { DiscrepancyFlag, FdrRecord, ReleaseApplication } from '@/lib/types';
import { downloadCsv, toCsv } from '@/lib/csv';
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
import { useToast } from '@/components/ui/overlays';

type ReportKey =
  | 'active'
  | 'approaching'
  | 'matured'
  | 'matured_no_release'
  | 'pending_verification'
  | 'discrepancies'
  | 'renewals'
  | 'releases'
  | 'institution_wise';

const FDR_SELECT =
  'id, institution_id, fdr_reference_number, issuing_bank, branch_name, deposit_amount, issue_date, maturity_date, validity_status, renewal_status, administrative_status, verification_status, notes, submitted_at, last_verified_at, archived_at, is_demo, created_by, created_at, updated_at, institutions(id, institution_name, institution_code), release_applications(id, application_type, status)';

type FdrRow = FdrRecord & {
  institutions?: { id: string; institution_name: string; institution_code: string } | null;
  release_applications?: Pick<ReleaseApplication, 'id' | 'application_type' | 'status'>[];
};

const REPORT_OPTIONS: Array<{ value: ReportKey; label: string; description: string }> = [
  { value: 'active', label: 'Active FDRs', description: 'Live instruments that have not yet matured.' },
  { value: 'approaching', label: 'Upcoming maturity', description: 'Records inside the configured warning window.' },
  { value: 'matured', label: 'Matured FDRs', description: 'Live records whose maturity date has passed.' },
  {
    value: 'matured_no_release',
    label: 'Matured without release application',
    description: 'Follow-up list: no release application is recorded in this system.',
  },
  { value: 'pending_verification', label: 'Pending verification', description: 'Awaiting officer document review.' },
  { value: 'discrepancies', label: 'Discrepancy flags', description: 'Unresolved or reviewed verification findings.' },
  { value: 'renewals', label: 'Renewals in progress', description: 'Renewal applications not yet closed.' },
  { value: 'releases', label: 'Release requests', description: 'Release applications not yet closed.' },
  { value: 'institution_wise', label: 'Institution-wise position', description: 'Active, matured and flagged counts per institution.' },
];

export default function ReportsPage() {
  const { role } = useAuth();
  const settings = useSettings();
  const institutions = useInstitutions();
  const summary = useDashboardSummary();
  const logEvent = useLogEvent();
  const { push } = useToast();
  const today = todayInPolicyZone();
  const warningDays = settings.data?.warningDays ?? [30, 15, 7];
  const [report, setReport] = useState<ReportKey>('active');
  const [institution, setInstitution] = useState('');
  const [search, setSearch] = useState('');
  const [exporting, setExporting] = useState(false);
  const selected = REPORT_OPTIONS.find((option) => option.value === report);

  const dataQuery = useQuery({
    queryKey: ['report', report, institution, today, warningDays.join(',')],
    enabled: report !== 'institution_wise',
    queryFn: async (): Promise<{ fdrs: FdrRow[]; flags: DiscrepancyFlag[] }> => {
      if (report === 'discrepancies') {
        let query = supabase
          .from('discrepancy_flags')
          .select('*, fdr_records(id, fdr_reference_number, issuing_bank, maturity_date, institutions(institution_name, institution_code))')
          .order('detected_at', { ascending: false })
          .limit(2000);
        if (institution) {
          const { data: ids } = await supabase.from('fdr_records').select('id').eq('institution_id', institution).limit(5000);
          query = query.in('fdr_id', (ids ?? []).map((row) => row.id));
        }
        const { data, error } = await query;
        if (error) throw new Error(error.message);
        return { fdrs: [], flags: (data ?? []) as unknown as DiscrepancyFlag[] };
      }

      let query = supabase.from('fdr_records').select(FDR_SELECT).is('archived_at', null).limit(2000);
      if (institution) query = query.eq('institution_id', institution);
      if (report === 'active') query = query.eq('validity_status', 'active').gte('maturity_date', today);
      if (report === 'approaching') {
        query = query
          .eq('validity_status', 'active')
          .gte('maturity_date', today)
          .lte('maturity_date', addDays(today, warningDays[0] ?? 30));
      }
      if (report === 'matured' || report === 'matured_no_release') {
        query = query.eq('validity_status', 'active').lt('maturity_date', today);
      }
      if (report === 'pending_verification') query = query.in('verification_status', ['pending', 'in_review']);
      if (report === 'renewals' || report === 'releases') {
        const type = report === 'renewals' ? 'renewal' : 'release';
        const { data: ids, error: idError } = await supabase
          .from('release_applications')
          .select('fdr_id')
          .eq('application_type', type)
          .in('status', ['submitted', 'under_review', 'info_required', 'resubmitted'])
          .limit(5000);
        if (idError) throw new Error(idError.message);
        query = query.in('id', [...new Set((ids ?? []).map((row) => row.fdr_id))]);
      }
      const { data, error } = await query.order('maturity_date', { ascending: true });
      if (error) throw new Error(error.message);
      let fdrs = (data ?? []) as unknown as FdrRow[];
      if (report === 'matured_no_release') {
        fdrs = fdrs.filter(
          (record) =>
            !hasRecordedApplication(
              (record.release_applications ?? [])
                .filter((application) => application.application_type === 'release')
                .map((application) => application.status),
            ),
        );
      }
      return { fdrs, flags: [] };
    },
  });

  const filteredFdrs = useMemo(() => {
    const rows = dataQuery.data?.fdrs ?? [];
    if (!search.trim()) return rows;
    const term = search.trim().toLowerCase();
    return rows.filter(
      (row) =>
        row.fdr_reference_number.toLowerCase().includes(term) ||
        row.issuing_bank.toLowerCase().includes(term) ||
        (row.institutions?.institution_name ?? '').toLowerCase().includes(term),
    );
  }, [dataQuery.data, search]);

  const filteredFlags = useMemo(() => {
    const rows = dataQuery.data?.flags ?? [];
    if (!search.trim()) return rows;
    const term = search.trim().toLowerCase();
    return rows.filter(
      (row) =>
        (row.fdr_records?.fdr_reference_number ?? '').toLowerCase().includes(term) ||
        (row.fdr_records?.institutions?.institution_name ?? '').toLowerCase().includes(term) ||
        row.rule_code.toLowerCase().includes(term),
    );
  }, [dataQuery.data, search]);

  const handleExport = async () => {
    setExporting(true);
    try {
      if (report === 'institution_wise') {
        const rows = summary.data?.institution_breakdown ?? [];
        const csv = toCsv(rows, [
          { key: 'institution_code', label: 'Institution code' },
          { key: 'institution_name', label: 'Institution' },
          { key: 'active', label: 'Active' },
          { key: 'matured', label: 'Matured' },
          { key: 'flagged', label: 'Flagged' },
        ]);
        downloadCsv('institution-wise-position', csv);
        await logEvent.mutateAsync({
          action: 'report.export',
          entity_type: 'institutions',
          summary: `Exported institution-wise position (${rows.length} institutions)`,
          metadata: { report },
        });
        push({ title: 'CSV exported', description: `${rows.length} institution(s) exported.`, tone: 'success' });
        return;
      }

      if (report === 'discrepancies') {
        if (filteredFlags.length === 0) {
          push({ title: 'Nothing to export', description: 'No flags match this report.', tone: 'info' });
          return;
        }
        const csv = toCsv(filteredFlags, [
          { key: 'fdr', label: 'FDR reference', value: (row) => row.fdr_records?.fdr_reference_number ?? '' },
          { key: 'institution', label: 'Institution', value: (row) => row.fdr_records?.institutions?.institution_name ?? '' },
          { key: 'rule', label: 'Rule', value: (row) => RULE_LABELS[row.rule_code] ?? row.rule_code },
          { key: 'field', label: 'Field', value: (row) => row.field_name },
          { key: 'severity', label: 'Severity' },
          { key: 'submitted', label: 'Submitted value', value: (row) => row.submitted_value ?? '' },
          { key: 'compared', label: 'Comparison value', value: (row) => row.compared_value ?? '' },
          { key: 'status', label: 'Status', value: (row) => DISCREPANCY_STATUS_LABELS[row.status] },
          { key: 'detected', label: 'Detected', value: (row) => formatDateTime(row.detected_at) },
        ]);
        downloadCsv('discrepancy-report', csv);
        await logEvent.mutateAsync({
          action: 'report.export',
          entity_type: 'discrepancy_flags',
          summary: `Exported discrepancy report (${filteredFlags.length} flags)`,
          metadata: { report, institution },
        });
        push({ title: 'CSV exported', description: `${filteredFlags.length} flag(s) exported.`, tone: 'success' });
        return;
      }

      if (filteredFdrs.length === 0) {
        push({ title: 'Nothing to export', description: 'No records match this report.', tone: 'info' });
        return;
      }
      const csv = toCsv(filteredFdrs, [
        { key: 'fdr_reference_number', label: 'FDR reference' },
        { key: 'institution', label: 'Institution', value: (row) => row.institutions?.institution_name ?? '' },
        { key: 'institution_code', label: 'Institution code', value: (row) => row.institutions?.institution_code ?? '' },
        { key: 'issuing_bank', label: 'Bank' },
        { key: 'deposit_amount', label: 'Amount (INR)' },
        { key: 'issue_date', label: 'Issue date' },
        { key: 'maturity_date', label: 'Maturity date' },
        { key: 'days', label: 'Days to maturity', value: (row) => String(classifyMaturity(row, today, warningDays).daysToMaturity) },
        { key: 'verification_status', label: 'Verification' },
        { key: 'administrative_status', label: 'Administrative status' },
        { key: 'renewal_status', label: 'Renewal status' },
        { key: 'is_demo', label: 'Demonstration data', value: (row) => (row.is_demo ? 'Yes' : 'No') },
      ]);
      downloadCsv(`report-${report}`, csv);
      await logEvent.mutateAsync({
        action: 'report.export',
        entity_type: 'fdr_records',
        summary: `Exported ${selected?.label} report (${filteredFdrs.length} rows)`,
        metadata: { report, institution, rows: filteredFdrs.length },
      });
      push({ title: 'CSV exported', description: `${filteredFdrs.length} row(s) exported and audited.`, tone: 'success' });
    } catch (error) {
      push({ title: 'Export failed', description: errorMessage(error), tone: 'error' });
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Module I"
        title="Reports"
        description="Reports are generated from live records through the same Row Level Security as every other view, so an institution user can only ever export their own institution's data."
        actions={
          <Button variant="outline" size="sm" onClick={handleExport} loading={exporting}>
            <Download className="h-3.5 w-3.5" /> Export CSV
          </Button>
        }
      />

      <Card>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="min-w-[260px] flex-1">
            <Field label="Report" htmlFor="report-type">
              <Select id="report-type" value={report} onChange={(event) => setReport(event.target.value as ReportKey)}>
                {REPORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </Field>
            <p className="mt-1 text-xs text-slate-500">{selected?.description}</p>
          </div>
          {role !== 'institution_user' && (
            <div className="w-[240px]">
              <Field label="Institution" htmlFor="report-institution">
                <Select id="report-institution" value={institution} onChange={(event) => setInstitution(event.target.value)}>
                  <option value="">All institutions</option>
                  {(institutions.data ?? []).map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.institution_name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          )}
          <div className="w-[220px]">
            <Field label="Search" htmlFor="report-search">
              <Input
                id="report-search"
                placeholder="Reference, bank, institution…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </Field>
          </div>
        </CardContent>
      </Card>

      <Alert tone="info" title="Export scope and audit">
        Exports respect your role and institution. Every export is written to the audit trail with the filters used and the
        number of rows. Records flagged as demonstration data are labelled in the export.
      </Alert>

      {dataQuery.error && (
        <Alert tone="danger" title="The report could not be generated">
          {errorMessage(dataQuery.error)}
        </Alert>
      )}

      <TableShell>
        {report === 'institution_wise' ? (
          summary.isLoading ? (
            <Spinner label="Building institution summary…" />
          ) : (summary.data?.institution_breakdown ?? []).length === 0 ? (
            <EmptyState icon={<BarChart3 className="h-5 w-5" />} title="No institution data" />
          ) : (
            <Table>
              <thead>
                <tr>
                  <th>Institution</th>
                  <th>Code</th>
                  <th className="text-right">Active</th>
                  <th className="text-right">Matured</th>
                  <th className="text-right">Flagged</th>
                </tr>
              </thead>
              <tbody>
                {(summary.data?.institution_breakdown ?? []).map((row) => (
                  <tr key={row.id}>
                    <td className="font-medium text-navy-900">{row.institution_name}</td>
                    <td className="text-xs text-slate-500">{row.institution_code}</td>
                    <td className="text-right">{row.active}</td>
                    <td className="text-right">{row.matured}</td>
                    <td className="text-right">{row.flagged}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )
        ) : dataQuery.isLoading ? (
          <Spinner label="Generating report…" />
        ) : report === 'discrepancies' ? (
          filteredFlags.length === 0 ? (
            <EmptyState icon={<FileSpreadsheet className="h-5 w-5" />} title="No flags for this report" />
          ) : (
            <Table>
              <thead>
                <tr>
                  <th>FDR</th>
                  <th>Rule</th>
                  <th>Values</th>
                  <th>Severity</th>
                  <th>Status</th>
                  <th>Detected</th>
                </tr>
              </thead>
              <tbody>
                {filteredFlags.slice(0, 200).map((flag) => (
                  <tr key={flag.id}>
                    <td>
                      <Link to={`/fdrs/${flag.fdr_id}`} className="text-xs font-medium text-navy-800 hover:underline">
                        {flag.fdr_records?.fdr_reference_number ?? '—'}
                      </Link>
                      <p className="max-w-[180px] truncate text-[10px] text-slate-500">
                        {flag.fdr_records?.institutions?.institution_name ?? ''}
                      </p>
                    </td>
                    <td className="max-w-[190px] text-xs">{RULE_LABELS[flag.rule_code] ?? flag.rule_code}</td>
                    <td className="max-w-[220px] text-[11px] text-slate-600">
                      {flag.submitted_value ?? '—'} → {flag.compared_value ?? '—'}
                    </td>
                    <td>
                      <Badge tone={flag.severity === 'critical' ? 'danger' : flag.severity === 'warning' ? 'warning' : 'info'}>
                        {flag.severity}
                      </Badge>
                    </td>
                    <td className="text-xs">{DISCREPANCY_STATUS_LABELS[flag.status]}</td>
                    <td className="whitespace-nowrap text-[11px] text-slate-500">{formatDateTime(flag.detected_at)}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )
        ) : filteredFdrs.length === 0 ? (
          <EmptyState icon={<FileSpreadsheet className="h-5 w-5" />} title="No records for this report" />
        ) : (
          <Table>
            <thead>
              <tr>
                <th>FDR reference</th>
                {role !== 'institution_user' && <th>Institution</th>}
                <th>Bank</th>
                <th className="text-right">Amount</th>
                <th>Maturity</th>
                <th>Verification</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {filteredFdrs.slice(0, 200).map((row) => (
                <tr key={row.id}>
                  <td>
                    <Link to={`/fdrs/${row.id}`} className="text-xs font-medium text-navy-800 hover:underline">
                      {row.fdr_reference_number}
                    </Link>
                    {row.is_demo && (
                      <span className="ml-1.5 rounded bg-amber-100 px-1 py-0.5 text-[9px] font-semibold uppercase text-amber-800">
                        demo
                      </span>
                    )}
                  </td>
                  {role !== 'institution_user' && (
                    <td className="max-w-[190px] truncate text-xs">{row.institutions?.institution_name ?? '—'}</td>
                  )}
                  <td className="text-xs">{row.issuing_bank}</td>
                  <td className="whitespace-nowrap text-right text-xs">{formatCurrency(row.deposit_amount)}</td>
                  <td className="whitespace-nowrap text-xs">{formatDate(row.maturity_date)}</td>
                  <td className="text-xs capitalize">{humanize(row.verification_status)}</td>
                  <td className="text-xs capitalize">{humanize(row.administrative_status)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </TableShell>

      {report !== 'institution_wise' && (
        <p className="text-[11px] text-slate-500">
          Showing up to 200 rows in the preview. The CSV export includes every matching record (up to 2,000 per export).
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Report definitions</CardTitle>
          <CardDescription>What each report counts, so figures are never presented without context.</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-2 sm:grid-cols-2">
            {REPORT_OPTIONS.filter((option) => option.value !== report).map((option) => (
              <div key={option.value} className="rounded-md border border-slate-200 bg-slate-50/60 p-2.5">
                <dt className="text-xs font-semibold text-slate-800">{option.label}</dt>
                <dd className="mt-0.5 text-[11px] leading-relaxed text-slate-600">{option.description}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-[11px] text-slate-500">
            Release application types: {Object.values(APPLICATION_TYPE_LABELS).join(' · ')}. Maturity figures use{' '}
            {settings.data?.timezone ?? 'Asia/Kolkata'} and warning intervals of {warningDays.join(' / ')} days.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
