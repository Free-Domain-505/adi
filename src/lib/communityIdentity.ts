import type { CommunityPost } from './supabase'

export function parseCommunityAuthor(raw?: string | null): { displayName: string; handle: string | null; raw: string } {
  const clean = String(raw || '').trim()
  if (!clean) return { displayName: 'Otaku', handle: null, raw: 'Otaku' }
  const match = clean.match(/^(.*?)\s*\(@([a-zA-Z0-9_.-]+)\)\s*$/)
  if (match) {
    return {
      displayName: match[1].trim() || match[2],
      handle: match[2].toLowerCase(),
      raw: clean,
    }
  }
  if (clean.startsWith('@') && clean.length > 1) {
    const h = clean.slice(1).trim().toLowerCase()
    return { displayName: clean.slice(1).trim(), handle: h, raw: clean }
  }
  return { displayName: clean, handle: null, raw: clean }
}

export function formatCommunityAuthorLabel(displayName: string, handle?: string | null): string {
  const name = String(displayName || '').trim() || 'Otaku'
  const cleanHandle = String(handle || '').replace(/^@/, '').trim().toLowerCase()
  if (!cleanHandle) return name
  const parsed = parseCommunityAuthor(name)
  if (parsed.handle === cleanHandle) return name
  return `${parsed.displayName} (@${cleanHandle})`
}

export function getPostAuthorIdentityKey(post?: Pick<CommunityPost, 'user_id' | 'username'> | null): string {
  if (!post) return 'anon'
  if (post.user_id) return `uid:${post.user_id}`
  const parsed = parseCommunityAuthor(post.username)
  return parsed.handle ? `handle:${parsed.handle}` : `name:${parsed.displayName.toLowerCase()}`
}

export function isOwnCommunityPost(
  post: Pick<CommunityPost, 'id' | 'user_id' | 'username'>,
  ctx: {
    userId?: string | null
    handle?: string | null
    mySentIds?: Set<string> | string[]
  },
): boolean {
  if (post.user_id && ctx.userId) {
    return post.user_id === ctx.userId
  }
  if (post.user_id && !ctx.userId) {
    return false
  }

  if (post.id && post.id.startsWith('temp-')) {
    return true
  }

  if (ctx.mySentIds) {
    const hasId = ctx.mySentIds instanceof Set ? ctx.mySentIds.has(post.id) : ctx.mySentIds.includes(post.id)
    if (hasId) return true
  }

  if (!post.user_id && ctx.handle) {
    const parsed = parseCommunityAuthor(post.username)
    if (parsed.handle && parsed.handle === ctx.handle.replace(/^@/, '').toLowerCase()) return true
  }
  return false
}

