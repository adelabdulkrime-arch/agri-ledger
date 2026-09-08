// Design: «سوق الحقل» — تخزين مؤقت يسمح بالعمل دون إنترنت،
// مع ضمان وصول التحديثات الجديدة بدل تثبيت المستخدم على نسخة قديمة.
const CACHE_NAME = "agri-ledger-offline-v3";
// المسار مشتق من موقع الملف نفسه، ليعمل في الجذر أو داخل مجلد فرعي.
const BASE = new URL("./", self.location).pathname;
const APP_SHELL = [
  BASE,
  BASE + "manifest.json",
  BASE + "brand/agri-mark.svg",
  BASE + "brand/icon-192.png",
  BASE + "brand/icon-512.png",
];

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
          caches.open(CACHE_NAME).then(cache => cache.put(BASE, copy));
          return response;
        })
        .catch(() =>
          caches.match(BASE).then(cached => cached || caches.match(request))
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
