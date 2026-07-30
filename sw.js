/**
 * Service worker: makes the game installable and playable with no network.
 *
 * Two strategies, split by what the file is:
 *
 *   code and markup (.html, .js, the manifest)  -> network first, cache fallback
 *   art and icons (.png)                        -> cache first
 *
 * Cache-first for everything is the usual advice and it is wrong here. The
 * sprites never change, so caching them forever is free; the JavaScript changes
 * every build, and a cache-first worker will happily serve last week's game to
 * a player who is online and has just been shipped a fix. Network-first costs
 * one round trip when online and still works fully offline.
 */

const CACHE = 'bhrd-v4';

/** Files whose contents change from build to build. */
const isCode = (url) =>
  url.pathname.endsWith('.js')
  || url.pathname.endsWith('.html')
  || url.pathname.endsWith('.webmanifest')
  || url.pathname === '/'
  || url.pathname.endsWith('/');

const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './dist/src/main.js',
  './dist/src/core/bat.js',
  './dist/src/core/constants.js',
  './dist/src/core/game.js',
  './dist/src/core/physics.js',
  './dist/src/core/pitch.js',
  './dist/src/core/rng.js',
  './dist/src/core/round.js',
  './dist/src/core/stadium.js',
  './dist/src/core/vec.js',
  './dist/src/render/camera.js',
  './dist/src/render/fx.js',
  './dist/src/render/hud.js',
  './dist/src/render/scene.js',
  './dist/src/render/stadium.js',
  './dist/src/audio/sfx.js',
  './assets/player/bat_anchors.json',
  './assets/icon/icon-192.png',
  './assets/icon/icon-512.png',
  './assets/icon/icon-maskable-512.png',
];

for (const id of ['yuki', 'takaya', 'atsushi']) {
  for (const pose of [
    'stance', 'swing_0', 'swing_1', 'swing_2', 'swing_3', 'swing_4',
    'back', 'back_cam', 'back_cam_body', 'back_cam_bat',
  ]) {
    PRECACHE.push(`./assets/player/${id}/${pose}.png`);
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // addAll is atomic: one 404 and nothing is cached, which is the behaviour we
    // want — a half-cached game that boots and then fails is worse than no cache.
    await cache.addAll(PRECACHE);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  const remember = async (response) => {
    if (response && response.ok && response.type === 'basic') {
      const cache = await caches.open(CACHE);
      await cache.put(request, response.clone());
    }
    return response;
  };

  if (isCode(url) || request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        return await remember(await fetch(request));
      } catch (err) {
        const cached = await caches.match(request, { ignoreSearch: true });
        if (cached) return cached;
        if (request.mode === 'navigate') {
          const shell = await caches.match('./index.html');
          if (shell) return shell;
        }
        throw err;
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(request, { ignoreSearch: true });
    if (cached) return cached;
    return remember(await fetch(request));
  })());
});
