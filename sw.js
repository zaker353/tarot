/* 離線快取：第一次載入後，整個 App（含 78 張牌圖）都能離線使用 */
const CACHE_PREFIX = 'tarot-'
const CACHE = CACHE_PREFIX + 'v3'

self.addEventListener('install', (event) => {
  self.skipWaiting()
})

// 清掉「自己的」舊版快取。
// ⚠️ 一定要用前綴過濾。CacheStorage 是整個網域共用的,而 zaker353.github.io 上還有
// 英文學習(langlearn-*)與番茄鐘(pomo-*)。若刪掉所有不是自己的快取,會把那兩個 App
// 的離線功能整包清空,使用者離線時就打不開它們(2026-07-15 稽核抓到,三支都犯同一個錯)。
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE)
          .map((k) => caches.delete(k)),
      ),
    ).then(() => self.clients.claim()),
  )
})

// 快取優先：抓過的資源直接用快取，沒抓過才上網抓並存起來
self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== location.origin) return

  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(req)
      if (cached) {
        // HTML 之類的入口檔案在背景順便更新，下次就是新版
        if (req.mode === 'navigate' || url.pathname.endsWith('.html')) {
          fetch(req).then((res) => {
            if (res && res.ok) cache.put(req, res.clone())
          }).catch(() => {})
        }
        return cached
      }
      try {
        const res = await fetch(req)
        if (res && res.ok) cache.put(req, res.clone())
        return res
      } catch (err) {
        if (req.mode === 'navigate') {
          const fallback = await cache.match('./index.html')
          if (fallback) return fallback
        }
        throw err
      }
    }),
  )
})
