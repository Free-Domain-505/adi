import { Readable } from "node:stream";
export { fetchWithHeaderTimeout } from "./fetchTimeout.js";

/**
 * Safely pipes a Web ReadableStream to a Node ServerResponse / Writable without letting
 * upstream stream errors (such as TimeoutError or ECONNRESET) become uncaught 'error' events.
 */
export function pipeWebBodySafe(webBody, res, onError) {
  if (!webBody) {
    if (!res.writableEnded && typeof res.end === "function") res.end();
    return null;
  }

  const nodeStream = Readable.fromWeb(webBody);
  let cleaned = false;

  const cleanup = (err) => {
    if (cleaned) return;
    cleaned = true;
    if (err && typeof onError === "function") {
      try {
        onError(err);
      } catch {}
    }
    if (!nodeStream.destroyed) {
      try {
        nodeStream.destroy();
      } catch {}
    }
    if (!res.writableEnded && !res.destroyed) {
      try {
        if (typeof res.destroy === "function") res.destroy();
        else if (typeof res.end === "function") res.end();
      } catch {}
    }
  };

  nodeStream.on("error", cleanup);
  if (typeof res.on === "function") {
    res.on("error", () => cleanup());
    res.on("close", () => {
      if (!res.writableFinished) cleanup();
    });
  }

  nodeStream.pipe(res);
  return nodeStream;
}
