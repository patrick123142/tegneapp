'use strict';
// SERVICE WORKER: gør appen brugbar uden internet.
// Første gang appen åbnes, hentes alle filer og gemmes på enheden. Derefter bruges de gemte filer.
// Når der kommer en ny version, skifter VERSION (og filnavnene herunder), og den nye version hentes i baggrunden.
const VERSION = '11';
const CACHE = 'tegneapp-' + VERSION;
const FILER = [
  "./",
  "index.html",
  "style.css?v=11",
  "grundlag.js?v=11",
  "kerne.js?v=11",
  "farver.js?v=11",
  "vaerktoej.js?v=11",
  "tegning.js?v=11",
  "lager.js?v=11",
  "start.js?v=11",
  "manifest.json",
  "icons/ikon-192.png",
  "icons/ikon-512.png",
  "icons/ikon-maskable-512.png",
  "icons/apple-touch-ikon.png"
];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    for (const f of FILER) {
      const svar = await fetch(new Request(f, { cache: 'reload' }));
      if (!svar.ok) throw new Error('Kunne ikke hente ' + f);
      await c.put(f, svar);
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const navn of await caches.keys()) {
      if (navn.startsWith('tegneapp-') && navn !== CACHE) await caches.delete(navn);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  e.respondWith((async () => {
    const c = await caches.open(CACHE);
    const gemt = await c.match(req);
    if (gemt) return gemt;
    if (req.mode === 'navigate') {
      const forside = await c.match('index.html');
      if (forside) return forside;
    }
    return fetch(req);
  })());
});
