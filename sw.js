const VERSION = "v1.0.7";
const CACHE   = "scallywag-" + VERSION;

self.addEventListener("install", e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(["./", "./index.html", "./app.js"]).catch(() => {})));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    fetch(e.request).then(res => {
      if (res && res.status === 200) {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
      }
      return res;
    }).catch(() => caches.match(e.request).then(cached => cached || caches.match("./index.html")))
  );
});

// ── Push notification handler ──────────────────────────────────────────────
self.addEventListener("push", e => {
  const data = e.data ? e.data.json() : {};
  const title   = data.notification?.title || "ScAllywag Trivia ⚓";
  const options = {
    body:    data.notification?.body  || "New questions are ready! Set sail! 🏴‍☠️",
    icon:    "./icons/icon-192.png",
    badge:   "./icons/icon-192.png",
    vibrate: [200, 100, 200],
    data:    { url: data.data?.url || "./" },
    actions: [
      { action: "play", title: "Play Now 🎯" },
      { action: "dismiss", title: "Later" }
    ]
  };
  e.waitUntil(self.registration.showNotification(title, options));
});

// ── Notification click handler ─────────────────────────────────────────────
self.addEventListener("notificationclick", e => {
  e.notification.close();
  if (e.action === "dismiss") return;
  e.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(clientList => {
      if (clientList.length > 0) {
        clientList[0].focus();
        clientList[0].navigate(e.notification.data?.url || "./");
      } else {
        clients.openWindow(e.notification.data?.url || "./");
      }
    })
  );
});
