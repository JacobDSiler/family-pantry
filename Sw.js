// ── Our Kitchen Service Worker ────────────────────────────────────────────────
// Strategy:
//   • HTML pages        → Network-first (always get latest, fall back to cache offline)
//   • JS/CSS/fonts      → Cache-first with background refresh (fast loads)
//   • Firebase/API      → Network-only (never cache live data)
//
// Bump CACHE_VERSION any time you deploy a significant update — this forces
// all clients to discard old caches and re-fetch everything fresh.

const CACHE_VERSION = 'v8';
const CACHE_NAME    = `our-kitchen-${CACHE_VERSION}`;

// Resources to pre-cache on install (the app shell)
const PRECACHE_URLS = [
  './',
  './pantry-tracker.html',
  './manifest.json',
];

// Domains that should NEVER be cached (live data, APIs)
const NEVER_CACHE = [
  'firebaseio.com',
  'firebase.googleapis.com',
  'firebaseapp.com',
  'googleapis.com',
  'overpass-api.de',
  'nominatim.openstreetmap.org',
  'bigdatacloud.net',
  'open.er-api.com',
];

// ── Install: pre-cache the app shell ─────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting()) // activate immediately, don't wait for old SW to die
  );
});

// ── Activate: delete all old caches ──────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key.startsWith('our-kitchen-') && key !== CACHE_NAME)
          .map(key => {
            console.log('[SW] Deleting old cache:', key);
            return caches.delete(key);
          })
      ))
      .then(() => self.clients.claim()) // take control of all open tabs immediately
  );
});

// ── Fetch: smart routing ──────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // 1. Never cache live data / APIs
  if(NEVER_CACHE.some(domain => url.hostname.includes(domain))){
    event.respondWith(fetch(event.request));
    return;
  }

  // 2. Non-GET requests go straight to network
  if(event.request.method !== 'GET'){
    event.respondWith(fetch(event.request));
    return;
  }

  // 3. HTML pages → Network-first
  //    Always try the network. If it succeeds, update cache and return fresh response.
  //    If network fails (offline), serve from cache.
  if(event.request.headers.get('accept')?.includes('text/html') ||
     url.pathname.endsWith('.html') || url.pathname === '/' || url.pathname === ''){
    event.respondWith(networkFirst(event.request));
    return;
  }

  // 4. Everything else (fonts, icons, manifest) → Cache-first with background update
  event.respondWith(cacheFirstWithRefresh(event.request));
});

// Network-first: try network, cache on success, fall back to cache
async function networkFirst(request){
  try {
    const networkResponse = await fetch(request);
    if(networkResponse.ok || networkResponse.type === 'opaque'){
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, networkResponse.clone()); // update cache in background
    }
    return networkResponse;
  } catch(err){
    // Offline — serve from cache
    const cached = await caches.match(request);
    if(cached) return cached;
    // Nothing in cache either — return a minimal offline page
    return new Response(
      `<!DOCTYPE html><html><head><title>Our Kitchen — Offline</title>
      <meta name="viewport" content="width=device-width,initial-scale=1">
      <style>body{font-family:sans-serif;text-align:center;padding:60px 20px;background:#faf7f2;}
      h1{font-size:2rem;margin-bottom:12px;}p{color:#7a6e5f;}</style></head>
      <body><h1>🥕 Our Kitchen</h1>
      <p>You're offline and this page isn't cached yet.</p>
      <p>Connect to the internet and reload to get started.</p>
      <button onclick="location.reload()" style="margin-top:24px;padding:12px 28px;background:#c8521a;color:#fff;border:none;border-radius:12px;font-size:1rem;cursor:pointer;">Try Again</button>
      </body></html>`,
      { headers: { 'Content-Type': 'text/html' } }
    );
  }
}

// Cache-first: serve from cache immediately, refresh cache in background
async function cacheFirstWithRefresh(request){
  const cached = await caches.match(request);
  const networkFetch = fetch(request).then(response => {
    if(response.ok || response.type === 'opaque'){
      caches.open(CACHE_NAME).then(cache => cache.put(request, response.clone()));
    }
    return response;
  }).catch(() => null);

  return cached || await networkFetch;
}
