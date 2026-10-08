// ============================================================
// SERVICE WORKER — офлайн-кэш приложения + фоновые push-уведомления.
// При каждом изменении файлов приложения ОБЯЗАТЕЛЬНО подними номер
// версии ниже (smena-v1 → smena-v2 …), иначе телефоны не подхватят
// обновление.
// ============================================================

const CACHE_PREFIX = "smena-";
const VERSION = CACHE_PREFIX + "v2";

// ---------- счётчик непрочитанных для значка на иконке ----------
function openBadgeDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("smena-badge", 1);
    req.onupgradeneeded = () => { req.result.createObjectStore("kv"); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function getUnreadCount() {
  try {
    const bdb = await openBadgeDB();
    return await new Promise((resolve) => {
      const req = bdb.transaction("kv", "readonly").objectStore("kv").get("unread");
      req.onsuccess = () => resolve(req.result || 0);
      req.onerror = () => resolve(0);
    });
  } catch (e) { return 0; }
}
async function setUnreadCount(n) {
  try {
    const bdb = await openBadgeDB();
    await new Promise((resolve) => {
      const tx = bdb.transaction("kv", "readwrite");
      tx.objectStore("kv").put(n, "unread");
      tx.oncomplete = resolve;
      tx.onerror = resolve;
    });
  } catch (e) {}
}

// ---------- push ----------
// В try/catch: если в момент запуска нет сети, офлайн-кэш ниже всё
// равно должен заработать. Настройки Firebase берём из того же файла,
// что и страница, — чтобы appId не приходилось править в двух местах.
try {
  importScripts("https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js");
  importScripts("https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging-compat.js");
  importScripts("./firebase-config.js");

  firebase.initializeApp(FIREBASE_CONFIG);
  const messaging = firebase.messaging();
  messaging.onBackgroundMessage(async (payload) => {
    const title = (payload.data && payload.data.title) || "Смена";
    const body = (payload.data && payload.data.body) || "";
    self.registration.showNotification(title, {
      body,
      icon: "icon-192.png",
      badge: "icon-192.png",
      vibrate: [200, 100, 200],
      silent: false,
      tag: "chat-" + Date.now(), // не схлопывать разные сообщения в одно
      renotify: true,
    });
    const next = (await getUnreadCount()) + 1;
    await setUnreadCount(next);
    try {
      if (self.navigator && self.navigator.setAppBadge) await self.navigator.setAppBadge(next);
    } catch (e) {}
  });
} catch (e) {
  // офлайн или сервис недоступен — в этот раз просто без фоновых push
}

// нажатие на уведомление — открыть приложение или переключиться на него
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: "window" }).then((list) => {
      // на этом адресе сайта живут ещё Досатуй и Табель — ищем именно своё окно
      for (const c of list) { if (c.url.startsWith(self.registration.scope) && "focus" in c) return c.focus(); }
      if (clients.openWindow) return clients.openWindow("./");
    })
  );
});

// Свои файлы — без них приложение офлайн не запустится вообще.
// Если хоть один не скачался, установка ДОЛЖНА провалиться, чтобы не
// затереть предыдущую рабочую копию.
const CORE_ASSETS = [
  "./",
  "./index.html",
  "./firebase-config.js",
  "./settings.js",
  "./app.js",
  "./outbox.js",
  "./shifts.js",
  "./money.js",
  "./chat.js",
  "./notifications.js",
  "./auth.js",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
];

// Внешние библиотеки — тоже нужны офлайн, но если какая-то разово не
// скачалась, рушить установку из-за неё не стоит: подтянется позже.
const CDN_ASSETS = [
  "https://cdn.tailwindcss.com",
  "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@500;600&display=swap",
  "https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js",
  "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth-compat.js",
  "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore-compat.js",
  "https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging-compat.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    for (const url of CORE_ASSETS) {
      const resp = await fetch(url, { cache: "reload" });
      if (!resp || !resp.ok) throw new Error("Не скачался " + url);
      await cache.put(url, resp);
    }
    await Promise.all(CDN_ASSETS.map((url) =>
      fetch(url, { mode: "no-cors" }).then((r) => cache.put(url, r)).catch(() => {})
    ));
  })());
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      // ВАЖНО: удаляем только СВОИ старые кэши. Хранилище кэшей общее на
      // весь адрес сайта, а на нём живут ещё Досатуй и Табель: если чистить
      // «всё, кроме текущего», мы стёрли бы их офлайн-копии.
      Promise.all(keys.filter((k) => k.startsWith(CACHE_PREFIX) && k !== VERSION).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// сеть, но с таймаутом: если связь формально есть, а данные не идут,
// не ждём бесконечно, а отдаём сохранённую копию
function fetchWithTimeout(request, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    fetch(request).then((resp) => { clearTimeout(timer); resolve(resp); },
                        (err) => { clearTimeout(timer); reject(err); });
  });
}

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  const isOwnFile = url.origin === self.location.origin;

  // запросы к базе и облаку не трогаем — Firebase сам умеет офлайн
  if (!isOwnFile && !CDN_ASSETS.some((a) => e.request.url.startsWith(a.split("?")[0]))) return;

  e.respondWith((async () => {
    try {
      const resp = await fetchWithTimeout(e.request, 3000);
      if (resp && resp.ok && isOwnFile) {
        const clone = resp.clone();
        caches.open(VERSION).then((cache) => cache.put(e.request, clone));
      }
      return resp;
    } catch (err) {
      // ищем в СВОЁМ кэше: у соседних приложений есть файлы с теми же
      // именами (app.js, auth.js), и общий поиск мог бы отдать чужой
      const cache = await caches.open(VERSION);
      const cached = await cache.match(e.request);
      if (cached) return cached;
      if (e.request.mode === "navigate") {
        const fallback = await cache.match("./index.html");
        if (fallback) return fallback;
      }
      return new Response("Нет сети и нет сохранённой копии", { status: 503, statusText: "Offline" });
    }
  })());
});
