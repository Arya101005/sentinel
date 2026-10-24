import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { api, type Institution, type Page, type User } from "../lib/api";
import { ROLE_LABELS, useAuth } from "../lib/auth";
import { formatDateTime } from "../lib/format";
import {
  Card,
  DataTable,
  Field,
  Modal,
  PageHeader,
  StatusBadge,
  useToast,
} from "../components/ui";

const ROLES = ["admin", "officer", "institution", "auditor"];

export default function Users() {
  const toast = useToast();
  const qc = useQueryClient();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    display_name: "",
    email: "",
    username: "",
    role: "institution",
    institution_id: "",
    password: "",
  });

  const users = useQuery({
    queryKey: ["users"],
    queryFn: () => api.get<Page<User>>("/users?page_size=200"),
  });
  const institutions = useQuery({
    queryKey: ["institutions-all"],
    queryFn: () => api.get<Page<Institution>>("/institutions?page_size=200"),
    enabled: open,
  });

  const create = useMutation({
    mutationFn: () =>
      api.post<User>("/users", {
        display_name: form.display_name,
        email: form.email,
        username: form.username,
        role: form.role,
        password: form.password,
        institution_id: form.role === "institution" && form.institution_id ? Number(form.institution_id) : null,
      }),
    onSuccess: () => {
      toast.push("User created.", "success");
      setOpen(false);
      setForm({ display_name: "", email: "", username: "", role: "institution", institution_id: "", password: "" });
      qc.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (e: Error) => toast.push(e.message, "error"),
  });

  const toggleActive = useMutation({
    mutationFn: (u: User) => api.patch<User>(`/users/${u.id}`, { is_active: !u.is_active }),
    onSuccess: () => {
      toast.push("User updated.", "success");
      qc.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (e: Error) => toast.push(e.message, "error"),
  });

  return (
    <div>
      <PageHeader
        title="User management"
        subtitle="Manage accounts, roles and institution assignments."
        actions={
          isAdmin && (
            <button className="btn-primary" onClick={() => setOpen(true)}>
              <Plus className="h-4 w-4" /> Add user
            </button>
          )
        }
      />

      <Card>
        <DataTable
          columns={[
            { header: "Name", render: (u: User) => u.display_name },
            { header: "Username", render: (u: User) => <span className="font-mono text-xs">{u.username ?? "—"}</span> },
            { header: "Email", render: (u: User) => u.email },
            { header: "Role", render: (u: User) => <StatusBadge value={u.role === "admin" ? "high" : u.role === "officer" ? "pending" : "cleared"} /> },
            { header: "Role name", render: (u: User) => ROLE_LABELS[u.role] ?? u.role },
            { header: "Institution", render: (u: User) => u.institution_name ?? <span className="text-slate-400">—</span> },
            { header: "Status", render: (u: User) => <StatusBadge value={u.is_active ? "verified" : "rejected"} /> },
            {
              header: "Actions",
              render: (u: User) =>
                isAdmin ? (
                  <button className="btn-secondary !px-2 !py-1 text-xs" onClick={() => toggleActive.mutate(u)} disabled={toggleActive.isPending || u.id === user?.id}>
                    {u.is_active ? "Deactivate" : "Activate"}
                  </button>
                ) : (
                  <span className="text-xs text-slate-400">read-only</span>
                ),
            },
          ]}
          rows={users.data?.items ?? []}
          rowKey={(u) => u.id}
          loading={users.isLoading}
          error={users.error ? (users.error as Error).message : null}
          onRetry={() => users.refetch()}
          emptyTitle="No users found"
        />
      </Card>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Add user"
        footer={
          <>
            <button className="btn-secondary" onClick={() => setOpen(false)}>Cancel</button>
            <button
              className="btn-primary"
              disabled={!form.display_name || !form.email || !form.username || form.password.length < 8 || create.isPending}
              onClick={() => create.mutate()}
            >
              {create.isPending ? "Creating…" : "Create user"}
            </button>
          </>
        }
      >
        <Field label="Display name">
          <input className="input" value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} />
        </Field>
        <Field label="Username">
          <input className="input" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
        </Field>
        <Field label="Email">
          <input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </Field>
        <Field label="Role">
          <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            {ROLES.map((r) => (
              <option key={r} value={r}>{ROLE_LABELS[r]}</option>
            ))}
          </select>
        </Field>
        {form.role === "institution" && (
          <Field label="Institution">
            <select className="input" value={form.institution_id} onChange={(e) => setForm({ ...form, institution_id: e.target.value })}>
              <option value="">Select…</option>
              {(institutions.data?.items ?? []).map((i) => (
                <option key={i.id} value={i.id}>{i.institution_name}</option>
              ))}
            </select>
          </Field>
        )}
        <Field label="Temporary password" hint="Minimum 8 characters. Stored only as a salted PBKDF2 hash.">
          <input className="input" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        </Field>
        <p className="text-xs text-slate-400">Created {formatDateTime(new Date().toISOString())} · never hardcode real credentials.</p>
      </Modal>
    </div>
  );
}
