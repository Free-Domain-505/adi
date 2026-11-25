// Serves /sw.js as a clean self-unregistering worker with no ad scripts.
export function onRequestGet() {
  const body = `self.addEventListener('install', () => self.skipWaiting());\nself.addEventListener('activate', (e) => e.waitUntil(self.registration.unregister().catch(() => {})));\n`;
  return new Response(body, {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'public, max-age=0, must-revalidate',
    },
  });
}
