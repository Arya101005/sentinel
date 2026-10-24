import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type AuditEvent, type Page } from "../lib/api";
import { formatDateTime } from "../lib/format";
import { Alert, Card, DataTable, Pagination, PageHeader, StatusBadge } from "../components/ui";

export default function Audit() {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState("");
  const [entityType, setEntityType] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [q, setQ] = useState("");
  const [applied, setApplied] = useState({ action: "", entity_type: "", date_from: "", q: "" });

  const qs = new URLSearchParams({ page: String(page), page_size: "15" });
  if (applied.action) qs.set("action", applied.action);
  if (applied.entity_type) qs.set("entity_type", applied.entity_type);
  if (applied.date_from) qs.set("date_from", applied.date_from);
  if (applied.q) qs.set("q", applied.q);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["audit", qs.toString()],
    queryFn: () => api.get<Page<AuditEvent>>(`/audit?${qs.toString()}`),
  });

  return (
    <div>
      <PageHeader
        title="Audit trail"
        subtitle="Append-only record of significant actions. Access is restricted to officers, auditors and administrators."
      />
      <div className="mb-4">
        <Alert tone="info">Audit history is read-only and protected from ordinary modification.</Alert>
      </div>

      <Card className="mb-4 p-3">
        <form
          className="grid gap-3 md:grid-cols-5"
          onSubmit={(e) => {
            e.preventDefault();
            setApplied({ action, entity_type: entityType, date_from: dateFrom, q });
            setPage(1);
          }}
        >
          <input className="input" placeholder="Action (e.g. fdr.created)" value={action} onChange={(e) => setAction(e.target.value)} aria-label="Action" />
          <input className="input" placeholder="Entity type (e.g. fdr)" value={entityType} onChange={(e) => setEntityType(e.target.value)} aria-label="Entity type" />
          <input className="input" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} aria-label="From date" />
          <input className="input" placeholder="Free-text search" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
          <button className="btn-primary" type="submit">Apply</button>
        </form>
      </Card>

      <Card>
        <DataTable
          columns={[
            { header: "Timestamp (UTC)", render: (e: AuditEvent) => <span className="whitespace-nowrap text-xs">{formatDateTime(e.timestamp)}</span> },
            { header: "Actor", render: (e: AuditEvent) => e.actor_name ?? "system" },
            { header: "Action", render: (e: AuditEvent) => <StatusBadge value={e.action.includes("failed") ? "rejected" : "pending"} /> },
            { header: "Action name", render: (e: AuditEvent) => <span className="font-mono text-xs">{e.action}</span> },
            { header: "Entity", render: (e: AuditEvent) => <span className="text-xs">{e.entity_type}{e.entity_id ? ` #${e.entity_id}` : ""}</span> },
            { header: "Reason", render: (e: AuditEvent) => <span className="text-xs text-slate-500">{e.reason ?? "—"}</span> },
          ]}
          rows={data?.items ?? []}
          rowKey={(e) => e.id}
          loading={isLoading}
          error={error ? (error as Error).message : null}
          onRetry={() => refetch()}
          emptyTitle="No audit events match these filters"
        />
        {data && <Pagination page={data.page} pages={data.pages} total={data.total} onPage={setPage} />}
      </Card>
    </div>
  );
}
