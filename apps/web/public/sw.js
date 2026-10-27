// Keel Bridge service worker: shows review alerts and opens the card when tapped.
self.addEventListener("push", (event) => {
  const msg = event.data ? event.data.json() : { title: "Keel", body: "A finding needs your review.", url: "/" };
  event.waitUntil(self.registration.showNotification(msg.title, {
    body: msg.body, tag: msg.tag, icon: "/icon.svg", badge: "/icon.svg", data: { url: msg.url }, requireInteraction: true,
  }));
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url ?? "/";
  event.waitUntil(clients.matchAll({ type: "window" }).then((list) => {
    const open = list.find((c) => "focus" in c);
    if (open) { open.navigate(url); return open.focus(); }
    return clients.openWindow(url);
  }));
});
