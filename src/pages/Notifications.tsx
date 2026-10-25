import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, BellOff, CheckCheck } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSettings } from '@/lib/queries';
import { formatDateTime, humanize } from '@/lib/format';
import type { AppNotification, NotificationCategory } from '@/lib/types';
import { errorMessage } from '@/lib/utils';
import { Alert, Badge, Button, EmptyState, PageHeader, Spinner } from '@/components/ui/primitives';
import { Tabs } from '@/components/ui/data-display';
import { useToast } from '@/components/ui/overlays';

type Filter = 'unread' | 'all';

const CATEGORY_TONE: Record<NotificationCategory, 'danger' | 'warning' | 'info' | 'success' | 'neutral'> = {
  maturity_upcoming: 'warning',
  maturity_today: 'warning',
  matured_no_application: 'danger',
  discrepancy: 'danger',
  missing_document: 'warning',
  renewal_deadline: 'warning',
  application_status: 'info',
  verification: 'success',
};

export default function NotificationsPage() {
  const queryClient = useQueryClient();
  const { push } = useToast();
  const settings = useSettings();
  const [filter, setFilter] = useState<Filter>('unread');
  const [category, setCategory] = useState<'' | NotificationCategory>('');

  const query = useQuery({
    queryKey: ['notifications', filter, category],
    queryFn: async (): Promise<AppNotification[]> => {
      let request = supabase
        .from('notifications')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(300);
      if (filter === 'unread') request = request.eq('is_read', false);
      if (category) request = request.eq('category', category);
      const { data, error } = await request;
      if (error) throw new Error(error.message);
      return (data ?? []) as AppNotification[];
    },
  });

  const unreadIds = useMemo(
    () => (query.data ?? []).filter((notification) => !notification.is_read).map((notification) => notification.id),
    [query.data],
  );

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['notifications'] }),
      queryClient.invalidateQueries({ queryKey: ['notifications-unread'] }),
      queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] }),
    ]);
  };

  const markRead = useMutation({
    mutationFn: async (ids: string[]) => {
      const { error } = await supabase.from('notifications').update({ is_read: true }).in('id', ids);
      if (error) throw new Error(error.message);
    },
    onSuccess: invalidate,
    onError: (error) => push({ title: 'Could not update notifications', description: errorMessage(error), tone: 'error' }),
  });

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Module G"
        title="Notifications"
        description="In-app alerts for maturity, missing documents, discrepancies and workflow changes. Alerts are de-duplicated per event so repeated scans do not create duplicates."
        actions={
          unreadIds.length > 0 ? (
            <Button variant="outline" size="sm" loading={markRead.isPending} onClick={() => markRead.mutate(unreadIds)}>
              <CheckCheck className="h-3.5 w-3.5" /> Mark all read
            </Button>
          ) : undefined
        }
      />

      {!settings.data?.emailEnabled && (
        <Alert tone="info" title="Email delivery is not configured">
          Only in-app notifications are produced. No email is sent and this application will never claim an email was
          delivered. Configure a provider server-side to add email delivery.
        </Alert>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Tabs<Filter>
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'unread', label: 'Unread' },
            { value: 'all', label: 'All' },
          ]}
        />
        <select
          aria-label="Filter notifications by category"
          className="h-9 rounded-md border border-input bg-white px-2.5 text-xs text-slate-700"
          value={category}
          onChange={(event) => setCategory(event.target.value as '' | NotificationCategory)}
        >
          <option value="">All categories</option>
          {Object.keys(CATEGORY_TONE).map((key) => (
            <option key={key} value={key}>
              {humanize(key)}
            </option>
          ))}
        </select>
      </div>

      {query.error && (
        <Alert tone="danger" title="Notifications could not be loaded">
          {errorMessage(query.error)}
        </Alert>
      )}

      {query.isLoading ? (
        <Spinner label="Loading notifications…" />
      ) : (query.data ?? []).length === 0 ? (
        <EmptyState
          icon={filter === 'unread' ? <BellOff className="h-5 w-5" /> : <Bell className="h-5 w-5" />}
          title={filter === 'unread' ? 'You are all caught up' : 'No notifications yet'}
          description="Maturity alerts are generated by the daily monitoring scan. You can also run it from the Maturity Monitor."
        />
      ) : (
        <ul className="space-y-2">
          {(query.data ?? []).map((notification) => (
            <li
              key={notification.id}
              className={`rounded-lg border bg-white p-3.5 ${notification.is_read ? 'border-slate-200' : 'border-navy-200 shadow-sm'}`}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge tone={CATEGORY_TONE[notification.category]}>{humanize(notification.category)}</Badge>
                    {!notification.is_read && <Badge tone="info">unread</Badge>}
                    <span className="text-[11px] text-slate-500">{formatDateTime(notification.created_at)}</span>
                  </div>
                  <p className="mt-1.5 text-sm font-semibold text-navy-900">{notification.title}</p>
                  {notification.body && <p className="mt-0.5 text-sm leading-relaxed text-slate-600">{notification.body}</p>}
                </div>
                <div className="flex items-center gap-1.5">
                  {notification.link && (
                    <Link to={notification.link}>
                      <Button variant="outline" size="sm">
                        Open record
                      </Button>
                    </Link>
                  )}
                  {!notification.is_read && (
                    <Button
                      variant="ghost"
                      size="sm"
                      loading={markRead.isPending}
                      onClick={() => markRead.mutate([notification.id])}
                    >
                      Mark read
                    </Button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
