const CACHE = 'travelog-shell-v5'
const PHOTO_CACHE = 'travelog-photos-v1'
const SHELL = ['./', './index.html', './manifest.webmanifest']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE && key !== PHOTO_CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET' || !request.url.startsWith(self.location.origin)) {
    return
  }

  // API 与版本文件必须走网络：缓存会导致登录态与更新检查长期停留在旧结果
  const url = new URL(request.url)
  if (url.pathname.startsWith('/api/photos/')) {
    // 云端照片：缓存优先，离线也能翻相册
    event.respondWith(
      caches.open(PHOTO_CACHE).then(async (cache) => {
        const cached = await cache.match(request)
        if (cached) return cached
        const response = await fetch(request)
        if (response.ok) await cache.put(request, response.clone())
        return response
      }),
    )
    return
  }
  if (url.pathname.includes('/api/') || url.pathname.endsWith('/version.json')) {
    return
  }

  // 导航请求：网络优先，离线时回退到缓存的 index.html
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone()
          caches.open(CACHE).then((cache) => cache.put(request, copy))
          return response
        })
        .catch(async () => {
          const cache = await caches.open(CACHE)
          return (await cache.match(request)) || (await cache.match('./index.html')) || Response.error()
        }),
    )
    return
  }

  // 静态资源：缓存优先 + 后台更新
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(request)
      const network = fetch(request)
        .then((response) => {
          if (response.ok) {
            cache.put(request, response.clone())
          }
          return response
        })
        .catch(() => cached || Response.error())
      return cached || network
    }),
  )
})