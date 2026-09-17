// Service worker: cache degli asset immutabili + notifiche push (Web Push API).
//
// LA STRATEGIA È DIVISA IN DUE, e la divisione è il punto importante.
//
// La versione precedente rispondeva `cached || network` a QUALUNQUE richiesta.
// Dopo un deploy il documento HTML arrivava dalla cache, e un HTML vecchio
// punta ai nomi vecchi dei file JavaScript — anch'essi in cache. Risultato:
// servivano due ricaricamenti per vedere i cambiamenti, e nel frattempo si
// otteneva un miscuglio di vecchio e nuovo, con pezzi dell'app aggiornati e
// altri no.
//
// Ora:
// - /_next/static/ è cache-first, ed è corretto perché quei file sono
//   IMMUTABILI: il nome contiene un'impronta del contenuto, quindi se il
//   contenuto cambia cambia anche l'indirizzo e non c'è nulla da invalidare.
// - tutto il resto — il documento, il manifest, l'icona — è network-first, con
//   la cache come riserva per quando si è offline.
//
// Le richieste /api/ non passano da qui: sono dati in tempo reale.
const CACHE = "busroma-v2";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("push", (e) => {
  const data = e.data?.json() ?? {};
  e.waitUntil(
    self.registration.showNotification(data.title ?? "Bus Roma", {
      body: data.body ?? "",
      icon: "/icon.svg",
      badge: "/icon.svg",
      tag: data.tag ?? "busroma",
      renotify: false,
    }),
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      const w = wins.find((c) => c.url.startsWith(self.location.origin));
      return w ? w.focus() : clients.openWindow("/");
    }),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return; // sempre rete

  // Asset con impronta nel nome: immutabili, quindi la cache è sempre giusta.
  if (url.pathname.startsWith("/_next/static/")) {
    e.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const cached = await cache.match(req);
        if (cached) return cached;
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      }),
    );
    return;
  }

  // Tutto il resto: prima la rete, la cache solo se la rete non c'è. È ciò che
  // fa arrivare subito un deploy invece del secondo caricamento dopo.
  e.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      try {
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      } catch {
        const cached = await cache.match(req);
        if (cached) return cached;
        throw new Error("offline e non in cache");
      }
    })(),
  );
});
