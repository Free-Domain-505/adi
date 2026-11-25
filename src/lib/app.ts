/** Page with the self-hosting guide. */
export const SELF_HOST_PATH = '/self-host'

export function formatBytes(n: number): string {
  if (!n) return ''
  const mb = n / 1048576
  return mb >= 10 ? `${Math.round(mb)} MB` : `${mb.toFixed(1)} MB`
}

export function formatDay(iso: string | null | undefined): string {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('en', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return ''
  const hours = (Date.now() - new Date(iso).getTime()) / 3600e3
  if (hours < 1) return 'just now'
  if (hours < 24) return `${Math.floor(hours)}h ago`
  const days = hours / 24
  if (days < 2) return 'yesterday'
  if (days < 14) return `${Math.floor(days)} days ago`
  if (days < 60) return `${Math.floor(days / 7)} weeks ago`
  if (days < 730) return `${Math.floor(days / 30)} months ago`
  return `${Math.floor(days / 365)} years ago`
}
