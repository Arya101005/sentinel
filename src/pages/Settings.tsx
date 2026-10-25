import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, BellRing, CheckCircle2, Database, Play, RefreshCcw, Settings2, Trash2, XCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { api, type Diagnostics, type SetupStatus } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useSettings } from '@/lib/queries';
import { warningDaysSchema } from '@/lib/validation';
import { formatDateTime } from '@/lib/format';
import { errorMessage } from '@/lib/utils';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
  Input,
  PageHeader,
  Spinner,
} from '@/components/ui/primitives';
import { Dialog, useToast } from '@/components/ui/overlays';

export default function SettingsPage() {
  const { profile } = useAuth();
  const settings = useSettings();
  const queryClient = useQueryClient();
  const { push } = useToast();
  const [warnings, setWarnings] = useState('30, 15, 7');
  const [warningsError, setWarningsError] = useState<string | null>(null);
  const [allowSelf, setAllowSelf] = useState(false);
  const [events, setEvents] = useState({
    maturity_upcoming: true,
    maturity_today: true,
    matured_no_application: true,
  });
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [scanResult, setScanResult] = useState<Record<string, number> | null>(null);
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null);
  const [setup, setSetup] = useState<SetupStatus | null>(null);
  const [diagnosticsError, setDiagnosticsError] = useState<string | null>(null);

  useEffect(() => {
    if (settings.data) {
      setWarnings(settings.data.warningDays.join(', '));
      setAllowSelf(settings.data.allowSelfApproval);
      setEvents(settings.data.notificationEvents);
    }
  }, [settings.data]);

  const saveSetting = useMutation({
    mutationFn: async (input: { key: string; value: unknown }) => {
      const { error } = await supabase
        .from('system_settings')
        .update({ value: input.value, updated_by: profile?.id ?? null })
        .eq('key', input.key);
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['system-settings'] });
      await queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] });
      push({ title: 'Setting saved', description: 'The change is recorded in the audit trail.', tone: 'success' });
    },
    onError: (error) => push({ title: 'Could not save setting', description: errorMessage(error), tone: 'error' }),
  });

  const seed = useMutation({
    mutationFn: () => api.seedDemoData(),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries();
      push({
        title: 'Demonstration data loaded',
        description: Object.entries(result.counts)
          .map(([key, value]) => `${value} ${key.replace(/_/g, ' ')}`)
          .join(', '),
        tone: 'success',
      });
    },
    onError: (error) => push({ title: 'Could not load demo data', description: errorMessage(error), tone: 'error' }),
  });

  const removeDemo = useMutation({
    mutationFn: () => api.removeDemoData(),
    onSuccess: async (result) => {
      setConfirmRemove(false);
      await queryClient.invalidateQueries();
      push({
        title: 'Demonstration data removed',
        description: `${result.removed.fdr_records ?? 0} synthetic FDRs and ${result.removed.institutions ?? 0} synthetic institutions were deleted.`,
        tone: 'success',
      });
    },
    onError: (error) => push({ title: 'Could not remove demo data', description: errorMessage(error), tone: 'error' }),
  });

  const scan = useMutation({
    mutationFn: () => api.runMaturityScan(),
    onSuccess: async (result) => {
      setScanResult(result.summary);
      await queryClient.invalidateQueries();
      push({ title: 'Monitoring scan completed', description: 'Notifications were generated idempotently.', tone: 'success' });
    },
    onError: (error) => push({ title: 'Scan failed', description: errorMessage(error), tone: 'error' }),
  });

  const loadDiagnostics = async () => {
    setDiagnosticsError(null);
    try {
      const [diagnosticResult, setupResult] = await Promise.all([api.diagnostics(), api.setupStatus()]);
      setDiagnostics(diagnosticResult);
      setSetup(setupResult);
    } catch (error) {
      setDiagnosticsError(errorMessage(error));
    }
  };

  const saveWarnings = () => {
    const parsed = warningDaysSchema.safeParse(
      warnings
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => Number(part)),
    );
    if (!parsed.success) {
      setWarningsError(parsed.error.issues[0]?.message ?? 'Enter comma-separated day counts.');
      return;
    }
    setWarningsError(null);
    saveSetting.mutate({ key: 'maturity_warning_days', value: parsed.data });
  };

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Administration"
        title="System settings"
        description="Configuration that changes monitoring behaviour. Every change is written to the append-only audit trail with your account and timestamp."
      />

      {settings.isLoading ? (
        <Spinner label="Loading settings…" />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Settings2 className="h-4 w-4 text-slate-500" /> Maturity warning intervals
              </CardTitle>
              <CardDescription>
                Days before maturity that enter the warning window. Used by the dashboard, maturity queues and the
                notification scan. The policy timezone is {settings.data?.timezone}.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Field
                label="Warning days (comma separated)"
                htmlFor="warning-days"
                error={warningsError ?? undefined}
                hint="Example: 30, 15, 7. Up to five unique values, 1–365."
              >
                <Input
                  id="warning-days"
                  value={warnings}
                  onChange={(event) => setWarnings(event.target.value)}
                  placeholder="30, 15, 7"
                />
              </Field>
              <Button size="sm" loading={saveSetting.isPending} onClick={saveWarnings}>
                Save intervals
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Notification channels</CardTitle>
              <CardDescription>
                In-app notifications are always enabled and stored per recipient. Email requires a configured provider and
                server-side delivery logic.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2">
                <div>
                  <p className="font-medium text-slate-800">In-app notifications</p>
                  <p className="text-xs text-slate-500">Stored in the database with read/unread state.</p>
                </div>
                <Badge tone="success">Enabled</Badge>
              </div>
              <div className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2">
                <div>
                  <p className="font-medium text-slate-800">Email delivery</p>
                  <p className="text-xs text-slate-500">
                    {settings.data?.emailEnabled
                      ? 'A provider is configured.'
                      : 'No email provider is configured, so no email is sent or claimed.'}
                  </p>
                </div>
                <Badge tone={settings.data?.emailEnabled ? 'success' : 'neutral'}>
                  {settings.data?.emailEnabled ? 'Configured' : 'Not configured'}
                </Badge>
              </div>
              <p className="text-[11px] leading-relaxed text-slate-500">
                To enable email, add an authorised transactional provider and its server-side credentials, then implement the
                send step in the scheduled scan function. The in-app channel works regardless.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BellRing className="h-4 w-4 text-slate-500" /> Notification events
              </CardTitle>
              <CardDescription>
                Choose which maturity events create in-app notifications during the daily scan. Duplicates are always
                de-duplicated per event and recipient, regardless of these settings.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2.5">
              {(
                [
                  ['maturity_upcoming', 'Approaching maturity', 'Inside the configured warning windows.'],
                  ['maturity_today', 'Maturity reached', 'On the maturity date itself.'],
                  [
                    'matured_no_application',
                    'Matured without a recorded release application',
                    'Follow-up prompt only — never a finding of non-compliance.',
                  ],
                ] as const
              ).map(([key, label, hint]) => (
                <label
                  key={key}
                  className="flex items-start gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700"
                >
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 rounded border-slate-300"
                    checked={events[key]}
                    onChange={(event) => setEvents((current) => ({ ...current, [key]: event.target.checked }))}
                  />
                  <span>
                    {label}
                    <span className="mt-0.5 block text-[11px] leading-relaxed text-slate-500">{hint}</span>
                  </span>
                </label>
              ))}
              <Button
                size="sm"
                loading={saveSetting.isPending}
                onClick={() => saveSetting.mutate({ key: 'notification_events', value: events })}
              >
                Save notification events
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Workflow policy</CardTitle>
              <CardDescription>
                Controls whether a requester may approve and complete their own application. Disabled by default and enforced
                in the database function.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <label className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 rounded border-amber-300"
                  checked={allowSelf}
                  onChange={(event) => setAllowSelf(event.target.checked)}
                />
                <span>
                  Allow self-approval
                  <span className="mt-0.5 block text-[11px] leading-relaxed">
                    Enabling this weakens segregation of duties. It should only be enabled if an explicit written policy
                    permits it.
                  </span>
                </span>
              </label>
              <Button
                size="sm"
                variant={allowSelf ? 'danger' : 'outline'}
                loading={saveSetting.isPending}
                onClick={() => saveSetting.mutate({ key: 'workflow', value: { allow_self_approval: allowSelf } })}
              >
                Save workflow policy
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Database className="h-4 w-4 text-slate-500" /> Demonstration data
              </CardTitle>
              <CardDescription>
                Synthetic records covering the required scenarios: active, approaching maturity, matured without an
                application, OCR amount mismatch, missing information, renewal in progress and release awaiting review.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Alert tone="warning">
                Demo rows are labelled <strong>is_demo</strong> and display a "Demonstration data" badge. Never load them into a
                production dataset without explicit authorisation.
              </Alert>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" loading={seed.isPending} onClick={() => seed.mutate()}>
                  <RefreshCcw className="h-3.5 w-3.5" /> Load / refresh demo data
                </Button>
                <Button size="sm" variant="danger" onClick={() => setConfirmRemove(true)}>
                  <Trash2 className="h-3.5 w-3.5" /> Remove demo data
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Maturity monitoring scan</CardTitle>
              <CardDescription>
                Generates in-app alerts for approaching maturity, maturing-today records, and matured records without a
                release application. Also runs daily from the Vercel cron schedule. Alerts are de-duplicated per
                event/recipient.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Button size="sm" loading={scan.isPending} onClick={() => scan.mutate()}>
                <Play className="h-3.5 w-3.5" /> Run scan now
              </Button>
              {scanResult && (
                <dl className="grid grid-cols-2 gap-2 text-xs">
                  {Object.entries(scanResult).map(([key, value]) => (
                    <div key={key} className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5">
                      <dt className="text-[10px] uppercase tracking-wide text-slate-500">{key.replace(/_/g, ' ')}</dt>
                      <dd className="font-semibold text-slate-800">{value}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Deployment diagnostics</CardTitle>
              <CardDescription>
                Checks that server-only configuration is present and the database is reachable. Values are never printed.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Button size="sm" variant="outline" onClick={loadDiagnostics}>
                Run diagnostics
              </Button>
              {diagnosticsError && <Alert tone="danger">{diagnosticsError}</Alert>}
              {diagnostics && (
                <ul className="space-y-1.5 text-xs">
                  {diagnostics.checks.map((check) => (
                    <li key={check.name} className="flex items-start gap-2">
                      {check.ok ? (
                        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-emerald-600" />
                      ) : (
                        <XCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-red-600" />
                      )}
                      <span>
                        <span className="font-medium text-slate-800">{check.name}: </span>
                        <span className="text-slate-600">{check.detail}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {setup && (
                <p className="text-[11px] text-slate-500">
                  {setup.admins} administrator(s), {setup.profiles} profile(s), {setup.institutions} institution(s).
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      <Alert tone="info" title="Verification limitations are configuration, not marketing">
        {settings.data?.verificationNote}
      </Alert>

      <p className="flex items-center gap-1.5 text-[11px] text-slate-500">
        <AlertTriangle className="h-3.5 w-3.5" /> Settings are stored in <code>system_settings</code> and readable by signed-in
        users so the interface can state the real policy; only administrators can change them.
      </p>

      <Dialog
        open={confirmRemove}
        onClose={() => setConfirmRemove(false)}
        title="Remove demonstration data?"
        description="Only rows explicitly marked as demonstration data are deleted. Real records are never touched."
        footer={
          <>
            <Button variant="outline" onClick={() => setConfirmRemove(false)}>
              Cancel
            </Button>
            <Button variant="danger" loading={removeDemo.isPending} onClick={() => removeDemo.mutate()}>
              Remove demo rows
            </Button>
          </>
        }
      >
        <p className="text-sm leading-relaxed text-slate-600">
          Synthetic records, their documents, extraction results, flags, applications and notifications will be removed. The
          audit trail keeps the history of what happened.
        </p>
        <p className="mt-2 text-[11px] text-slate-500">Last settings update: {formatDateTime(settings.data ? new Date().toISOString() : null)}</p>
      </Dialog>
    </div>
  );
}
