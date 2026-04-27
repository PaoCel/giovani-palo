const CACHE_NAME = "gugd-shell-v3";
const CORE_ASSETS = [
  "/",
  "/manifest.webmanifest",
  "/brand-logo.png",
  "/app-icon-192.png",
  "/app-icon-512.png",
];
const CORE_ASSET_PATHS = new Set(CORE_ASSETS);

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS)).catch(() => undefined),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key)),
      ),
    ).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") {
    return;
  }

  const requestUrl = new URL(event.request.url);

  // Let Firebase and other third-party APIs bypass the offline shell logic.
  if (requestUrl.origin !== self.location.origin) {
    return;
  }

  const isNavigationRequest =
    event.request.mode === "navigate" ||
    (event.request.headers.get("accept") || "").includes("text/html");

  if (isNavigationRequest) {
    event.respondWith(
      fetch(event.request).catch(async () => {
        const cachedPage = await caches.match("/");
        return cachedPage || Response.error();
      }),
    );
    return;
  }

  if (!CORE_ASSET_PATHS.has(requestUrl.pathname)) {
    return;
  }

  event.respondWith(
    caches.match(requestUrl.pathname).then((cachedResponse) => cachedResponse || fetch(event.request)),
  );
});

function parsePushPayload(event) {
  if (!event.data) {
    return {};
  }

  try {
    return event.data.json();
  } catch (error) {
    return {
      body: event.data.text(),
    };
  }
}

self.addEventListener("push", (event) => {
  const payload = parsePushPayload(event);
  const title = payload.title || "Nuovo iscritto";
  const url = payload.url || "/admin";

  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body || "E arrivata una nuova iscrizione.",
      tag: payload.tag || "admin-registration",
      icon: "/app-icon-192.png",
      badge: "/app-icon-192.png",
      data: {
        url,
        eventId: payload.eventId || null,
        registrationId: payload.registrationId || null,
      },
      renotify: true,
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = new URL(
    event.notification.data?.url || "/admin",
    self.location.origin,
  ).toString();

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (clients) => {
      for (const client of clients) {
        const clientUrl = new URL(client.url);

        if (clientUrl.origin !== self.location.origin) {
          continue;
        }

        await client.focus();

        if ("navigate" in client) {
          await client.navigate(targetUrl);
        }

        return;
      }

      await self.clients.openWindow(targetUrl);
    }),
  );
});
