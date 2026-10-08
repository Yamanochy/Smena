// ============================================================
// ОЧЕРЕДЬ ОТПРАВКИ — любая смена сначала кладётся в память телефона
// (IndexedDB, вместе с уже сжатыми фото), и только потом уходит на
// сервер. Есть сеть — уйдёт за секунды; нет — дождётся и уйдёт сама.
// Ничего не теряется, даже если закрыть приложение посреди загрузки.
//
// Чем отличается от очереди в Досатуе и Табеле:
// 1. Номер записи в базе назначается заранее, ещё на телефоне.
//    Повторная отправка той же смены не создаёт дубль — а дубль
//    здесь означал бы двойную оплату.
// 2. Если сервер отказал (не сеть пропала, а именно отказ), запись
//    помечается «НЕ ПРИНЯТО» и не мешает уходить остальным. Раньше
//    одна такая запись намертво стопорила всю очередь.
// 3. Уже загруженные фото запоминаются — после обрыва связи
//    догружаются только оставшиеся.
// ============================================================

const OUTBOX_DB = "smena-outbox";
const OUTBOX_STORE = "pending";

function openOutboxDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(OUTBOX_DB, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(OUTBOX_STORE)) {
        req.result.createObjectStore(OUTBOX_STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function outboxPut(item) {
  const idb = await openOutboxDB();
  await new Promise((resolve, reject) => {
    const tx = idb.transaction(OUTBOX_STORE, "readwrite");
    tx.objectStore(OUTBOX_STORE).put(item);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

async function outboxAll() {
  try {
    const idb = await openOutboxDB();
    return await new Promise((resolve, reject) => {
      const req = idb.transaction(OUTBOX_STORE, "readonly").objectStore(OUTBOX_STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    return [];
  }
}

async function outboxDelete(id) {
  const idb = await openOutboxDB();
  await new Promise((resolve, reject) => {
    const tx = idb.transaction(OUTBOX_STORE, "readwrite");
    tx.objectStore(OUTBOX_STORE).delete(id);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

let outboxCache = [];        // всё, что лежит на телефоне (в порядке добавления)
let outboxBusy = false;      // отправка уже идёт — параллельно вторую не запускаем
let outboxSendingId = null;  // какая запись уходит прямо сейчас (для подписи в списке)

async function refreshOutbox() {
  outboxCache = (await outboxAll()).sort((a, b) => (a.queuedAt || 0) - (b.queuedAt || 0));
}

// на одном телефоне могут входить разные люди — каждый видит и
// отправляет только своё
function myOutbox() {
  return outboxCache.filter((q) => currentUser && q.uid === currentUser.uid);
}

// ---------- виды ошибок ----------
function transientError(msg) { const e = new Error(msg); e.transient = true; return e; }
function permanentError(msg) { const e = new Error(msg); e.permanent = true; return e; }

// «сеть есть, но не отвечает» — обычное дело; не ждём бесконечно
function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(transientError("timeout")), ms);
    promise.then((v) => { clearTimeout(timer); resolve(v); },
                 (err) => { clearTimeout(timer); reject(err); });
  });
}

// true — похоже на «нет связи», стоит просто подождать и повторить;
// false — сервер ответил отказом, повторять то же самое бессмысленно
function isTransientError(e) {
  if (!navigator.onLine) return true;
  if (!e) return false;
  if (e.permanent) return false;
  if (e.transient) return true;
  if (e.httpStatus) return e.httpStatus >= 500 || e.httpStatus === 429 || e.httpStatus === 408;
  const code = String(e.code || "");
  if (code === "permission-denied" || code === "not-found" || code === "invalid-argument" || code === "failed-precondition") return false;
  if (["unavailable", "deadline-exceeded", "cancelled", "aborted", "internal", "unknown", "resource-exhausted"].includes(code)) return true;
  return /failed to fetch|load failed|networkerror|network|timeout|offline|internet/i.test(String(e.message || ""));
}

function explainSendError(e, item) {
  if (e && e.permanent) return e.message;
  if (e && e.code === "permission-denied") {
    return item.mode === "create"
      ? "Сервер не принял смену. Проверь дату и часы. Если всё верно — напиши руководителю."
      : `Правку не приняли: смене больше ${EDIT_HOURS} ч или её уже поправил руководитель.`;
  }
  if (e && e.httpStatus) return `Фото не загрузилось (код ${e.httpStatus}).`;
  return "Не отправилось: " + ((e && e.message) || "неизвестная ошибка");
}

// ---------- расчёт оплаты (та же формула, что в Табеле) ----------
function accessRate(access, payType) {
  if (!access) return 0;
  return payType === "hourly" ? Number(access.hourlyRate || 0) : Number(access.shiftRate || 0);
}
function computePay(payType, rate, hours) {
  if (payType === "hourly") return Number(rate || 0) * Number(hours || 0);
  return Number(rate || 0);
}

// ---------- постановка в очередь ----------
// mode: "create" — новая смена, "update" — правка уже отправленной.
// docId — номер записи в tabelShifts (для новой выдаётся заранее).
// fields — то, что ввёл водитель: { date, equipmentId, equipmentName, payType, hours, note }.
// Ставку и сумму сюда НЕ кладём: они подставляются в момент отправки
// из свежей карточки доступа — так сумма всегда сходится с правилами базы.
async function enqueueShift({ mode, docId, fields, keepUrls, blobs }) {
  const item = {
    id: docId,
    uid: currentUser.uid,
    mode,
    fields,
    keepUrls: keepUrls || [],   // фото, которые уже лежат в облаке (при правке)
    photoBlobs: blobs || [],    // новые фото, уже сжатые
    uploadedUrls: [],           // что из новых успело загрузиться
    attempts: 0,
    error: null,
    queuedAt: Date.now(),
  };
  await outboxPut(item);
  await refreshOutbox();
  return item;
}

async function outboxRetry(id) {
  const item = outboxCache.find((q) => q.id === id);
  if (!item) return;
  item.error = null;
  await outboxPut(item);
  await refreshOutbox();
  softRender();
  flushOutbox();
}

async function outboxRemove(id) {
  await outboxDelete(id);
  await refreshOutbox();
  softRender();
}

// ---------- отправка одной записи ----------
async function sendOutboxItem(item, access) {
  const ref = db.collection("tabelShifts").doc(item.id);
  const f = item.fields;

  // прошлая попытка могла оборваться уже после того, как смена дошла
  // до сервера — тогда второй раз её писать не нужно
  if (item.mode === "create" && item.attempts > 0) {
    const cur = await withTimeout(ref.get({ source: "server" }), 15000);
    if (cur.exists) {
      if (cur.metadata && cur.metadata.hasPendingWrites) throw transientError("ещё отправляется");
      return;
    }
  }

  // фото: догружаем только те, что ещё не в облаке
  if (!Array.isArray(item.uploadedUrls)) item.uploadedUrls = [];
  for (let i = item.uploadedUrls.length; i < item.photoBlobs.length; i++) {
    const url = await uploadToCloudinary(item.photoBlobs[i]);
    item.uploadedUrls.push(url);
    await outboxPut(item);
  }
  const photoUrls = [...(item.keepUrls || []), ...item.uploadedUrls];

  item.attempts = (item.attempts || 0) + 1;
  await outboxPut(item);

  const hours = f.payType === "hourly" ? Number(f.hours) : null;

  if (item.mode === "create") {
    const rate = accessRate(access, f.payType);
    if (!rate) {
      throw permanentError(`У тебя не задана ${f.payType === "hourly" ? "почасовая" : "посменная"} ставка — напиши руководителю.`);
    }
    await withTimeout(ref.set({
      date: f.date,
      driverId: access.driverId,
      driverName: access.fullName,
      driverUid: currentUser.uid,
      equipmentId: f.equipmentId,
      equipmentName: f.equipmentName,
      payType: f.payType,
      rate,                                   // ставка «замораживается» в записи
      hours,
      computedPay: computePay(f.payType, rate, hours),
      note: f.note || "",
      photoUrls,
      createdByUid: currentUser.uid,
      createdByName: shortName(access.fullName),
      source: "driver-app",                   // по этой метке Табель показывает «внёс сам»
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    }), 20000);
    return;
  }

  // правка: ставку берём из самой записи, а не текущую — иначе простое
  // исправление заметки пересчитало бы сумму по новой ставке
  const cur = await withTimeout(ref.get({ source: "server" }), 15000);
  if (!cur.exists) throw permanentError("Этой смены уже нет — её удалили.");
  const old = cur.data();
  const rate = f.payType === old.payType ? Number(old.rate || 0) : accessRate(access, f.payType);
  if (!rate) {
    throw permanentError(`У тебя не задана ${f.payType === "hourly" ? "почасовая" : "посменная"} ставка — напиши руководителю.`);
  }
  await withTimeout(ref.update({
    date: f.date,
    equipmentId: f.equipmentId,
    equipmentName: f.equipmentName,
    payType: f.payType,
    rate,
    hours,
    computedPay: computePay(f.payType, rate, hours),
    note: f.note || "",
    photoUrls,
  }), 20000);
}

// ---------- отправка всей очереди ----------
// Безопасно вызывать сколько угодно раз: параллельные вызовы не
// пересекаются. На «нет связи» останавливается и ждёт следующего раза,
// на отказ сервера — помечает запись и идёт дальше.
async function flushOutbox() {
  if (outboxBusy) return;
  if (!currentUser || currentRole !== "driver" || !appStarted) return;
  outboxBusy = true;
  let touched = false; // экран трогаем, только если очередь реально что-то делала
  try {
    await refreshOutbox();
    const queue = myOutbox().filter((q) => !q.error);
    if (!queue.length || !navigator.onLine) return;

    // ставка нужна свежая, прямо с сервера: в кэше телефона она могла устареть
    let access = null;
    try {
      const snap = await withTimeout(db.collection("nskAccess").doc(currentUser.uid).get({ source: "server" }), 15000);
      access = snap.exists ? snap.data() : null;
    } catch (e) {
      return; // связи нет или не до нас — попробуем позже
    }
    if (!access || access.active !== true) return; // доступ отключён — экран сменит auth.js

    for (const item of queue) {
      outboxSendingId = item.id;
      touched = true;
      softRender();
      try {
        await sendOutboxItem(item, access);
        await outboxDelete(item.id);
      } catch (e) {
        if (isTransientError(e)) break;
        console.error("Смена не принята", e);
        item.error = explainSendError(e, item);
        await outboxPut(item);
      }
    }
  } finally {
    outboxSendingId = null;
    await refreshOutbox();
    outboxBusy = false;
    // ВАЖНО: без условия здесь была бы перерисовка каждые 25 секунд
    // (те самые грабли из Досатуя, когда экран дёргался сам по себе)
    if (touched) softRender();
  }
}

window.addEventListener("online", () => flushOutbox());
// на телефонах событие «online» срабатывает не всегда — подстраховка
setInterval(() => { if (navigator.onLine) flushOutbox(); }, 25000);
// вернулись в приложение из другого — самое время дослать
document.addEventListener("visibilitychange", () => { if (!document.hidden) flushOutbox(); });
