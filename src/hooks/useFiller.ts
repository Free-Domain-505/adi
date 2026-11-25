import { useEffect, useState } from 'react'
import { fetchFillerList, type EpKind } from '../services/api'
import { fetchMalEpisodeKinds } from '../services/jikan'
import type { AniTitle } from '../types/anime'

const TTL = 7 * 24 * 3600e3
const ckey = (id: number) => `zk:filler:v2:${id}`
const read = (id: number): Map<number, EpKind> | null => {
  try {
    const j = JSON.parse(localStorage.getItem(ckey(id)) ?? 'null') as { t: number; k: Array<[number, EpKind]> } | null
    return j && Date.now() - j.t < TTL ? new Map(j.k) : null
  } catch {
    return null
  }
}
const write = (id: number, m: Map<number, EpKind>) => {
  try {
    localStorage.setItem(ckey(id), JSON.stringify({ t: Date.now(), k: [...m] }))
  } catch {
    /* storage full / blocked */
  }
}

const EMPTY = new Map<number, EpKind>()

/**
 * Non-canon episodes of one anime entry. Two sources are merged: AnimeFillerList (filler + mixed, used when its numbering
 * fits this entry) and MAL's own filler / recap flags (fills any gaps without blocking AnimeFillerList results).
 * Canon episodes are simply absent.
 */
export function useFiller(
  a: { id?: number; idMal: number | null; title: AniTitle; episodes: number | null } | null | undefined,
  on = true,
): Map<number, EpKind> {
  const titles = a ? [a.title.english, a.title.romaji].filter((t): t is string => !!t) : []
  const cid = a ? (a.idMal ?? -(a.id ?? 0)) : 0
  const key = `${on}:${cid}:${a?.episodes ?? ''}:${titles.join('|')}`

  const [map, setMap] = useState<Map<number, EpKind>>(() => (on && cid ? (read(cid) ?? EMPTY) : EMPTY))

  useEffect(() => {
    if (!a || !on || !titles.length) {
      setMap(EMPTY)
      return
    }

    const hit = cid ? read(cid) : null
    if (hit) {
      setMap(hit)
      return
    }

    let dead = false
    const merged = new Map<number, EpKind>()
    let aflFits = false
    let aflDone = false
    let malDone = !a.idMal
    let malSucceeded = false

    const flush = () => {
      if (dead) return
      setMap(merged.size > 0 ? new Map(merged) : EMPTY)
      if (cid && aflDone && malDone && (aflFits || (malSucceeded && merged.size > 0))) {
        write(cid, merged)
      }
    }

    fetchFillerList(titles, a.episodes)
      .then((afl) => {
        if (dead) return
        const eps = a.episodes
        const fits =
          !!afl?.success &&
          !!afl.max &&
          (!eps || afl.max >= eps * 0.75 || (afl.max > 12 && Math.abs(afl.max - eps) <= 100))
        aflFits = fits
        if (fits) {
          for (const n of afl!.filler ?? []) merged.set(n, 'filler')
          for (const n of afl!.mixed ?? []) merged.set(n, 'mixed')
        }
      })
      .catch(() => {
        /* fallback to MAL if available */
      })
      .finally(() => {
        aflDone = true
        flush()
      })

    if (a.idMal) {
      fetchMalEpisodeKinds(a.idMal)
        .then((mal) => {
          if (dead || !mal) return
          malSucceeded = true
          for (const [n, k] of mal) {
            if (!merged.has(n)) merged.set(n, k)
          }
        })
        .catch(() => {
          /* Jikan optional */
        })
        .finally(() => {
          malDone = true
          flush()
        })
    }

    return () => {
      dead = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return map
}
