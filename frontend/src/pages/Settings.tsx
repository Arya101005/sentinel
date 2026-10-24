import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { formatDateTime, labelize } from "../lib/format";
import { Alert, Card, PageHeader, Spinner, ErrorState, useToast } from "../components/ui";

interface Setting {
  key: string;
  value: unknown;
  description?: string | null;
  updated_at?: string | null;
}

function toInput(value: unknown): string {
  if (Array.isArray(value)) return value.join(", ");
  if (value === null || value === undefined) return "";
  return String(value);
}
function parseValue(raw: string, original: unknown): unknown {
  if (Array.isArray(original)) return raw.split(",").map((s) => s.trim()).filter(Boolean).map((s) => (Number.isNaN(Number(s)) ? s : Number(s)));
  if (typeof original === "number") return Number(raw);
  if (typeof original === "boolean") return raw === "true" || raw === "1";
  return raw;
}

export default function Settings() {
  const toast = useToast();
  const qc = useQueryClient();
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const settings = useQuery({
    queryKey: ["settings"],
    queryFn: () => api.get<Setting[]>("/settings"),
  });

  useEffect(() => {
    if (settings.data) {
      const d: Record<string, string> = {};
      settings.data.forEach((s) => (d[s.key] = toInput(s.value)));
      setDrafts(d);
    }
  }, [settings.data]);

  const save = useMutation({
    mutationFn: (s: Setting) =>
      api.put<Setting>(`/settings/${s.key}`, { key: s.key, value: parseValue(drafts[s.key] ?? "", s.value) }),
    onSuccess: (_res, s) => {
      toast.push(`Setting "${labelize(s.key)}" updated.`, "success");
      qc.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (e: Error) => toast.push(e.message, "error"),
  });

  return (
    <div>
      <PageHeader
        title="System settings"
        subtitle="Configurable monitoring thresholds and limits used across the platform."
      />
      <div className="mb-4">
        <Alert tone="warn">
          Changing thresholds affects maturity alerts, escalation and overdue detection. Values are demonstration defaults
          unless changed — they are not AICTE-mandated intervals.
        </Alert>
      </div>

      {settings.isLoading && <Spinner label="Loading settings…" />}
      {settings.error && <ErrorState message={(settings.error as Error).message} onRetry={() => settings.refetch()} />}

      <div className="space-y-3">
        {(settings.data ?? []).map((s) => (
          <Card key={s.key} className="p-4">
            <div className="grid gap-3 md:grid-cols-3">
              <div>
                <p className="text-sm font-medium text-slate-800">{labelize(s.key)}</p>
                <p className="text-xs text-slate-500">{s.description}</p>
                {s.updated_at && <p className="mt-1 text-xs text-slate-400">Updated {formatDateTime(s.updated_at)}</p>}
              </div>
              <div className="md:col-span-2 flex flex-wrap items-end gap-2">
                <div className="min-w-48 flex-1">
                  <span className="label">Value {Array.isArray(s.value) ? "(comma-separated)" : `(${typeof s.value})`}</span>
                  <input
                    className="input"
                    value={drafts[s.key] ?? ""}
                    onChange={(e) => setDrafts({ ...drafts, [s.key]: e.target.value })}
                    aria-label={s.key}
                  />
                </div>
                <button
                  className="btn-primary"
                  disabled={save.isPending && save.variables?.key === s.key}
                  onClick={() => save.mutate(s)}
                >
                  {save.isPending && save.variables?.key === s.key ? "Saving…" : "Save"}
                </button>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
