// ============================================================
// PUSH-УВЕДОМЛЕНИЯ ЧАТА.
// По умолчанию ВЫКЛЮЧЕНЫ (PUSH_ENABLED = false в settings.js).
//
// Почему нельзя просто включить: «Смена» и Досатуй живут на одном
// адресе сайта и в одном проекте Firebase. Пока у них общий appId,
// телефон хранит один push-адрес на двоих: включил уведомления
// здесь — они молча пропали в Досатуе, и наоборот. Поэтому сначала
// «Смене» выдаётся свой appId (шаг 6 в USTANOVKA.md), и только
// потом PUSH_ENABLED ставится в true.
//
// Адреса устройств хранятся в nskPush/{uid}, отдельно от Досатуя,
// чтобы его облачная функция не слала сюда свои сообщения.
// ============================================================

// счётчик непрочитанных для значка на иконке — та же база, что у sw.js
function openBadgeDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("smena-badge", 1);
    req.onupgradeneeded = () => { req.result.createObjectStore("kv"); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function setUnreadCountFg(n) {
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
// вызывается при открытии приложения — человек уже в курсе новых сообщений
async function clearUnreadBadge() {
  await setUnreadCountFg(0);
  try {
    if (navigator.clearAppBadge) await navigator.clearAppBadge();
  } catch (e) {}
}

let messaging = null;
if (PUSH_ENABLED && "serviceWorker" in navigator && "PushManager" in window) {
  try { messaging = firebase.messaging(); } catch (e) { messaging = null; }
}

function pushPermissionStatus() {
  if (!messaging || !("Notification" in window)) return "unsupported";
  return Notification.permission; // "default" | "granted" | "denied"
}

// silent=true — без сообщений об ошибке (тихое обновление подписки,
// когда разрешение уже когда-то дано)
async function enablePushNotifications(silent = false) {
  if (!messaging) {
    if (!silent) alert("Этот браузер не поддерживает push-уведомления. На iPhone сначала добавь приложение на экран «Домой».");
    return false;
  }
  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return false;
    const reg = await navigator.serviceWorker.ready; // единственный SW — sw.js
    const token = await messaging.getToken({ vapidKey: VAPID_KEY, serviceWorkerRegistration: reg });
    if (token && currentUser) {
      // перезаписываем, а не добавляем — иначе после обновлений копятся
      // старые адреса того же телефона и уведомление приходит дважды
      await db.collection("nskPush").doc(currentUser.uid).set({
        tokens: [token],
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
    }
    return true;
  } catch (e) {
    console.error("Push enable error", e);
    if (!silent) alert("Не удалось включить уведомления: " + e.message);
    return false;
  }
}

if (messaging) {
  // приложение открыто на экране — показываем сообщение полоской сверху
  messaging.onMessage((payload) => {
    if (currentTab === "chat") return; // человек и так смотрит чат
    const title = payload.data && payload.data.title;
    const body = payload.data && payload.data.body;
    toast((title ? title + ": " : "") + (body || "Новое сообщение"));
  });
}
