/* Service Worker：缓存静态资源，支持离线打开与添加到桌面
   核心代码（html / js / css）走「网络优先」：AI 请求格式 / Prompt / 数据层变更能立即生效，
   不会因旧缓存继续用旧 ai.js 或旧 db.js。 */
const CACHE = 'cuotiben-v6';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './db.js',
  './ai.js',
  './app.js',
  './styles.css?v=6',
  './db.js?v=6',
  './ai.js?v=6',
  './app.js?v=6',
  './manifest.webmanifest',
  './icons/icon-64.png',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.allSettled(ASSETS.map((u) => c.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function cachePut(req, res) {
  if (res && res.ok && res.type === 'basic') {
    const copy = res.clone();
    caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
  }
  return res;
}

function offlineResponse() {
  return new Response('离线且无缓存', { status: 503, statusText: 'Offline' });
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // AI 接口与跨域资源交给网络
  if (url.pathname.indexOf('/api/') !== -1) return;   // 不缓存接口

  const isAppCode = url.pathname === '/' || /\.(?:html|js|css|json|webmanifest)$/i.test(url.pathname);
  if (isAppCode) {
    // 网络优先，失败才回退缓存（离线可用）
    e.respondWith(
      fetch(req).then((res) => cachePut(req, res))
        .catch(() => caches.match(req).then((cached) => cached || offlineResponse()))
    );
    return;
  }
  // 图标等静态资源：缓存优先
  e.respondWith(
    caches.match(req).then((cached) => cached
      || fetch(req).then((res) => cachePut(req, res)).catch(() => offlineResponse()))
  );
});
