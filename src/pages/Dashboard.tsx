import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  Database,
  FilePlus2,
  FileSearch,
  Flag,
  RefreshCcw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { api } from '@/lib/api';
import { useDashboardSummary, useSettings } from '@/lib/queries';
import { can } from '@/lib/permissions';
import { classifyMaturity, hasRecordedApplication, todayInPolicyZone } from '@/lib/maturity';
import type { FdrRecord, ReleaseApplication } from '@/lib/types';
import { formatCurrency, formatDate, humanize } from '@/lib/format';
import { cn, errorMessage } from '@/lib/utils';
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  PageHeader,
  Skeleton,
} from '@/components/ui/primitives';
import { MetricCard, VerificationBadge } from '@/components/ui/data-display';
import { useToast } from '@/components/ui/overlays';

interface AttentionRecord extends FdrRecord {
  release_applications?: Pick<ReleaseApplication, 'id' | 'application_type' | 'status'>[];
}

const VERIFICATION_COLORS: Record<string, string> = {
  pending: '#94a3b8',
  in_review: '#0ea5e9',
  verified: '#10b981',
  flagged: '#f59e0b',
  rejected: '#ef4444',
};

export default function DashboardPage() {
  const { profile, role } = useAuth();
  const settings = useSettings();
  const { data, isLoading, error, refetch } = useDashboardSummary();
  const queryClient = useQueryClient();
  const { push } = useToast();
  const [seeding, setSeeding] = useState(false);
  const today = todayInPolicyZone();
  const warningDays = useMemo(() => settings.data?.warningDays ?? [30, 15, 7], [settings.data?.warningDays]);

  const attention = useQuery({
    queryKey: ['dashboard-attention', today],
    queryFn: async (): Promise<AttentionRecord[]> => {
      const { data: rows, error: queryError } = await supabase
        .from('fdr_records')
        .select(
          'id, institution_id, fdr_reference_number, issuing_bank, branch_name, deposit_amount, issue_date, maturity_date, validity_status, renewal_status, administrative_status, verification_status, notes, submitted_at, last_verified_at, archived_at, is_demo, created_by, created_at, updated_at, institutions(id, institution_name, institution_code), release_applications(id, application_type, status)',
        )
        .is('archived_at', null)
        .eq('validity_status', 'active')
        .lte('maturity_date', today)
        .order('maturity_date', { ascending: true })
        .limit(60);
      if (queryError) throw new Error(queryError.message);
      return (rows ?? []) as unknown as AttentionRecord[];
    },
  });

  const recent = useQuery({
    queryKey: ['dashboard-recent'],
    queryFn: async (): Promise<AttentionRecord[]> => {
      const { data: rows, error: queryError } = await supabase
        .from('fdr_records')
        .select(
          'id, institution_id, fdr_reference_number, issuing_bank, branch_name, deposit_amount, issue_date, maturity_date, validity_status, renewal_status, administrative_status, verification_status, notes, submitted_at, last_verified_at, archived_at, is_demo, created_by, created_at, updated_at, institutions(id, institution_name, institution_code)',
        )
        .is('archived_at', null)
        .order('updated_at', { ascending: false })
        .limit(6);
      if (queryError) throw new Error(queryError.message);
      return (rows ?? []) as unknown as AttentionRecord[];
    },
  });

  const seedDemo = useMutation({
    mutationFn: () => api.seedDemoData(),
    onSuccess: async (result) => {
      push({
        title: 'Demonstration data loaded',
        description: `${result.counts.institutions ?? 0} institutions and ${result.counts.fdr_records ?? 0} synthetic FDRs created. Every row is labelled demonstration data.`,
        tone: 'success',
      });
      await queryClient.invalidateQueries();
    },
    onError: (mutationError) => push({ title: 'Could not load demo data', description: errorMessage(mutationError), tone: 'error' }),
  });

  const noRelease = useMemo(
    () =>
      (attention.data ?? []).filter(
        (record) =>
          !hasRecordedApplication((record.release_applications ?? []).map((application) => application.status)) &&
          classifyMaturity(record, today, warningDays).state === 'matured_no_application',
      ),
    [attention.data, today, warningDays],
  );

  const verificationData = useMemo(
    () =>
      Object.entries(data?.verification_breakdown ?? {}).map(([status, count]) => ({
        name: humanize(status),
        key: status,
        value: count,
      })),
    [data],
  );

  const bucketData = useMemo(() => {
    const order = ['matured', 'today', '0-7 days', '8-15 days', '16-30 days', '31-90 days', 'over 90 days', 'closed'];
    const map = new Map((data?.maturity_buckets ?? []).map((bucket) => [bucket.bucket, bucket.c]));
    return order.filter((key) => map.has(key)).map((key) => ({ bucket: key, count: map.get(key) ?? 0 }));
  }, [data]);

  const isInstitution = role === 'institution_user';

  if (error) {
    return (
      <Alert tone="danger" title="The dashboard metrics could not be loaded">
        <p>{errorMessage(error)}</p>
        <Button variant="outline" size="sm" className="mt-2" onClick={() => void refetch()}>
          <RefreshCcw className="h-3.5 w-3.5" /> Retry
        </Button>
      </Alert>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={isInstitution ? 'Institution dashboard' : 'AICTE monitoring'}
        title={`Good day${profile?.full_name ? `, ${profile.full_name.split(' ')[0]}` : ''}`}
        description={
          <span>
            Maturity and verification position as of{' '}
            <strong className="font-semibold text-slate-800">{formatDate(data?.today ?? today)}</strong> (Asia/Kolkata).
            {isInstitution
              ? ' Your view is limited to your own institution by database policy.'
              : ' Figures are calculated from live records; nothing on this page is hard-coded.'}
          </span>
        }
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => void refetch()}>
              <RefreshCcw className="h-3.5 w-3.5" /> Refresh
            </Button>
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

      {!settings.data?.externalBankVerification && (
        <Alert tone="info" title="Automated verification is limited to internal consistency checks">
          {settings.data?.verificationNote ??
            'No bank or AICTE verification service is connected. OCR values are candidates for human review, never proof of authenticity.'}
        </Alert>
      )}

      {isLoading || !data ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, index) => (
            <Skeleton key={index} className="h-24" />
          ))}
        </div>
      ) : (
        <>
          {data.total_records === 0 ? (
            <Card>
              <EmptyState
                icon={<Database className="h-5 w-5" />}
                title="No FDR records yet"
                description={
                  role === 'system_admin'
                    ? 'The registry is empty. Register the first FDR, or load clearly-labelled synthetic demonstration data to explore every module.'
                    : 'No FDR records are visible for your access scope yet. Register a record or ask an AICTE administrator to load demonstration data in a non-production environment.'
                }
                action={
                  <div className="flex flex-wrap justify-center gap-2">
                    {can(role, 'create_fdr') && (
                      <Link to="/fdrs/new">
                        <Button size="sm">
                          <FilePlus2 className="h-4 w-4" /> Register FDR
                        </Button>
                      </Link>
                    )}
                    {role === 'system_admin' && (
                      <Button
                        size="sm"
                        variant="outline"
                        loading={seeding || seedDemo.isPending}
                        onClick={() => {
                          setSeeding(true);
                          seedDemo.mutate(undefined, { onSettled: () => setSeeding(false) });
                        }}
                      >
                        <Sparkles className="h-4 w-4" /> Load demonstration data
                      </Button>
                    )}
                  </div>
                }
              />
            </Card>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <MetricCard
                  label="Total FDR records"
                  value={data.total_records}
                  hint="Live registry entries, excluding archived records"
                  icon={<Database className="h-4 w-4" />}
                  to="/fdrs"
                />
                <MetricCard
                  label="Active deposits"
                  value={data.active}
                  hint="Not yet matured and still marked active"
                  tone="success"
                  icon={<ShieldCheck className="h-4 w-4" />}
                  to="/fdrs"
                />
                <MetricCard
                  label={`Approaching maturity (${warningDays[0]}d)`}
                  value={data.approaching}
                  hint="Inside the configured warning window"
                  tone="warning"
                  icon={<CalendarClock className="h-4 w-4" />}
                  to="/maturity"
                />
                <MetricCard
                  label="Matured — no release application"
                  value={data.matured_no_release}
                  hint="Needs a follow-up or status confirmation, not an automatic penalty"
                  tone="danger"
                  icon={<ShieldAlert className="h-4 w-4" />}
                  to="/maturity?tab=no-release"
                />
                <MetricCard
                  label="Pending verification"
                  value={data.pending_verification}
                  hint="Awaiting officer document review"
                  icon={<FileSearch className="h-4 w-4" />}
                  to="/fdrs?verification=pending"
                />
                <MetricCard
                  label="Records with flags"
                  value={data.flagged_records}
                  hint={`${data.open_flags} unresolved discrepancy flag(s)`}
                  tone="warning"
                  icon={<Flag className="h-4 w-4" />}
                  to="/discrepancies"
                />
                <MetricCard
                  label="Renewals in progress"
                  value={data.renewals_in_progress}
                  hint="Renewal applications not yet closed"
                  tone="info"
                  icon={<RefreshCcw className="h-4 w-4" />}
                  to="/applications?type=renewal"
                />
                <MetricCard
                  label="Release requests in progress"
                  value={data.releases_in_progress}
                  hint={`${data.applications_awaiting_review} awaiting first review`}
                  tone="info"
                  icon={<ClipboardList className="h-4 w-4" />}
                  to="/applications?type=release"
                />
              </div>

              <div className="grid gap-4 lg:grid-cols-5">
                <Card className="lg:col-span-3">
                  <CardHeader>
                    <CardTitle>Maturity outlook</CardTitle>
                    <CardDescription>
                      Distribution of live records by days to maturity, using the policy timezone and configured warning
                      intervals.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="h-64 w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={bucketData} margin={{ top: 4, right: 8, bottom: 4, left: -18 }}>
                          <XAxis dataKey="bucket" tick={{ fontSize: 11 }} interval={0} angle={-15} textAnchor="end" height={48} />
                          <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                          <Tooltip formatter={(value: number) => [`${value} record(s)`, 'FDRs']} />
                          <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                            {bucketData.map((entry) => (
                              <Cell
                                key={entry.bucket}
                                fill={
                                  entry.bucket === 'matured'
                                    ? '#dc2626'
                                    : entry.bucket === 'today'
                                      ? '#f59e0b'
                                      : entry.bucket.includes('day')
                                        ? '#2f5bd0'
                                        : '#94a3b8'
                                }
                              />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </CardContent>
                </Card>

                <Card className="lg:col-span-2">
                  <CardHeader>
                    <CardTitle>Verification status</CardTitle>
                    <CardDescription>Officer-verified means reviewed against the uploaded document — not bank-attested.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="h-64 w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie data={verificationData} dataKey="value" nameKey="name" innerRadius={45} outerRadius={78} paddingAngle={2}>
                            {verificationData.map((entry) => (
                              <Cell key={entry.key} fill={VERIFICATION_COLORS[entry.key] ?? '#94a3b8'} />
                            ))}
                          </Pie>
                          <Tooltip formatter={(value: number, name: string) => [`${value}`, name]} />
                          <Legend wrapperStyle={{ fontSize: 11 }} />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                  </CardContent>
                </Card>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <Card>
                  <CardHeader className="flex-row items-center justify-between">
                    <div>
                      <CardTitle>Matured without a recorded release application</CardTitle>
                      <CardDescription>
                        Follow-up or status confirmation is required. This is not evidence of non-compliance.
                      </CardDescription>
                    </div>
                    <Link to="/maturity?tab=no-release" className="text-xs font-medium text-navy-700 hover:underline">
                      View all
                    </Link>
                  </CardHeader>
                  <CardContent className="p-0">
                    {noRelease.length === 0 ? (
                      <EmptyState
                        icon={<CheckCircle2 className="h-5 w-5" />}
                        title="Nothing outstanding"
                        description="Every matured record has a recorded release application or has been closed."
                      />
                    ) : (
                      <ul className="divide-y divide-slate-100">
                        {noRelease.slice(0, 5).map((record) => {
                          const maturity = classifyMaturity(record, today, warningDays);
                          return (
                            <li key={record.id}>
                              <Link
                                to={`/fdrs/${record.id}`}
                                className="flex items-center justify-between gap-3 px-4 py-3 transition hover:bg-slate-50"
                              >
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-medium text-navy-900">
                                    {record.fdr_reference_number}
                                    {record.is_demo && (
                                      <span className="ml-1.5 rounded bg-amber-100 px-1 py-0.5 text-[9px] font-semibold uppercase text-amber-800">
                                        demo
                                      </span>
                                    )}
                                  </p>
                                  <p className="truncate text-xs text-slate-500">
                                    {record.institutions?.institution_name ?? 'Institution'} · {record.issuing_bank}
                                  </p>
                                </div>
                                <div className="flex flex-shrink-0 items-center gap-2">
                                  <span className="text-xs text-slate-500">
                                    {Math.abs(maturity.daysToMaturity)}d overdue
                                  </span>
                                  <ArrowRight className="h-3.5 w-3.5 text-slate-400" />
                                </div>
                              </Link>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex-row items-center justify-between">
                    <div>
                      <CardTitle>Recently updated records</CardTitle>
                      <CardDescription>Latest registry changes within your access scope.</CardDescription>
                    </div>
                    <Link to="/fdrs" className="text-xs font-medium text-navy-700 hover:underline">
                      Registry
                    </Link>
                  </CardHeader>
                  <CardContent className="p-0">
                    {recent.isLoading ? (
                      <div className="space-y-2 p-4">
                        {Array.from({ length: 4 }).map((_, index) => (
                          <Skeleton key={index} className="h-10" />
                        ))}
                      </div>
                    ) : (recent.data ?? []).length === 0 ? (
                      <EmptyState title="No recent updates" description="Registry changes will appear here." />
                    ) : (
                      <ul className="divide-y divide-slate-100">
                        {(recent.data ?? []).map((record) => (
                          <li key={record.id}>
                            <Link
                              to={`/fdrs/${record.id}`}
                              className="flex items-center justify-between gap-3 px-4 py-3 transition hover:bg-slate-50"
                            >
                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium text-navy-900">{record.fdr_reference_number}</p>
                                <p className="truncate text-xs text-slate-500">
                                  {formatCurrency(record.deposit_amount)} · matures {formatDate(record.maturity_date)}
                                </p>
                              </div>
                              <VerificationBadge status={record.verification_status} />
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </CardContent>
                </Card>
              </div>

              {!isInstitution && (data.institution_breakdown ?? []).length > 0 && (
                <Card>
                  <CardHeader className="flex-row items-center justify-between">
                    <div>
                      <CardTitle>Institution-wise position</CardTitle>
                      <CardDescription>Active, matured and flagged records per institution.</CardDescription>
                    </div>
                    <Link to="/reports?type=institution-wise" className="text-xs font-medium text-navy-700 hover:underline">
                      Full report
                    </Link>
                  </CardHeader>
                  <CardContent className="p-0">
                    <div className="table-shell rounded-none border-0">
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th>Institution</th>
                            <th className="text-right">Active</th>
                            <th className="text-right">Matured</th>
                            <th className="text-right">Flagged</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.institution_breakdown.slice(0, 6).map((row) => (
                            <tr key={row.id}>
                              <td>
                                <p className="font-medium text-navy-900">{row.institution_name}</p>
                                <p className="text-xs text-slate-500">{row.institution_code}</p>
                              </td>
                              <td className="text-right font-medium">{row.active}</td>
                              <td className={cn('text-right font-medium', row.matured > 0 && 'text-amber-700')}>{row.matured}</td>
                              <td className={cn('text-right font-medium', row.flagged > 0 && 'text-red-700')}>{row.flagged}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </>
      )}

      {data && data.total_records > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
          <AlertTriangle className="h-3.5 w-3.5" />
          <span>
            Maturity alerts highlight records for review. They do not assert that an institution has violated any
            requirement, and no funds are released automatically.
          </span>
          {data.unread_notifications > 0 && (
            <Link to="/notifications" className="font-medium text-navy-700 hover:underline">
              {data.unread_notifications} unread notification(s)
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
