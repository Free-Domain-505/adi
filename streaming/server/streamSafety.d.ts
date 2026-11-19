import type { Readable, Writable } from 'node:stream'

export function fetchWithHeaderTimeout(
  fetchUrl: string | URL,
  init?: RequestInit,
  timeoutMs?: number,
  fetchImpl?: typeof fetch,
): Promise<Response>

export function pipeWebBodySafe(
  webBody: ReadableStream<Uint8Array> | null | undefined,
  res: Writable & { writableEnded?: boolean; writableFinished?: boolean; destroyed?: boolean; destroy?: () => void },
  onError?: (err: unknown) => void,
): Readable | null
