import { useEffect, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { ArrowLeft, Save } from "lucide-react";
import { api, type Fdr, type Institution, type Page } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Alert, Card, ErrorState, Field, PageHeader, Spinner, useToast } from "../components/ui";

const schema = z
  .object({
    institution_id: z.coerce.number().int().positive("Select an institution"),
    fdr_reference_number: z.string().min(3, "At least 3 characters").max(64),
    bank_name: z.string().min(2, "Bank is required"),
    branch_name: z.string().optional().nullable(),
    deposit_amount: z.coerce.number().positive("Amount must be greater than zero"),
    currency: z.string().default("INR"),
    issue_date: z.string().optional().nullable(),
    maturity_date: z.string().optional().nullable(),
    lifecycle_status: z.string().optional(),
    eligibility_notes: z.string().optional().nullable(),
    remarks: z.string().optional().nullable(),
  })
  .refine((d) => !d.issue_date || !d.maturity_date || d.issue_date <= d.maturity_date, {
    message: "Issue date cannot be after the maturity date",
    path: ["maturity_date"],
  });

type FormValues = z.infer<typeof schema>;

export default function FdrForm() {
  const { id } = useParams();
  const editing = Boolean(id);
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const { user } = useAuth();

  const existing = useQuery({
    queryKey: ["fdr", id],
    queryFn: () => api.get<Fdr>(`/fdr-records/${id}`),
    enabled: editing,
  });

  const institutions = useQuery({
    queryKey: ["institutions-all"],
    queryFn: () => api.get<Page<Institution>>("/institutions?page_size=200"),
  });
  const banks = useQuery({
    queryKey: ["banks"],
    queryFn: () => api.get<string[]>("/fdr-records/meta/banks"),
  });

  const defaultInstitution = user?.institution_id ?? 0;

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      institution_id: defaultInstitution || undefined,
      currency: "INR",
      lifecycle_status: "active",
    } as Partial<FormValues> as FormValues,
  });

  useEffect(() => {
    if (existing.data) {
      reset({
        institution_id: existing.data.institution_id,
        fdr_reference_number: existing.data.fdr_reference_number,
        bank_name: existing.data.bank_name,
        branch_name: existing.data.branch_name ?? "",
        deposit_amount: Number(existing.data.deposit_amount),
        currency: existing.data.currency,
        issue_date: existing.data.issue_date ?? "",
        maturity_date: existing.data.maturity_date ?? "",
        lifecycle_status: existing.data.lifecycle_status,
        eligibility_notes: existing.data.eligibility_notes ?? "",
        remarks: existing.data.remarks ?? "",
      } as FormValues);
    }
  }, [existing.data, reset]);

  const save = useMutation({
    mutationFn: (values: FormValues) => {
      const payload = {
        ...values,
        deposit_amount: Number(values.deposit_amount),
        issue_date: values.issue_date || null,
        maturity_date: values.maturity_date || null,
      };
      return editing
        ? api.patch<Fdr>(`/fdr-records/${id}`, payload)
        : api.post<Fdr>("/fdr-records", payload);
    },
    onSuccess: (rec) => {
      toast.push(editing ? "Record updated." : "FDR record created.", "success");
      qc.invalidateQueries({ queryKey: ["fdrs"] });
      qc.invalidateQueries({ queryKey: ["dashboard-summary"] });
      navigate(`/fdrs/${rec.id}`);
    },
    onError: (e: Error) => toast.push(e.message, "error"),
  });

  const isInst = user?.role === "institution";
  const instOptions = useMemo(() => institutions.data?.items ?? [], [institutions.data]);

  if (editing && existing.isLoading) return <Spinner label="Loading record…" />;
  if (editing && existing.error)
    return <ErrorState message={(existing.error as Error).message} onRetry={() => existing.refetch()} />;

  return (
    <div className="max-w-3xl">
      <button className="mb-3 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700" onClick={() => navigate(-1)}>
        <ArrowLeft className="h-4 w-4" /> Back
      </button>
      <PageHeader
        title={editing ? "Edit FDR record" : "Add FDR record"}
        subtitle={isInst ? "Records are created for your own institution." : undefined}
      />

      <Card className="p-5">
        <form onSubmit={handleSubmit((v) => save.mutate(v))} noValidate>
          <div className="grid gap-x-4 sm:grid-cols-2">
            <Field label="Institution" error={errors.institution_id?.message}>
              {isInst ? (
                <input className="input bg-slate-50" disabled value={user?.institution_name ?? ""} {...register("institution_id")} />
              ) : (
                <select className="input" {...register("institution_id")}>
                  <option value="">Select institution…</option>
                  {instOptions.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.institution_name}
                    </option>
                  ))}
                </select>
              )}
            </Field>

            <Field label="FDR reference number" error={errors.fdr_reference_number?.message}>
              <input className="input" placeholder="SBI/AIC/2023/0417" {...register("fdr_reference_number")} />
            </Field>

            <Field label="Bank" error={errors.bank_name?.message}>
              <input className="input" list="bank-list" placeholder="State Bank of India" {...register("bank_name")} />
              <datalist id="bank-list">
                {(banks.data ?? []).map((b) => (
                  <option key={b} value={b} />
                ))}
              </datalist>
            </Field>

            <Field label="Branch" error={errors.branch_name?.message}>
              <input className="input" {...register("branch_name")} />
            </Field>

            <Field label="Deposit amount (INR)" error={errors.deposit_amount?.message}>
              <input className="input" type="number" step="0.01" min="0" {...register("deposit_amount")} />
            </Field>

            <Field label="Currency" error={errors.currency?.message}>
              <select className="input" {...register("currency")}>
                <option>INR</option>
                <option>USD</option>
                <option>EUR</option>
                <option>GBP</option>
              </select>
            </Field>

            <Field label="Issue date" error={errors.issue_date?.message}>
              <input className="input" type="date" {...register("issue_date")} />
            </Field>

            <Field
              label="Maturity date"
              error={errors.maturity_date?.message}
              hint="Maturity does not by itself imply release eligibility."
            >
              <input className="input" type="date" {...register("maturity_date")} />
            </Field>

            <Field label="Lifecycle status" error={errors.lifecycle_status?.message}>
              <select className="input" {...register("lifecycle_status")}>
                {["active", "matured", "on_hold", "renewed", "replaced", "released", "archived"].map((s) => (
                  <option key={s} value={s}>
                    {s.replace("_", " ")}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <Field label="Eligibility / hold notes" error={errors.eligibility_notes?.message} hint="Recorded hold or eligibility context; never treated as automatic approval.">
            <textarea className="input" rows={2} {...register("eligibility_notes")} />
          </Field>
          <Field label="Remarks" error={errors.remarks?.message}>
            <textarea className="input" rows={2} {...register("remarks")} />
          </Field>

          {save.error && <div className="mb-3"><Alert tone="error">{(save.error as Error).message}</Alert></div>}

          <div className="flex justify-end gap-2 border-t border-slate-200 pt-4">
            <button type="button" className="btn-secondary" onClick={() => navigate(-1)}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={save.isPending}>
              <Save className="h-4 w-4" /> {save.isPending ? "Saving…" : editing ? "Save changes" : "Create FDR"}
            </button>
          </div>
        </form>
      </Card>
    </div>
  );
}
