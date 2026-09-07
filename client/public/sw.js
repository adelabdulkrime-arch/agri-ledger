// Design: «سوق الحقل» — تخزين مؤقت يسمح بالعمل دون إنترنت،
// مع ضمان وصول التحديثات الجديدة بدل تثبيت المستخدم على نسخة قديمة.
const CACHE_NAME = "agri-ledger-offline-v2";
const APP_SHELL = ["/", "/manifest.json", "/brand/agri-mark.svg"];

self.addEventListener("install", event => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  // حذف النسخ القديمة، وإلا بقي المستخدم على إصدار سابق بعد كل تحديث.
  event.waitUntil(
    caches
      .keys()
      .then(keys =>
        Promise.all(
          keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // صفحات التنقل: الشبكة أولًا حتى يصل أي تحديث، والمخزون احتياط عند انقطاع الإنترنت.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then(response => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put("/", copy));
          return response;
        })
        .catch(() =>
          caches.match("/").then(cached => cached || caches.match(request))
        )
    );
    return;
  }

  // الملفات الثابتة تحمل بصمة في اسمها، لذا المخزون أولًا آمن وأسرع.
  event.respondWith(
    caches.match(request).then(
      cached =>
        cached ||
        fetch(request).then(response => {
          // لا نخزن الردود الفاشلة أو الجزئية حتى لا نثبّت خطأ في المخزون.
          if (response.ok && response.status === 200) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
          }
          return response;
        })
    )
  );
});
