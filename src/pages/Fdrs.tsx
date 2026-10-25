import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { FilePlus2, FilterX, Search, Download, ChevronRight, Archive } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { useInstitutions, useSettings } from '@/lib/queries';
import { can } from '@/lib/permissions';
import { addDays, classifyMaturity, todayInPolicyZone } from '@/lib/maturity';
import type { FdrRecord, ReleaseApplication } from '@/lib/types';
import { formatCurrency, formatDate, VERIFICATION_LABELS } from '@/lib/format';
import { downloadCsv, toCsv } from '@/lib/csv';
import { errorMessage } from '@/lib/utils';
import { useToast } from '@/components/ui/overlays';
import {
  Alert,
  Button,
  Input,
  PageHeader,
  Select,
  Skeleton,
  EmptyState,
} from '@/components/ui/primitives';
import { MaturityBadge, Pagination, Table, TableShell, VerificationBadge } from '@/components/ui/data-display';
import { useLogEvent } from '@/lib/queries';

type Row = FdrRecord & { release_applications?: Pick<ReleaseApplication, 'id' | 'application_type' | 'status'>[] };

const PAGE_SIZE = 12;

const SELECT_COLUMNS =
  'id, institution_id, fdr_reference_number, issuing_bank, branch_name, deposit_amount, issue_date, maturity_date, validity_status, renewal_status, administrative_status, verification_status, notes, submitted_at, last_verified_at, archived_at, is_demo, created_by, created_at, updated_at, institutions(id, institution_name, institution_code), release_applications(id, application_type, status)';

