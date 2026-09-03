/**
 * The service worker: what makes this installable, and what keeps the shell up
 * on a weak connection.
 *
 * Its caching is deliberately narrow. Attendance, leave balances and payslips
 * are exactly the kind of thing that is dangerous to serve stale — a cached
 * "not checked in yet" shown to someone who checked in an hour ago invites a
 * second punch — so every API call goes to the network and is never cached.
 * Only the app shell is cached, and only so the thing opens.
 */

const CACHE = "hrms-shell-v1"

// The shell, not the data. Hashed build assets are added as they are fetched.
const SHELL = ["/", "/index.html", "/manifest.webmanifest", "/favicon.png", "/apple-touch-icon.png"]

self.addEventListener("install", (event) => {
  // addAll rejects the whole install if any single URL 404s, which in dev is
  // easy to do; individual puts let the worker install with whatever exists.
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      Promise.all(SHELL.map((url) => cache.add(url).catch(() => undefined)))
    )
  )
  self.skipWaiting()
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener("fetch", (event) => {
  const { request } = event
  if (request.method !== "GET") return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  // Never cache the API. A stale attendance record is worse than no record.
  if (url.pathname.startsWith("/api/")) return

  // Navigations: try the network, fall back to the cached shell so an offline
  // launch opens the app rather than the browser's dinosaur.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => caches.match("/index.html").then((r) => r ?? Response.error()))
    )
    return
  }

  // Everything else — the hashed JS and CSS — is immutable once built, so a
  // cache hit is always correct and a miss fills the cache for next time.
  event.respondWith(
    caches.match(request).then(
      (hit) =>
        hit ??
        fetch(request).then((response) => {
          if (response.ok && response.type === "basic") {
            const copy = response.clone()
            caches.open(CACHE).then((cache) => cache.put(request, copy))
          }
          return response
        })
    )
  )
})
