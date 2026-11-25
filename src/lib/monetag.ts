export const MONETAG_ZONE_ID = ''
export const MONETAG_SCRIPT_SRC = ''
export const MONETAG_EXCLUDED_UIDS = new Set<string>()

export function isExcludedAdUser(_uid?: string | null): boolean {
  return true
}

export async function resolveMonetagExclusion(_token?: string | null): Promise<{ resolved: boolean; excluded: boolean }> {
  return { resolved: true, excluded: true }
}

export async function syncMonetagForAuthState(_auth?: { authLoading?: boolean; accessToken?: string | null }): Promise<'excluded'> {
  return 'excluded'
}

export function installMonetagOnClick(): { status: 'excluded' } {
  return { status: 'excluded' }
}
