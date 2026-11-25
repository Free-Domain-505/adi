/**
 * Web-standard fetch wrapper (compatible with both Node.js and Cloudflare Workers) whose timeout
 * applies ONLY while establishing the connection and waiting for response headers.
 * Once headers arrive, the timer is cleared so long-running video/media stream bodies
 * are never aborted mid-transfer by a connection/handshake timeout.
 */
export async function fetchWithHeaderTimeout(fetchUrl, init = {}, timeoutMs = 10000, fetchImpl = fetch) {
  const controller = new AbortController();
  const parentSignal = init.signal;
  let onParentAbort = null;

  if (parentSignal) {
    if (parentSignal.aborted) {
      controller.abort(parentSignal.reason);
    } else {
      onParentAbort = () => controller.abort(parentSignal.reason);
      parentSignal.addEventListener("abort", onParentAbort, { once: true });
    }
  }

  const timer = setTimeout(() => {
    try {
      controller.abort(new DOMException("The operation was aborted due to timeout", "TimeoutError"));
    } catch {
      controller.abort();
    }
  }, timeoutMs);

  try {
    return await fetchImpl(fetchUrl, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    if (parentSignal && onParentAbort) {
      parentSignal.removeEventListener("abort", onParentAbort);
    }
  }
}

export function fetchTimeout(fetchUrl, opts = {}, timeoutMsArg, fetchImpl = fetch) {
  const { timeoutMs: optTimeout, ...init } = opts || {};
  const timeoutMs =
    typeof timeoutMsArg === "number"
      ? timeoutMsArg
      : typeof optTimeout === "number"
      ? optTimeout
      : 10000;
  return fetchWithHeaderTimeout(fetchUrl, init, timeoutMs, fetchImpl);
}

