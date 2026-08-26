const CACHE_NAME = "prime-diario-v21";
const APP_SHELL = [
  "./",
  "./index.html",
  "./app.js",
  "./styles.css",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./telao.html",
  "./telao.js",
  "./telao.css",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const sameOrigin = new URL(event.request.url).origin === self.location.origin;

  if (sameOrigin) {
    // Rede primeiro pros arquivos do próprio app: o Painel do Telão fica
    // ligado dias seguidos sem ninguém apertar F5, então uma atualização
    // publicada precisa aparecer sozinha na próxima carga. Cache-first
    // prendia a versão antiga até alguém forçar um hard-refresh manual.
    // O cache aqui é só um fallback pra continuar funcionando offline.
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
  } else {
    // Bibliotecas de CDN (xlsx/pdf.js/Chart.js/exceljs): cache-first, já que
    // a URL inclui a versão — o conteúdo de uma URL já cacheada não muda.
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          if (response && response.status === 200) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        });
      })
    );
  }
});
