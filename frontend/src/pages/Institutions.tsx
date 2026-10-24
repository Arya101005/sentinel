import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Plus, Search } from "lucide-react";
import { api, type Institution, type Page } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Card, DataTable, Pagination, PageHeader, StatusBadge, Modal, Field, useToast } from "../components/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";

export default function Institutions() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ institution_code: "", institution_name: "", region: "", institution_type: "college" });

  const qs = new URLSearchParams({ page: String(page), page_size: "10" });
  if (q) qs.set("q", q);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["institutions", qs.toString()],
    queryFn: () => api.get<Page<Institution>>(`/institutions?${qs.toString()}`),
  });

  const create = useMutation({
    mutationFn: () => api.post<Institution>("/institutions", form),
    onSuccess: () => {
      toast.push("Institution created.", "success");
      setOpen(false);
      setForm({ institution_code: "", institution_name: "", region: "", institution_type: "college" });
      qc.invalidateQueries({ queryKey: ["institutions"] });
    },
    onError: (e: Error) => toast.push(e.message, "error"),
  });

  const isAdmin = user?.role === "admin";

  return (
    <div>
      <PageHeader
        title="Institutions"
        subtitle="Registered institutions and their deposit footprint."
        actions={
          isAdmin && (
            <button className="btn-primary" onClick={() => setOpen(true)}>
              <Plus className="h-4 w-4" /> Add institution
            </button>
          )
        }
      />

      <Card className="mb-4 p-3">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setQ(search);
            setPage(1);
          }}
        >
          <div className="flex gap-2">
            <input
              className="input"
              placeholder="Search institutions…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search institutions"
            />
            <button className="btn-secondary shrink-0" type="submit">
              <Search className="h-4 w-4" />
            </button>
          </div>
        </form>
      </Card>

      <Card>
        <DataTable
          columns={[
            { header: "Code", render: (i: Institution) => <span className="font-mono">{i.institution_code}</span> },
            { header: "Name", render: (i: Institution) => i.institution_name },
            { header: "Type", render: (i: Institution) => i.institution_type },
            { header: "Region", render: (i: Institution) => i.region },
            { header: "Status", render: (i: Institution) => <StatusBadge value={i.status} /> },
          ]}
          rows={data?.items ?? []}
          rowKey={(i) => i.id}
          loading={isLoading}
          error={error ? (error as Error).message : null}
          onRetry={() => refetch()}
          emptyTitle="No institutions found"
          onRowClick={(i) => navigate(`/institutions/${i.id}`)}
        />
        {data && <Pagination page={data.page} pages={data.pages} total={data.total} onPage={setPage} />}
      </Card>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Add institution"
        footer={
          <>
            <button className="btn-secondary" onClick={() => setOpen(false)}>Cancel</button>
            <button
              className="btn-primary"
              disabled={!form.institution_code || !form.institution_name || create.isPending}
              onClick={() => create.mutate()}
            >
              {create.isPending ? "Creating…" : "Create"}
            </button>
          </>
        }
      >
        <Field label="Institution code" hint="Short unique code, e.g. DEMO-X">
          <input className="input" value={form.institution_code} onChange={(e) => setForm({ ...form, institution_code: e.target.value })} />
        </Field>
        <Field label="Institution name">
          <input className="input" value={form.institution_name} onChange={(e) => setForm({ ...form, institution_name: e.target.value })} />
        </Field>
        <Field label="Region">
          <input className="input" value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })} />
        </Field>
        <Field label="Type">
          <input className="input" value={form.institution_type} onChange={(e) => setForm({ ...form, institution_type: e.target.value })} />
        </Field>
      </Modal>
    </div>
  );
}
