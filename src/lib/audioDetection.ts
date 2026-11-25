import { useCallback, useEffect, useState } from 'react'
import { fetchDetectedAudioReport, type VerifiedAudioReport } from '../services/api'

export interface AudioDetectionResult {
  status: 'idle' | 'scanning' | 'verified' | 'error'
  report: VerifiedAudioReport | null
  isScanning: boolean
  scanMessage: string
  rescan: () => Promise<void>
}

const reportCache = new Map<string, VerifiedAudioReport>()

export function useBackgroundAudioDetection(opts: {
  animeId?: number | null
  totalEpisodes?: number
  title?: string
  romajiTitle?: string
  countryOfOrigin?: string | null
  season?: number
  format?: string | null
  enabled?: boolean
}): AudioDetectionResult {
  const {
    animeId,
    totalEpisodes = 1,
    title,
    romajiTitle,
    countryOfOrigin,
    season = 1,
    format,
    enabled = true,
  } = opts

  const cacheKey = animeId ? `${animeId}:${totalEpisodes}:${season}:${format || ''}` : ''
  const [scanNonce, setScanNonce] = useState(0)
  const [state, setState] = useState<{
    status: 'idle' | 'scanning' | 'verified' | 'error'
    report: VerifiedAudioReport | null
    scanMessage: string
  }>(() => {
    const cached = cacheKey ? reportCache.get(cacheKey) : undefined
    return cached
      ? { status: 'verified', report: cached, scanMessage: '100% Server Verified' }
      : {
          status: enabled && animeId ? 'scanning' : 'idle',
          report: null,
          scanMessage: 'Testing episodes across available servers…',
        }
  })

  useEffect(() => {
    if (!enabled || !animeId) {
      setState({ status: 'idle', report: null, scanMessage: '' })
      return
    }
    const cached = scanNonce === 0 && cacheKey ? reportCache.get(cacheKey) : undefined
    if (cached) {
      setState({ status: 'verified', report: cached, scanMessage: '100% Server Verified' })
      return
    }
    let cancelled = false
    setState((prev) => ({
      status: 'scanning',
      report: prev.report,
      scanMessage: `Testing episodes across streaming servers (${Math.max(1, totalEpisodes)} eps)…`,
    }))

    fetchDetectedAudioReport(
      animeId,
      totalEpisodes,
      title,
      countryOfOrigin,
      season,
      format,
      romajiTitle,
    )
      .then((report) => {
        if (cancelled) return
        if (report) {
          if (cacheKey) reportCache.set(cacheKey, report)
          setState({ status: 'verified', report, scanMessage: report.accuracyGuarantee || '100% Server Verified' })
        } else {
          setState({ status: 'error', report: null, scanMessage: 'Verification incomplete' })
        }
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error', report: null, scanMessage: 'Verification incomplete' })
      })

    return () => {
      cancelled = true
    }
  }, [enabled, animeId, totalEpisodes, title, romajiTitle, countryOfOrigin, season, format, cacheKey, scanNonce])

  const rescan = useCallback(async () => {
    if (cacheKey) reportCache.delete(cacheKey)
    setScanNonce((n) => n + 1)
  }, [cacheKey])

  return {
    status: state.status,
    report: state.report,
    isScanning: state.status === 'scanning',
    scanMessage: state.scanMessage,
    rescan,
  }
}
