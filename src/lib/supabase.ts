import { createClient } from '@supabase/supabase-js';
import { env } from './env';

/**
 * Browser Supabase client. It only ever holds the publishable key; every read
 * and write is subject to Row Level Security.
 */
export const supabase = createClient(
  env.isConfigured ? env.supabaseUrl : 'http://localhost:54321',
  env.isConfigured ? env.supabasePublishableKey : 'public-anon-key-not-configured',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: 'pkce',
    },
    global: {
      headers: { 'x-application-name': 'fdr-sentinel' },
    },
  },
);
