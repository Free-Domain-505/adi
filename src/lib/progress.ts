import { getHistory, getLastEp, setLastEp } from './library'

/** Episode to resume: the continue-watching entry first, then the synced episode map. */
export function lastEpisode(id: number): number {
  const h = getHistory(id)
  if (h) return h.ep
  return getLastEp(id)
}

export function saveEpisode(id: number, ep: number) {
  setLastEp(id, ep)
}
