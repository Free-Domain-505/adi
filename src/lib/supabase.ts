import { createClient, type User } from '@supabase/supabase-js';

export const SUPABASE_URL = 'https://pslxlbcvvjenuhochzvh.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_23NfXkRXGdqiBxwtJu2ymA_UoCAWuvu';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

export type SupabaseUser = User;

export function sanitizeDocId(raw: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_:-]/g, '_').slice(0, 128);
  return cleaned || 'item';
}

export async function signInWithEmailPassword(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  if (error) throw error;
  return data;
}

export async function signUpWithEmailPassword(email: string, password: string, fullName?: string) {
  const cleanName = (fullName || '').trim();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: cleanName
      ? {
          data: {
            full_name: cleanName,
          },
        }
      : undefined,
  });
  if (error) throw error;
  return data;
}

export async function signOutUser() {
  try {
    await supabase.auth.signOut({ scope: 'local' });
  } catch (error) {
    console.warn('Supabase local sign out warning:', error);
  }
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key && key.startsWith('sb-') && key.includes('auth-token')) {
        localStorage.removeItem(key);
      }
    }
  } catch {
    // Ignore storage access errors
  }
}

export async function verifyActiveSupabaseUser(): Promise<'valid' | 'revoked' | 'network_error'> {
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) return 'revoked';

    const { data, error } = await supabase.auth.getUser(token);
    if (error) {
      const status = Number((error as { status?: number }).status || 0);
      const code = String((error as { code?: string }).code || '').toLowerCase();
      const msg = String(error.message || '').toLowerCase();
      if (
        status === 401 ||
        status === 403 ||
        status === 404 ||
        code === 'user_banned' ||
        code === 'user_not_found' ||
        code === 'bad_jwt' ||
        code === 'session_not_found' ||
        code === 'session_expired' ||
        /banned|does not exist|not exist|not found|deleted|invalid|expired|jwt|unauthorized|forbidden/.test(msg)
      ) {
        return 'revoked';
      }
      return 'network_error';
    }

    const user = data?.user as
      | (SupabaseUser & { banned_until?: string; deleted_at?: string })
      | null;
    if (!user || !user.id) return 'revoked';
    if (user.deleted_at) return 'revoked';
    if (user.banned_until && Date.parse(user.banned_until) > Date.now()) return 'revoked';
    if (user.app_metadata?.banned === true) return 'revoked';

    return 'valid';
  } catch {
    return 'network_error';
  }
}

export async function getAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token || null;
}
