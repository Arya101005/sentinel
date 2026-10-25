/**
 * Only VITE_-prefixed values reach the browser. They are public by design:
 * the Supabase URL and the *publishable* key. The service-role secret and the
 * database URL are read exclusively by server-side functions.
 */
const url = (import.meta.env.VITE_SUPABASE_URL ?? '').trim();
const publishableKey = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '').trim();

export const env = {
  supabaseUrl: url,
  supabasePublishableKey: publishableKey,
  isConfigured: /^https?:\/\//.test(url) && publishableKey.length > 20,
  appName: 'FDR Sentinel',
  tagline: 'Monitor Smarter. Verify Better. Act on Time.',
  organization: 'All India Council for Technical Education',
  department: 'Regulation Bureau',
  problemStatementId: '26265',
  theme: 'Smart Automation',
} as const;