export default function FdrListPage() {
  const { role } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const settings = useSettings();
  const institutions = useInstitutions();
  const { push } = useToast();
  const logEvent = useLogEvent();
  const today = todayInPolicyZone();

  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [institution, setInstitution] = useState(searchParams.get('institution') ?? '');
  const [verification, setVerification] = useState(searchParams.get('verification') ?? '');
  const [maturity, setMaturity] = useState(searchParams.get('maturity') ?? '');
  const [includeArchived, setIncludeArchived] = useState(false);
  const [sort, setSort] = useState('updated_at');
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    const handle = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(handle);
  }, [searchInput]);

  useEffect(() => {
    const params = new URLSearchParams();
    if (institution) params.set('institution', institution);
    if (verification) params.set('verification', verification);
    if (maturity) params.set('maturity', maturity);
    setSearchParams(params, { replace: true });
  }, [institution, verification, maturity, setSearchParams]);

  const warningDays = settings.data?.warningDays ?? [30, 15, 7];

  const buildQuery = (forExport = false) => {
    let query = supabase
      .from('fdr_records')
      .select(SELECT_COLUMNS, forExport ? undefined : { count: 'exact' });
    if (!includeArchived) query = query.is('archived_at', null);
    if (institution) query = query.eq('institution_id', institution);
    if (verification) query = query.eq('verification_status', verification);
    if (maturity) {
      if (maturity === 'matured') query = query.eq('validity_status', 'active').lt('maturity_date', today);
      else if (maturity === 'today') query = query.eq('validity_status', 'active').eq('maturity_date', today);
      else if (maturity === 'upcoming') query = query.eq('validity_status', 'active').gte('maturity_date', today).lte('maturity_date', addDays(today, warningDays[0] ?? 30));
      else if (maturity === 'active') query = query.eq('validity_status', 'active').gt('maturity_date', today);
    }
    if (search) {
      const safe = search.replace(/[(),*]/g, ' ').trim();
      if (safe) {
        const term = `%${safe}%`;
        query = query.or(
          `fdr_reference_number.ilike.${term},issuing_bank.ilike.${term},branch_name.ilike.${term}`,
        );
      }
    }
    return query.order(sort, { ascending: sort === 'fdr_reference_number' });
  };

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['fdrs', { institution, verification, maturity, search, includeArchived, sort, page }],
    queryFn: async () => {
      const from = (page - 1) * PAGE_SIZE;
      const { data: rows, error: queryError, count } = await buildQuery()
        .range(from, from + PAGE_SIZE - 1);
      if (queryError) throw new Error(queryError.message);
      return { rows: (rows ?? []) as unknown as Row[], count: count ?? 0 };
    },
  });

  const total = data?.count ?? 0;

  const activeFilters = useMemo(
    () => [institution, verification, maturity, search, includeArchived ? 'archived' : ''].filter(Boolean).length,
    [institution, verification, maturity, search, includeArchived],
  );

  const resetFilters = () => {
    setSearchInput('');
    setSearch('');
    setInstitution('');
    setVerification('');
    setMaturity('');
    setIncludeArchived(false);
    setSort('updated_at');
    setPage(1);
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const { data: rows, error: exportError } = await buildQuery(true).limit(5000);
      if (exportError) throw new Error(exportError.message);
      const records = (rows ?? []) as unknown as Row[];
      if (records.length === 0) {
        push({ title: 'Nothing to export', description: 'No records match the current filters.', tone: 'info' });
        return;
      }
      const csv = toCsv(records, [
        { key: 'fdr_reference_number', label: 'FDR reference' },
        { key: 'institution', label: 'Institution', value: (row) => row.institutions?.institution_name ?? '' },
        { key: 'institution_code', label: 'Institution code', value: (row) => row.institutions?.institution_code ?? '' },
        { key: 'issuing_bank', label: 'Issuing bank' },
        { key: 'branch_name', label: 'Branch', value: (row) => row.branch_name ?? '' },
        { key: 'deposit_amount', label: 'Deposit amount (INR)' },
        { key: 'issue_date', label: 'Issue date' },
        { key: 'maturity_date', label: 'Maturity date' },
        { key: 'validity_status', label: 'Validity' },
        { key: 'renewal_status', label: 'Renewal status' },
        { key: 'administrative_status', label: 'Administrative status' },
        { key: 'verification_status', label: 'Verification status' },
        { key: 'is_demo', label: 'Demonstration data', value: (row) => (row.is_demo ? 'Yes' : 'No') },
      ]);
      downloadCsv('fdr-registry', csv);
      await logEvent.mutateAsync({
        action: 'report.export',
        entity_type: 'fdr_records',
        summary: `Exported ${records.length} FDR records to CSV`,
        metadata: { filters: { institution, verification, maturity, search, includeArchived }, rows: records.length },
      });
      push({ title: 'CSV exported', description: `${records.length} record(s) exported. The export was added to the audit trail.`, tone: 'success' });
    } catch (exportError) {
      push({ title: 'Export failed', description: errorMessage(exportError), tone: 'error' });
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Module B"
        title="FDR Registry"
        description="Institution-wise Fixed Deposit Receipt records. Amounts are stored as exact numerics; maturity status is derived from dates in the Asia/Kolkata policy timezone."
        actions={
          <>
            {can(role, 'export_reports') && (
              <Button variant="outline" size="sm" onClick={handleExport} loading={exporting}>
                <Download className="h-3.5 w-3.5" /> Export CSV
              </Button>
            )}
            {can(role, 'create_fdr') && (
              <Link to="/fdrs/new">
                <Button size="sm">
                  <FilePlus2 className="h-4 w-4" /> Register FDR
                </Button>
              </Link>
            )}
          </>
        }
      />

      <div className="flex flex-wrap items-end gap-2 rounded-lg border border-border bg-white p-3">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
          <Input
            aria-label="Search FDR records"
            placeholder="Search reference, bank or branch…"
            className="pl-9"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
          />
        </div>

        {role !== 'institution_user' && (
          <Select
            aria-label="Filter by institution"
            className="w-[220px]"
            value={institution}
            onChange={(event) => {
              setInstitution(event.target.value);
              setPage(1);
            }}
          >
            <option value="">All institutions</option>
            {(institutions.data ?? []).map((item) => (
              <option key={item.id} value={item.id}>
                {item.institution_name}
              </option>
            ))}
          </Select>
        )}

        <Select
          aria-label="Filter by verification status"
          className="w-[180px]"
          value={verification}
          onChange={(event) => {
            setVerification(event.target.value);
            setPage(1);
          }}
        >
          <option value="">All verification states</option>
          {Object.entries(VERIFICATION_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>

        <Select
          aria-label="Filter by maturity"
          className="w-[170px]"
          value={maturity}
          onChange={(event) => {
            setMaturity(event.target.value);
            setPage(1);
          }}
        >
          <option value="">Any maturity</option>
          <option value="active">Active (future)</option>
          <option value="upcoming">Approaching maturity</option>
          <option value="today">Maturing today</option>
          <option value="matured">Matured</option>
        </Select>

        <Select
          aria-label="Sort records"
          className="w-[165px]"
          value={sort}
          onChange={(event) => {
            setSort(event.target.value);
            setPage(1);
          }}
        >
          <option value="updated_at">Recently updated</option>
          <option value="maturity_date">Maturity date</option>
          <option value="deposit_amount">Deposit amount</option>
          <option value="fdr_reference_number">Reference number</option>
        </Select>

        {role === 'system_admin' && (
          <label className="flex items-center gap-1.5 px-1 text-xs text-slate-600">
            <input
              type="checkbox"
              className="h-3.5 w-3.5 rounded border-slate-300"
              checked={includeArchived}
              onChange={(event) => {
                setIncludeArchived(event.target.checked);
                setPage(1);
              }}
            />
            <Archive className="h-3.5 w-3.5" /> Archived
          </label>
        )}

        {activeFilters > 0 && (
          <Button variant="ghost" size="sm" onClick={resetFilters}>
            <FilterX className="h-3.5 w-3.5" /> Clear
          </Button>
        )}
      </div>

      {error && (
        <Alert tone="danger" title="Records could not be loaded">
          <p>{errorMessage(error)}</p>
          <Button variant="outline" size="sm" className="mt-2" onClick={() => void refetch()}>
            Retry
          </Button>
        </Alert>
      )}

      <TableShell>
        {isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="h-12" />
            ))}
          </div>
        ) : (data?.rows ?? []).length === 0 ? (
          <EmptyState
            title={activeFilters > 0 ? 'No records match these filters' : 'No FDR records yet'}
            description={
              activeFilters > 0
                ? 'Try widening the search or clearing filters.'
                : role === 'institution_user'
                  ? 'Register an FDR to start monitoring its maturity.'
                  : 'Register the first FDR, or load demonstration data from the dashboard.'
            }
            action={
              activeFilters > 0 ? (
                <Button variant="outline" size="sm" onClick={resetFilters}>
                  Clear filters
                </Button>
              ) : undefined
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
                <th>Maturity</th>
                <th>Verification</th>
                <th className="w-8" aria-label="Open" />
              </tr>
            </thead>
            <tbody>
              {(data?.rows ?? []).map((record) => {
                const maturityState = classifyMaturity(
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
                      <div className="mt-0.5 flex flex-wrap items-center gap-1">
                        {record.is_demo && (
                          <span className="rounded bg-amber-100 px-1 py-0.5 text-[9px] font-semibold uppercase text-amber-800">
                            demo
                          </span>
                        )}
                        <span className="text-[10px] text-slate-400">Issued {formatDate(record.issue_date)}</span>
                      </div>
                    </td>
                    {role !== 'institution_user' && (
                      <td>
                        <p className="max-w-[190px] truncate text-xs font-medium text-slate-700">
                          {record.institutions?.institution_name ?? '—'}
                        </p>
                        <p className="text-[10px] text-slate-400">{record.institutions?.institution_code ?? ''}</p>
                      </td>
                    )}
                    <td>
                      <p className="max-w-[170px] truncate text-xs">{record.issuing_bank}</p>
                      <p className="max-w-[170px] truncate text-[10px] text-slate-400">{record.branch_name ?? '—'}</p>
                    </td>
                    <td className="whitespace-nowrap text-right font-medium">{formatCurrency(record.deposit_amount)}</td>
                    <td>
                      <p className="whitespace-nowrap text-xs">{formatDate(record.maturity_date)}</p>
                      <div className="mt-1">
                        <MaturityBadge state={maturityState.state} label={maturityState.label} />
                      </div>
                    </td>
                    <td>
                      <VerificationBadge status={record.verification_status} />
                    </td>
                    <td>
                      <Link
                        to={`/fdrs/${record.id}`}
                        aria-label={`Open ${record.fdr_reference_number}`}
                        className="text-slate-400 hover:text-navy-700"
                      >
                        <ChevronRight className="h-4 w-4" />
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </TableShell>

      {!isLoading && total > 0 && (
        <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />
      )}

      <p className="text-[11px] leading-relaxed text-slate-500">
        Institution users can only see their own institution — enforced by Row Level Security on both the table and the
        private document bucket.
      </p>
    </div>
  );
}
