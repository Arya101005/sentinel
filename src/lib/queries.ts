import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';
import type { DashboardSummary, Institution, Profile, SystemSetting } from './types';
import { todayInPolicyZone } from './maturity';
import { normalizeWarningDays } from './maturity';

export interface AppSettings {
  warningDays: number[];
  emailEnabled: boolean;
  inAppEnabled: boolean;
  allowSelfApproval: boolean;
  timezone: string;
  organizationName: string;
  organizationDepartment: string;
  tagline: string;
  demoEnabled: boolean;
  demoLabel: string;
  externalBankVerification: boolean;
  verificationNote: string;
}

export const DEFAULT_SETTINGS: AppSettings = {
  warningDays: [30, 15, 7],
  emailEnabled: false,
  inAppEnabled: true,
  allowSelfApproval: false,
  timezone: 'Asia/Kolkata',
  organizationName: 'AICTE',
  organizationDepartment: 'Regulation Bureau',
  tagline: 'Monitor Smarter. Verify Better. Act on Time.',
  demoEnabled: true,
  demoLabel: 'DEMONSTRATION DATA',
  externalBankVerification: false,
  verificationNote:
    'No bank or AICTE verification service is connected. OCR output is a candidate value for human review, never proof of authenticity.',
};

export function settingsFromRows(rows: SystemSetting[]): AppSettings {
  const get = <T>(key: string, fallback: T): T => {
    const row = rows.find((entry) => entry.key === key);
    return (row?.value as T) ?? fallback;
  };
  const channels = get<{ in_app?: boolean; email?: boolean }>('notification_channels', {
    in_app: true,
    email: false,
  });
  const organization = get<{ name?: string; department?: string; tagline?: string }>('organization', {});
  const workflow = get<{ allow_self_approval?: boolean }>('workflow', { allow_self_approval: false });
  const demo = get<{ enabled?: boolean; label?: string }>('demo_data', { enabled: true });
  const verification = get<{ external_bank_api?: boolean; note?: string }>('verification_policy', {});

  return {
    warningDays: normalizeWarningDays(get<number[]>('maturity_warning_days', [30, 15, 7])),
    emailEnabled: Boolean(channels.email),
    inAppEnabled: channels.in_app !== false,
    allowSelfApproval: workflow.allow_self_approval === true,
    timezone: get<string>('timezone', 'Asia/Kolkata'),
    organizationName: organization.name ?? 'AICTE',
    organizationDepartment: organization.department ?? 'Regulation Bureau',
    tagline: organization.tagline ?? DEFAULT_SETTINGS.tagline,
    demoEnabled: demo.enabled !== false,
    demoLabel: demo.label ?? 'DEMONSTRATION DATA',
    externalBankVerification: verification.external_bank_api === true,
    verificationNote: verification.note ?? DEFAULT_SETTINGS.verificationNote,
  };
}

export function useSettings() {
  return useQuery({
    queryKey: ['system-settings'],
    staleTime: 60_000,
    queryFn: async (): Promise<AppSettings> => {
      const { data, error } = await supabase.from('system_settings').select('*');
      if (error) throw new Error(error.message);
      return settingsFromRows((data ?? []) as SystemSetting[]);
    },
  });
}

export function useInstitutions(includeInactive = false) {
  return useQuery({
    queryKey: ['institutions', includeInactive],
    staleTime: 60_000,
    queryFn: async (): Promise<Institution[]> => {
      let query = supabase.from('institutions').select('*').order('institution_name');
      if (!includeInactive) query = query.eq('status', 'active');
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      return (data ?? []) as Institution[];
    },
  });
}

export function useDashboardSummary() {
  const today = todayInPolicyZone();
  return useQuery({
    queryKey: ['dashboard-summary', today],
    queryFn: async (): Promise<DashboardSummary> => {
      const { data, error } = await supabase.rpc('fn_dashboard_summary', { p_today: today });
      if (error) throw new Error(error.message);
      return data as DashboardSummary;
    },
  });
}

export function useUnreadNotifications() {
  return useQuery({
    queryKey: ['notifications-unread'],
    queryFn: async () => {
      const { data, error } = await supabase.from('notifications').select('id').eq('is_read', false);
      if (error) throw new Error(error.message);
      return (data ?? []).length;
    },
  });
}

export function useProfiles() {
  return useQuery({
    queryKey: ['profiles'],
    staleTime: 60_000,
    queryFn: async (): Promise<Profile[]> => {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .order('full_name');
      if (error) throw new Error(error.message);
      return (data ?? []) as Profile[];
    },
  });
}

export function useLogEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      action: string;
      entity_type: string;
      entity_id?: string | null;
      summary?: string;
      metadata?: Record<string, unknown>;
    }) => {
      const { error } = await supabase.rpc('fn_log_event', {
        p_action: input.action,
        p_entity_type: input.entity_type,
        p_entity_id: input.entity_id ?? null,
        p_summary: input.summary ?? null,
        p_metadata: input.metadata ?? {},
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['audit-events'] });
    },
  });
}
