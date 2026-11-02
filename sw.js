/* 離線快取：採 cache-first。
   安裝新版時先把 App 外殼（首頁和它引用的程式、樣式、圖示）存好，換版後第一次離線也打得開；
   牌圖是看過哪張才存哪張，換版時從舊快取搬過來（牌圖不會跟著版本變），
   沒瀏覽過的牌在離線時會顯示不出來。
   （2026-11-03 以前安裝時什麼都不存、換版就把舊快取整包刪掉：換版後還沒在網路上逛過就離線的話，
   App 整個打不開，看過的牌圖也要重新下載。） */
const CACHE_PREFIX = 'tarot-'
const CACHE = CACHE_PREFIX + 'v18'

/** App 外殼：首頁＋首頁裡引用的檔案（打包後的檔名帶亂碼、每版不同，只能從首頁裡讀出來） */
async function precacheShell() {
  const cache = await caches.open(CACHE)
  const res = await fetch('./', { cache: 'reload' })
  if (!res.ok) throw new Error('首頁回應 ' + res.status)
  const html = await res.clone().text()
  await cache.put('./', res)
  // 要去重：首頁裡圖示引用了兩次（icon、apple-touch-icon），addAll 遇到重複的網址會整批失敗
  const refs = new Set([...html.matchAll(/(?:src|href)="(\.\/[^"]+)"/g)].map((m) => m[1]))
  await cache.addAll([...refs])
}

self.addEventListener('install', (event) => {
  // 外殼存失敗（例如裝到一半斷網）也照樣換版，頂多回到「看過才存」；不能因此卡在舊版
  event.waitUntil(precacheShell().catch(() => {}).then(() => self.skipWaiting()))
})

/** 看過的牌圖從舊版快取搬到新版。⚠️ 日後若換了牌圖檔，搬過來的會是舊圖：那一版要把這段拿掉 */
async function carryOverCards(oldKeys) {
  const cache = await caches.open(CACHE)
  for (const k of oldKeys) {
    const old = await caches.open(k)
    for (const req of await old.keys()) {
      if (!new URL(req.url).pathname.includes('/cards/') || (await cache.match(req, { ignoreVary: true }))) continue
      const res = await old.match(req, { ignoreVary: true })
      if (res) await cache.put(req, res)
    }
  }
}

// 清掉「自己的」舊版快取。
// ⚠️ 一定要用前綴過濾。CacheStorage 是整個網域共用的,而 zaker353.github.io 上還有
// 英文學習(langlearn-*)與番茄鐘(pomo-*)。若刪掉所有不是自己的快取,會把那兩個 App
// 的離線功能整包清空,使用者離線時就打不開它們(2026-07-15 稽核抓到,三支都犯同一個錯)。
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      const old = keys.filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE)
      try {
        await carryOverCards(old)
      } catch {
        /* 搬不成就算了，頂多重新下載；舊快取照樣要清 */
      }
      await Promise.all(old.map((k) => caches.delete(k)))
      await self.clients.claim()
    })(),
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
      // ignoreVary：回應帶 Vary（例如 Origin）時，頁面要 js／css 帶的標頭跟安裝時存的不一樣，
      // 會被當成沒存過、離線就讀不到（本機預覽伺服器會這樣，2026-11-03 實測）
      const cached = await cache.match(req, { ignoreVary: true })
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
        // 離線又沒存過這個網址（例如帶了 ?參數）：給首頁。首頁存的網址是 './'，不是 './index.html'
        if (req.mode === 'navigate') {
          const fallback = await cache.match('./', { ignoreVary: true })
          if (fallback) return fallback
        }
        throw err
      }
    }),
  )
})
