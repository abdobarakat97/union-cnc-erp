const CACHE_NAME = 'union-cnc-v2';
const urlsToCache = [
  'index.html',
  'style.css',
  'app.js',
  'manifest.json'
];

// تثبيت الـ Service Worker وتحميل الملفات للتخزين المؤقت
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        return cache.addAll(urlsToCache);
      })
  );
  // يجبر الـ Service Worker على التفعيل فوراً
  self.skipWaiting();
});

// تفعيل الـ Service Worker والتحكم في الصفحات المفتوحة فوراً
self.addEventListener('activate', event => {
  event.waitUntil(clients.claim());
});

// التعامل مع طلبات الشبكة (إما من التخزين المؤقت أو من الإنترنت)
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // إذا وجد الملف في الكاش، أعده، وإلا اذهب للإنترنت
        return response || fetch(event.request);
      })
  );
);