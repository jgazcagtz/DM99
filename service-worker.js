const CACHE_NAME = 'dm99-v3.0.0-r3-shell';
const APP_SHELL = [
  '/',
  '/index.html',
  '/styles.css',
  '/script.js',
  '/manifest.webmanifest',
  '/icons/icon.svg',
  '/src/instruments.js',
  '/src/audio-engine.js',
  '/src/audio-dsp.js',
  '/src/project-state.js',
  '/src/pattern-engine.js',
  '/src/pattern-constants.js',
  '/src/project-store.js',
  '/src/exporters.js',
  '/src/sampler-store.js',
  '/src/binary-utils.js'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => Promise.all(APP_SHELL.map(async url => {
        const response = await fetch(url, { cache: 'reload' });
        if (!response.ok) throw new Error(`Required DM99 shell asset failed: ${url}`);
        await cache.put(url, response);
      })))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cached = await caches.match(event.request);
    if (cached) return cached;

    const fetchAndCache = async () => {
      const response = await fetch(event.request, { cache: 'no-cache' });
      if (response.ok) {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(event.request, response.clone());
      }
      return response;
    };
    try {
      return await fetchAndCache();
    } catch {
      if (event.request.mode === 'navigate') return caches.match('/index.html');
      return new Response('DM99 is offline and this asset is not cached.', {
        status: 503,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }
  })());
});
