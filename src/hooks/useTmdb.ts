import { useEffect, useState } from 'react'
import { fetchTmdb, peekTmdb, type TmdbBundle } from '../services/api'

/** TMDB artwork / details + AniBridge mapping for an AniList id. null until loaded (or when unavailable). */
export function useTmdb(id?: number | null, title?: string, format?: string | null): TmdbBundle | null {
  const synced = peekTmdb(id, format)
  const [state, setState] = useState<{ id: number; bundle: TmdbBundle } | null>(() =>
    id && synced ? { id, bundle: synced } : null,
  )
  useEffect(() => {
    if (!id || !title) return
    const immediate = peekTmdb(id, format)
    if (immediate) {
      setState({ id, bundle: immediate })
      return
    }
    let off = false
    fetchTmdb(id, title, format).then((bundle) => {
      if (!off) setState({ id, bundle })
    })
    return () => {
      off = true
    }
  }, [id, title, format])
  if (synced) return synced
  return id && state?.id === id ? state.bundle : null
}
