import { apiUrl, fetchAnimeSaltDetails, fetchStream, type StreamResult } from '../services/api'

export type ResolvedAnimePlayback =
  | { kind: 'embed'; serverId: string; embedUrl: string }
  | { kind: 'direct'; serverId: string; stream: StreamResult; requestedFailed?: boolean }

export type SkipTimes = {
  intro: { start: number; end: number } | null
  outro: { start: number; end: number } | null
}

function withTimeout<T>(promise: Promise<T>, ms: number, label = 'Request timed out'): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = globalThis.setTimeout(() => reject(new Error(label)), ms)
    promise.then(
      (v) => {
        globalThis.clearTimeout(t)
        resolve(v)
      },
      (e) => {
        globalThis.clearTimeout(t)
        reject(e)
      },
    )
  })
}

export async function resolveAnimeWithFallback(
  p: {
    id: number
    ep: number
    title: string
    romaji?: string | null
    format?: string | null
    country?: string | null
    audio?: 'sub' | 'dub'
    preferredServer?: string | null
  },
  excluded: readonly string[] = [],
  onSkipFound?: (skip: SkipTimes) => void,
): Promise<ResolvedAnimePlayback> {
  const skip = new Set(excluded)
  const targetAudio = p.audio ?? 'dub'
  const fallbackAudio = targetAudio === 'dub' ? 'sub' : 'dub'

  const tryDirect = async (serverId: string, aud: 'sub' | 'dub'): Promise<StreamResult> => {
    if (skip.has(serverId)) throw new Error('Excluded')
    const timeoutMs =
      serverId === 'desidubanime' || serverId === 'watchanimeworld' || serverId === 'server12' || serverId === 'anikoto'
        ? 24000
        : 8500
    return await withTimeout(
      fetchStream({ id: p.id, ep: p.ep, server: serverId, audio: aud, title: p.title, romaji: p.romaji, format: p.format, country: p.country }),
      timeoutMs,
      `${serverId} timeout`,
    )
  }

  const tryAcdn = async (): Promise<StreamResult> => {
    if (skip.has('acdn')) throw new Error('Excluded')
    try {
      return await withTimeout(
        fetchStream({ id: p.id, ep: p.ep, server: 'acdn', audio: targetAudio, title: p.title, format: p.format, country: p.country }),
        16000,
        'acdn timeout',
      )
    } catch {
      return await withTimeout(
        fetchStream({ id: p.id, ep: p.ep, server: 'acdn', audio: targetAudio, title: p.title, format: p.format, country: p.country }),
        11000,
        'acdn retry timeout',
      )
    }
  }

  const trySalt = async (srv: '1' | '2') => {
    const sid = `animesalt-${srv}`
    if (skip.has(sid)) throw new Error('Excluded')
    return await withTimeout(
      fetchAnimeSaltDetails({
        id: p.id,
        ep: p.ep,
        title: p.title,
        format: p.format,
        server: srv,
        audio: targetAudio === 'sub' ? 'sub' : 'multi',
      }),
      10000,
      `${sid} timeout`,
    )
  }

  const saltToDirectStream = (
    srv: '1' | '2',
    directUrl: string,
    refererUrl?: string | null,
    subtitles: { file: string; label: string; default?: boolean }[] = [],
  ): ResolvedAnimePlayback => {
    const ref = refererUrl || 'https://ravok.buzz/'
    const proxied = apiUrl(
      `/proxy?url=${encodeURIComponent(directUrl)}&referer=${encodeURIComponent(ref)}&audio=${encodeURIComponent(targetAudio)}`,
    )
    return {
      kind: 'direct',
      serverId: `animesalt-${srv}`,
      stream: {
        server: `AnimeSalt ${srv}`,
        audio: targetAudio,
        multiAudio: true,
        streamUrl: proxied,
        rawStreamUrl: directUrl,
        fallbackStreamUrl: proxied,
        referer: ref,
        subtitles,
        intro: null,
        outro: null,
      },
    }
  }

  const mergeSkipTimes = (stream: StreamResult, ...others: PromiseSettledResult<StreamResult>[]): StreamResult => {
    let intro = stream.intro && stream.intro.end > 0 ? stream.intro : null
    let outro = stream.outro && stream.outro.end > 0 ? stream.outro : null
    for (const r of others) {
      if (r.status !== 'fulfilled') continue
      if (!intro && r.value.intro && r.value.intro.end > 0) intro = r.value.intro
      if (!outro && r.value.outro && r.value.outro.end > 0) outro = r.value.outro
      if (intro && outro) break
    }
    if (intro === stream.intro && outro === stream.outro) return stream
    return { ...stream, intro, outro }
  }

  // Fast first-responder across already-started candidate promises
  const firstFulfilled = (
    items: Array<{ serverId: string; promise: Promise<StreamResult> }>,
  ): Promise<ResolvedAnimePlayback | null> => {
    if (items.length === 0) return Promise.resolve(null)
    return new Promise((resolve) => {
      let resolved = false
      let completed = 0
      const total = items.length

      items.forEach(({ serverId, promise }) => {
        promise
          .then((stream) => {
            if (!resolved && stream?.streamUrl) {
              resolved = true
              resolve({ kind: 'direct', serverId, stream })
            } else {
              completed++
              if (completed >= total && !resolved) resolve(null)
            }
          })
          .catch(() => {
            completed++
            if (completed >= total && !resolved) resolve(null)
          })
      })
    })
  }

  // Fast first-responder: staggers candidates slightly by priority
  const tryCandidatesFast = async (
    candidates: Array<{ serverId: string; run: () => Promise<StreamResult> }>,
  ): Promise<ResolvedAnimePlayback | null> => {
    if (candidates.length === 0) return null
    return new Promise((resolve) => {
      let resolved = false
      let completed = 0
      const total = candidates.length

      candidates.forEach((c, idx) => {
        setTimeout(async () => {
          if (resolved) return
          try {
            const stream = await c.run()
            if (!resolved && stream?.streamUrl) {
              resolved = true
              resolve({ kind: 'direct', serverId: c.serverId, stream })
            } else {
              completed++
              if (completed >= total && !resolved) resolve(null)
            }
          } catch {
            completed++
            if (completed >= total && !resolved) {
              resolve(null)
            }
          }
        }, idx * 220)
      })
    })
  }

  const notifySkip = (stream?: StreamResult | null) => {
    if (!onSkipFound || !stream) return
    const intro = stream.intro && stream.intro.end > 0 ? stream.intro : null
    const outro = stream.outro && stream.outro.end > 0 ? stream.outro : null
    if (intro || outro) onSkipFound({ intro, outro })
  }

  // 0. If the user explicitly picked a server in CinePlayer's Server menu, try that exact server first.
  const prefSrv = p.preferredServer?.trim().toLowerCase()
  if (prefSrv && !skip.has(prefSrv)) {
    try {
      if (prefSrv === 'watchanimeworld' || prefSrv === 'animeworld' || prefSrv === 'waw') {
        const wawStream = await tryDirect('watchanimeworld', 'dub')
        if (wawStream?.streamUrl) return { kind: 'direct', serverId: 'watchanimeworld', stream: wawStream }
      } else if (prefSrv === 'server12') {
        const s12Stream = await tryDirect('server12', 'dub')
        if (s12Stream?.streamUrl) return { kind: 'direct', serverId: 'server12', stream: s12Stream }
      } else if (prefSrv === 'desidubanime') {
        const desiStream = await tryDirect('desidubanime', 'dub')
        if (desiStream?.streamUrl) return { kind: 'direct', serverId: 'desidubanime', stream: desiStream }
      } else if (prefSrv === 'acdn') {
        const acdnStream = await tryAcdn()
        if (acdnStream?.streamUrl) return { kind: 'direct', serverId: 'acdn', stream: acdnStream }
      } else if (prefSrv === 'animesalt-1' || prefSrv === 'animesalt-2') {
        const srv = prefSrv === 'animesalt-2' ? '2' : '1'
        const saltRes = await trySalt(srv)
        const u = saltRes.directStreamUrl
        if (u) {
          return saltToDirectStream(
            srv,
            u,
            saltRes.directReferer || saltRes.embedUrl,
            saltRes.subtitles || [],
          )
        }
      } else {
        const directStream = await tryDirect(prefSrv, targetAudio)
        if (directStream?.streamUrl) return { kind: 'direct', serverId: prefSrv, stream: directStream }
      }
    } catch {
      /* requested server failed on this episode — continue with fallback chain */
    }
  }

  // 1. Prioritize servers that play in our inbuilt player (CinePlayer):
  //    - For SUB: prioritize genuine Japanese SUB servers (MegaPlay, VidStream, FlixCloud), only using ACDN if those fail.
  //    - For DUB: try ACDN (Multi-Audio: Hindi + English + Original) and DesiDubAnime (Hindi Dub), plus AnimeSalt & single-language English dub fallbacks.
  if (targetAudio === 'sub') {
    const directSubCandidates = [
      ...(!skip.has('megaplay') ? [{ serverId: 'megaplay', run: () => tryDirect('megaplay', 'sub') }] : []),
      ...(!skip.has('vidstream') ? [{ serverId: 'vidstream', run: () => tryDirect('vidstream', 'sub') }] : []),
      ...(!skip.has('flixcloud') ? [{ serverId: 'flixcloud', run: () => tryDirect('flixcloud', 'sub') }] : []),
    ]
    const fastHit = await tryCandidatesFast(directSubCandidates)
    if (fastHit) {
      if (fastHit.kind === 'direct' && (!fastHit.stream.intro || !fastHit.stream.outro)) {
        // Warm skip times from sibling direct server without blocking playback start
        void Promise.allSettled(
          (['megaplay', 'vidstream', 'flixcloud'] as const)
            .filter((sid) => sid !== fastHit.serverId && !skip.has(sid))
            .map((sid) => tryDirect(sid, 'sub').then((s) => notifySkip(s))),
        )
      }
      return fastHit
    }

    if (!skip.has('acdn')) {
      try {
        const acdnStream = await tryAcdn()
        if (acdnStream?.streamUrl) return { kind: 'direct', serverId: 'acdn', stream: acdnStream }
      } catch {
        /* continue to fallback */
      }
    }

    if (!skip.has('anikoto')) {
      try {
        const anikotoSubStream = await tryDirect('anikoto', 'sub')
        if (anikotoSubStream?.streamUrl) return { kind: 'direct', serverId: 'anikoto', stream: anikotoSubStream }
      } catch {
        /* continue to fallback */
      }
    }

    const saltP1 = trySalt('1')
    const saltP2 = trySalt('2')
    const directFbHit = await firstFulfilled([
      { serverId: 'megaplay', promise: tryDirect('megaplay', fallbackAudio) },
      { serverId: 'vidstream', promise: tryDirect('vidstream', fallbackAudio) },
      { serverId: 'flixcloud', promise: tryDirect('flixcloud', fallbackAudio) },
    ])
    const [s1, s2] = await Promise.allSettled([saltP1, saltP2])

    if (s1.status === 'fulfilled' && !skip.has('animesalt-1')) {
      const u1 = s1.value.directStreamUrl
      if (u1) {
        const base = saltToDirectStream(
          '1',
          u1,
          s1.value.directReferer || s1.value.embedUrl,
          s1.value.subtitles || [],
        )
        if (base.kind === 'direct' && directFbHit?.kind === 'direct') {
          return { kind: 'direct', serverId: base.serverId, stream: mergeSkipTimes(base.stream, { status: 'fulfilled', value: directFbHit.stream }) }
        }
        return base
      }
    }
    if (s2.status === 'fulfilled' && !skip.has('animesalt-2')) {
      const u2 = s2.value.directStreamUrl
      if (u2) {
        const base = saltToDirectStream(
          '2',
          u2,
          s2.value.directReferer || s2.value.embedUrl,
          s2.value.subtitles || [],
        )
        if (base.kind === 'direct' && directFbHit?.kind === 'direct') {
          return { kind: 'direct', serverId: base.serverId, stream: mergeSkipTimes(base.stream, { status: 'fulfilled', value: directFbHit.stream }) }
        }
        return base
      }
    }
    if (directFbHit?.kind === 'direct') return { ...directFbHit, requestedFailed: true }
  } else {
    const acdnPromise = !skip.has('acdn') ? tryAcdn() : Promise.reject(new Error('Excluded'))
    acdnPromise.catch(() => {})
    const wawPromise = !skip.has('watchanimeworld') ? tryDirect('watchanimeworld', 'dub') : Promise.reject(new Error('Excluded'))
    wawPromise.catch(() => {})
    const s12Promise = !skip.has('server12') ? tryDirect('server12', 'dub') : Promise.reject(new Error('Excluded'))
    s12Promise.catch(() => {})
    const desiPromise = !skip.has('desidubanime') ? tryDirect('desidubanime', 'dub') : Promise.reject(new Error('Excluded'))
    desiPromise.catch(() => {})
    const anikotoPromise = !skip.has('anikoto') ? tryDirect('anikoto', 'dub') : Promise.reject(new Error('Excluded'))
    anikotoPromise.catch(() => {})
    const dubBackupItems = [
      ...(!skip.has('megaplay') ? [{ serverId: 'megaplay', promise: tryDirect('megaplay', targetAudio) }] : []),
      ...(!skip.has('vidstream') ? [{ serverId: 'vidstream', promise: tryDirect('vidstream', targetAudio) }] : []),
      ...(!skip.has('flixcloud') ? [{ serverId: 'flixcloud', promise: tryDirect('flixcloud', targetAudio) }] : []),
    ]
    const ctry = String(p.country ?? '').trim().toUpperCase()
    const isDonghua = ctry === 'CN' || ctry === 'TW' || ctry === 'HK'
    if (isDonghua) {
      const multiDonghuaHit = await Promise.race([
        firstFulfilled([
          ...(!skip.has('server12') ? [{ serverId: 'server12', promise: s12Promise }] : []),
          ...(!skip.has('acdn') ? [{ serverId: 'acdn', promise: acdnPromise }] : []),
          ...(!skip.has('watchanimeworld') ? [{ serverId: 'watchanimeworld', promise: wawPromise }] : []),
        ]),
        new Promise<null>((r) => setTimeout(() => r(null), 4500)),
      ])
      if (multiDonghuaHit?.kind === 'direct') return multiDonghuaHit
      const fastDonghuaHit = await firstFulfilled(dubBackupItems)
      if (fastDonghuaHit?.kind === 'direct') return fastDonghuaHit
    }
    const settledBackups: PromiseSettledResult<StreamResult>[] = []
    for (const item of dubBackupItems) {
      item.promise.then(
        (value) => {
          settledBackups.push({ status: 'fulfilled', value })
          notifySkip(value)
        },
        () => {},
      )
    }

    try {
      const acdnStream = await acdnPromise
      if (acdnStream?.streamUrl) {
        return { kind: 'direct', serverId: 'acdn', stream: mergeSkipTimes(acdnStream, ...settledBackups) }
      }
    } catch {
      /* ACDN failed/unavailable — try AnimeWorld multi-dub next */
    }

    try {
      const wawStream = await wawPromise
      if (wawStream?.streamUrl) {
        return { kind: 'direct', serverId: 'watchanimeworld', stream: mergeSkipTimes(wawStream, ...settledBackups) }
      }
    } catch {
      /* AnimeWorld unavailable — try Server 12 multi-dub next */
    }

    try {
      const s12Stream = await s12Promise
      if (s12Stream?.streamUrl) {
        return { kind: 'direct', serverId: 'server12', stream: mergeSkipTimes(s12Stream, ...settledBackups) }
      }
    } catch {
      /* Server 12 unavailable — try DesiDubAnime next */
    }

    try {
      const desiStream = await desiPromise
      if (desiStream?.streamUrl) {
        return { kind: 'direct', serverId: 'desidubanime', stream: mergeSkipTimes(desiStream, ...settledBackups) }
      }
    } catch {
      /* DesiDubAnime unavailable — try Anikoto English dub next */
    }

    try {
      const anikotoStream = await anikotoPromise
      if (anikotoStream?.streamUrl) {
        return { kind: 'direct', serverId: 'anikoto', stream: mergeSkipTimes(anikotoStream, ...settledBackups) }
      }
    } catch {
      /* Anikoto unavailable — continue to remaining English dub & AnimeSalt backups */
    }

    const dubFallbackHit = await firstFulfilled(dubBackupItems)
    if (dubFallbackHit?.kind === 'direct') return dubFallbackHit

    const saltP1 = !skip.has('animesalt-1') ? trySalt('1') : Promise.reject(new Error('Excluded'))
    const saltP2 = !skip.has('animesalt-2') ? trySalt('2') : Promise.reject(new Error('Excluded'))
    const [s1, s2] = await Promise.allSettled([saltP1, saltP2])

    if (s1.status === 'fulfilled' && !skip.has('animesalt-1')) {
      const u1 = s1.value.directStreamUrl
      if (u1) {
        const base = saltToDirectStream(
          '1',
          u1,
          s1.value.directReferer || s1.value.embedUrl,
          s1.value.subtitles || [],
        )
        if (base.kind === 'direct') {
          return { kind: 'direct', serverId: base.serverId, stream: mergeSkipTimes(base.stream, ...settledBackups) }
        }
      }
    }
    if (s2.status === 'fulfilled' && !skip.has('animesalt-2')) {
      const u2 = s2.value.directStreamUrl
      if (u2) {
        const base = saltToDirectStream(
          '2',
          u2,
          s2.value.directReferer || s2.value.embedUrl,
          s2.value.subtitles || [],
        )
        if (base.kind === 'direct') {
          return { kind: 'direct', serverId: base.serverId, stream: mergeSkipTimes(base.stream, ...settledBackups) }
        }
      }
    }
  }

  throw new Error('This episode is currently unavailable on any server.')
}
