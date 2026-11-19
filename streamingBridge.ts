import { handle } from './streaming/server/handler.js';

export async function invokeStreamingApi(pathWithQuery: string): Promise<any | null> {
  try {
    const request = new Request(`http://127.0.0.1${pathWithQuery}`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Aadhi/1.0',
        'X-Zenkai-Embed': '1',
        'X-Zenkai-Barrier': process.env.ZENKAI_BARRIER || 'zenkai-barrier-apk-2026-v1',
      },
    });
    const response = await handle(request, { ...process.env, IS_DEV: '1' });
    if (!response || !response.ok) return null;
    return await response.json().catch(() => null);
  } catch {
    return null;
  }
}

export function installStreamingBridge(app: any) {
  const forwardToStreaming = async (req: any, res: any, next: any, rewriteApi: boolean) => {
    try {
      const original = String(req.originalUrl || req.url || '');
      const rewritten = rewriteApi
        ? original.replace(/^\/api\/streaming(?=\/|\?|$)/, '/api')
        : original;
      const request = new Request(`http://127.0.0.1${rewritten}`, {
        method: req.method,
        headers: {
          'Accept': String(req.headers.accept || '*/*'),
          'User-Agent': String(req.headers['user-agent'] || 'Aadhi/1.0'),
          ...(req.headers.range ? { 'Range': String(req.headers.range) } : {}),
          'X-Zenkai-Embed': '1',
          'X-Zenkai-Barrier': process.env.ZENKAI_BARRIER || 'zenkai-barrier-apk-2026-v1',
        },
      });
      const response = await handle(request, { ...process.env, IS_DEV: '1' });
      if (!response) return next();
      res.status(response.status);
      response.headers.forEach((value: string, key: string) => {
        if (!['transfer-encoding', 'connection'].includes(key.toLowerCase())) res.setHeader(key, value);
      });
      const body = Buffer.from(await response.arrayBuffer());
      res.send(body);
    } catch (error) {
      res.status(502).json({ error: error instanceof Error ? error.message : 'Streaming bridge failed' });
    }
  };

  app.use('/api/streaming', (req: any, res: any, next: any) => forwardToStreaming(req, res, next, true));
  app.use('/proxy', (req: any, res: any, next: any) => forwardToStreaming(req, res, next, false));
}
