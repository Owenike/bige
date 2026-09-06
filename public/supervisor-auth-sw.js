self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }
  const title = typeof payload.title === "string" ? payload.title : "BIG E 主管登入確認";
  const body = typeof payload.body === "string" ? payload.body : "請確認是否為本人登入。";
  const url = typeof payload.url === "string" && payload.url.startsWith("/")
    ? payload.url
    : typeof payload.url === "string" && payload.url.startsWith(self.location.origin)
      ? payload.url
      : "/staff/supervisor-login";
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/LOGO-transparent.png",
      badge: "/LOGO-transparent.png",
      tag: typeof payload.tag === "string" ? payload.tag : "supervisor-login",
      renotify: true,
      requireInteraction: true,
      data: { url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data && typeof event.notification.data.url === "string"
    ? event.notification.data.url
    : "/staff/supervisor-login";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url === url && "focus" in client) return client.focus();
      }
      return self.clients.openWindow(url);
    }),
  );
});
