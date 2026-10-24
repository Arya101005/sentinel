import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Notification, type Page } from "../lib/api";
import { formatDateTime, labelize } from "../lib/format";
import { Alert, Badge, Card, DataTable, Pagination, PageHeader, StatusBadge, useToast } from "../components/ui";

interface Pref {
  id: number;
  event_type: string;
  enabled: boolean;
  channel: string;
}

export default function Notifications() {
  const toast = useToast();
  const qc = useQueryClient();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [page, setPage] = useState(1);

  const qs = new URLSearchParams({ page: String(page), page_size: "10" });
  if (unreadOnly) qs.set("unread_only", "true");

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["notifications", qs.toString()],
    queryFn: () => api.get<Page<Notification>>(`/notifications?${qs.toString()}`),
  });
  const meta = useQuery({
    queryKey: ["notif-meta"],
    queryFn: () => api.get<{ unread: number; email_configured: boolean; email_delivery_note?: string }>("/notifications/unread-count"),
  });
  const prefs = useQuery({
    queryKey: ["notif-prefs"],
    queryFn: () => api.get<Pref[]>("/notifications/preferences"),
  });

  const markRead = useMutation({
    mutationFn: (nid: number) => api.post<Notification>(`/notifications/${nid}/read`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications"] });
      qc.invalidateQueries({ queryKey: ["notif-meta"] });
    },
    onError: (e: Error) => toast.push(e.message, "error"),
  });

  const markAll = useMutation({
    mutationFn: () => api.post("/notifications/read-all"),
    onSuccess: () => {
      toast.push("All notifications marked as read.", "success");
      qc.invalidateQueries({ queryKey: ["notifications"] });
      qc.invalidateQueries({ queryKey: ["notif-meta"] });
    },
    onError: (e: Error) => toast.push(e.message, "error"),
  });

  const togglePref = useMutation({
    mutationFn: (p: Pref) => api.put("/notifications/preferences", { event_type: p.event_type, enabled: !p.enabled, channel: p.channel }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notif-prefs"] }),
    onError: (e: Error) => toast.push(e.message, "error"),
  });

  return (
    <div>
      <PageHeader
        title="Notification centre"
        subtitle="In-app notifications for maturity, non-applicant, discrepancy and workflow events."
        actions={
          <button className="btn-secondary" onClick={() => markAll.mutate()} disabled={markAll.isPending || !(meta.data?.unread)}>
            Mark all read
          </button>
        }
      />

      {!meta.data?.email_configured && meta.data?.email_delivery_note && (
        <div className="mb-4">
          <Alert tone="info">{meta.data.email_delivery_note}</Alert>
        </div>
      )}

      <Card className="mb-4 p-3">
        <div className="flex items-center gap-3">
          <label className="inline-flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={unreadOnly} onChange={(e) => { setUnreadOnly(e.target.checked); setPage(1); }} />
            Unread only
          </label>
          <span className="text-sm text-slate-500">{meta.data?.unread ?? 0} unread</span>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <DataTable
            columns={[
              {
                header: "Notification",
                render: (n: Notification) => (
                  <div>
                    <p className={`text-sm ${n.read_at ? "text-slate-500" : "font-medium text-slate-800"}`}>{n.title}</p>
                    <p className="mt-0.5 text-xs text-slate-500">{n.message}</p>
                  </div>
                ),
              },
              { header: "Type", render: (n: Notification) => <Badge>{labelize(n.notification_type)}</Badge> },
              { header: "Delivery", render: (n: Notification) => <StatusBadge value={n.delivery_status} /> },
              { header: "Received", render: (n: Notification) => formatDateTime(n.sent_at ?? n.created_at) },
              {
                header: "",
                render: (n: Notification) =>
                  n.read_at ? (
                    <span className="text-xs text-slate-400">Read</span>
                  ) : (
                    <button className="btn-secondary !px-2 !py-1 text-xs" onClick={() => markRead.mutate(n.id)} disabled={markRead.isPending}>
                      Mark read
                    </button>
                  ),
              },
            ]}
            rows={data?.items ?? []}
            rowKey={(n) => n.id}
            loading={isLoading}
            error={error ? (error as Error).message : null}
            onRetry={() => refetch()}
            emptyTitle={unreadOnly ? "No unread notifications" : "No notifications yet"}
            emptyHint="Notifications are generated by the maturity monitoring job and workflow events."
          />
          {data && <Pagination page={data.page} pages={data.pages} total={data.total} onPage={setPage} />}
        </Card>

        <Card>
          <div className="border-b border-slate-200 px-4 py-3">
            <h2 className="text-sm font-semibold text-slate-800">Preferences</h2>
          </div>
          <div className="p-4">
            {(prefs.data ?? []).length ? (
              <ul className="space-y-2">
                {prefs.data!.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-2">
                    <span className="text-sm text-slate-700">{labelize(p.event_type)}</span>
                    <button
                      className={`btn !px-2 !py-1 text-xs ${p.enabled ? "bg-teal-600 text-white" : "bg-slate-200 text-slate-600"}`}
                      onClick={() => togglePref.mutate(p)}
                      disabled={togglePref.isPending}
                    >
                      {p.enabled ? "On" : "Off"}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-400">No preferences configured for your account.</p>
            )}
            <p className="mt-3 text-xs text-slate-400">
              Duplicate alerts are suppressed server-side; running the monitoring job repeatedly will not create repeat
              notifications for the same event.
            </p>
          </div>
        </Card>
      </div>
    </div>
  );
}
