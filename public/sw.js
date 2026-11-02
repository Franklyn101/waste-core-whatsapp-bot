// WasteCore admin service worker: shows push notifications from the server
// (new bookings, payments, collector reports...) even when the dashboard is
// closed, and opens the right dashboard page when one is tapped.

self.addEventListener("install", () => self.skipWaiting())
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()))

self.addEventListener("push", (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = { title: "WasteCore", body: event.data ? event.data.text() : "" }
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "WasteCore", {
      body: data.body || "",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag: data.tag,
      data: { section: data.section || "overview" },
    })
  )
})

self.addEventListener("notificationclick", (event) => {
  event.notification.close()
  const section = event.notification.data?.section || "overview"
  const url = `/admin?section=${encodeURIComponent(section)}`
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true })
    const open = windows.find((w) => new URL(w.url).pathname.startsWith("/admin"))
    if (open) {
      open.postMessage({ type: "open-section", section })
      return open.focus()
    }
    return self.clients.openWindow(url)
  })())
})
