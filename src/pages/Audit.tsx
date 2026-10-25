import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Lock, ScrollText, Search } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { formatDateTime, humanize } from '@/lib/format';
import type { AuditEvent } from '@/lib/types';
import { errorMessage } from '@/lib/utils';
import {
  Alert,
  Badge,
  Button,
  Input,
  PageHeader,
  Select,
  Spinner,
  EmptyState,
} from '@/components/ui/primitives';
import { Pagination } from '@/components/ui/data-display';

const PAGE_SIZE = 25;
const ENTITY_TYPES = [
  'fdr_records',
  'fdr_documents',
  'discrepancy_flags',
  'release_applications',
  'profiles',
  'institutions',
  'system_settings',
  'verification_events',
];

export default function AuditPage() {
  const { role } = useAuth();
  const [search, setSearch] = useState('');
  const [entity, setEntity] = useState('');
  const [page, setPage] = useState(1);

  const query = useQuery({
    queryKey: ['audit-events', search, entity, page],
    queryFn: async (): Promise<{ rows: AuditEvent[]; count: number }> => {
      const from = (page - 1) * PAGE_SIZE;
      let request = supabase
        .from('audit_events')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(from, from + PAGE_SIZE - 1);
      if (entity) request = request.eq('entity_type', entity);
      if (search.trim()) {
        const term = search.trim().replace(/[(),*]/g, ' ');
        request = request.or(`action.ilike.%${term}%,summary.ilike.%${term}%,actor_email.ilike.%${term}%`);
      }
      const { data, error, count } = await request;
      if (error) throw new Error(error.message);
      return { rows: (data ?? []) as AuditEvent[], count: count ?? 0 };
    },
  });

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Module H"
        title="Audit trail"
        description="Append-only record of registry changes, document events, verification decisions, workflow transitions, role changes and report exports. Ordinary users cannot rewrite or delete audit events."
        actions={
          <Badge tone="outline" className="gap-1">
            <Lock className="h-3 w-3" /> append-only
          </Badge>
        }
      />

      <Alert tone="info" title="Who can read the audit trail">
        Administrators, officers and auditors see the full trail. Institution users see only events they personally
        triggered. Audit writes happen through database triggers and SECURITY DEFINER functions — the browser has no insert
        or delete permission on this table.
      </Alert>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[240px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
          <Input
            aria-label="Search audit events"
            className="pl-9"
            placeholder="Search action, summary or actor email…"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
          />
        </div>
        <Select
          aria-label="Filter by entity type"
          className="w-[220px]"
          value={entity}
          onChange={(event) => {
            setEntity(event.target.value);
            setPage(1);
          }}
        >
          <option value="">All entity types</option>
          {ENTITY_TYPES.map((type) => (
            <option key={type} value={type}>
              {humanize(type)}
            </option>
          ))}
        </Select>
        {(search || entity) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSearch('');
              setEntity('');
              setPage(1);
            }}
          >
            Clear
          </Button>
        )}
      </div>

      {query.error && (
        <Alert tone="danger" title="Audit events could not be loaded">
          {errorMessage(query.error)}
        </Alert>
      )}

      <div className="table-shell">
        {query.isLoading ? (
          <Spinner label="Loading audit trail…" />
        ) : (query.data?.rows ?? []).length === 0 ? (
          <EmptyState icon={<ScrollText className="h-5 w-5" />} title="No audit events" description="Events will appear as records are created and reviewed." />
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Actor</th>
                <th>Action</th>
                <th>Entity</th>
                <th>Summary</th>
              </tr>
            </thead>
            <tbody>
              {(query.data?.rows ?? []).map((event) => (
                <tr key={event.id}>
                  <td className="whitespace-nowrap text-[11px] text-slate-500">{formatDateTime(event.created_at)}</td>
                  <td>
                    <p className="max-w-[160px] truncate text-xs font-medium text-slate-800">
                      {event.actor_email ?? 'System / service'}
                    </p>
                    <p className="text-[10px] text-slate-500">{event.actor_role ? humanize(event.actor_role) : '—'}</p>
                  </td>
                  <td>
                    <code className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-700">{event.action}</code>
                  </td>
                  <td className="text-[11px] text-slate-600">
                    {humanize(event.entity_type)}
                    {event.entity_id && <span className="block max-w-[140px] truncate text-[10px] text-slate-400">{event.entity_id}</span>}
                  </td>
                  <td>
                    <p className="max-w-[320px] text-xs leading-relaxed text-slate-700">{event.summary}</p>
                    {event.metadata && Object.keys(event.metadata).length > 0 && (
                      <details className="mt-1">
                        <summary className="cursor-pointer text-[10px] text-slate-400">metadata</summary>
                        <pre className="mt-1 max-w-[340px] overflow-auto whitespace-pre-wrap break-words rounded bg-slate-50 p-1.5 text-[10px] text-slate-600">
                          {JSON.stringify(event.metadata, null, 2)}
                        </pre>
                      </details>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {!query.isLoading && (query.data?.count ?? 0) > 0 && (
        <Pagination page={page} pageSize={PAGE_SIZE} total={query.data?.count ?? 0} onPageChange={setPage} />
      )}

      {role === 'institution_user' && (
        <p className="text-[11px] text-slate-500">Your view is limited to events you triggered yourself.</p>
      )}
    </div>
  );
}
