// ============================================================
// СПРАВОЧНИКИ И ТЕХНИКА — общие списки, из которых выбирают
// и водитель (в форме смены), и руководитель (в фильтрах).
//
//   Техника     — коллекция tabelEquipment, общая с Табелем. У каждой
//                 машины есть пометка «чья»: нет поля ownerId или
//                 "own" — наша, иначе id подрядчика. Чужую технику
//                 Табель у себя не показывает.
//   Заказчики и подрядчики — один документ nskConfig/lists:
//                 { customers: [{ id, name, active }], contractors: [...] }.
//                 Пока его нет, берутся стартовые списки из settings.js.
//
// В записях хранится id и название «на тот момент». Показываем всегда
// по id — свежее название из справочника: переименовал заказчика, и во
// всех старых путевых он называется по-новому.
// ============================================================

let equipmentCache = [];   // вся техника, включая убранную из списка
let listsDoc = null;       // содержимое nskConfig/lists (null — документа ещё нет)
let listsSeedTried = false;
// Справочник «известен»: документ прочитан, либо сервер подтвердил, что его
// ещё нет. Пока это не так, сохранять списки нельзя — иначе стартовые
// списки из settings.js затёрли бы настоящие, которые просто не успели прийти.
let listsKnown = false;

function resetListsState() {
  equipmentCache = []; listsDoc = null; listsSeedTried = false; listsKnown = false;
}

function subscribeLists() {
  unsubs.push(db.collection("tabelEquipment").onSnapshot((snap) => {
    equipmentCache = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "ru"));
    softRender();
  }, (err) => console.error("Техника не загрузилась", err)));

  unsubs.push(db.collection("nskConfig").doc("lists").onSnapshot((snap) => {
    listsDoc = snap.exists ? snap.data() : null;
    listsKnown = snap.exists || !snap.metadata.fromCache;
    // Руководитель открыл приложение, а документа ещё нет — создаём его из
    // стартовых списков. Так Табель и телефоны водителей видят один и тот
    // же список, а не каждый свою копию из settings.js.
    if (!snap.exists && !snap.metadata.fromCache && currentRole === "manager" && !listsSeedTried) {
      listsSeedTried = true;
      saveLists({ customers: listItems("customers"), contractors: listItems("contractors") }).catch(() => {});
    }
    softRender();
  }, () => { /* нет сети или правила ещё старые — работаем со стартовыми списками */ }));
}

// kind: "customers" | "contractors". Всегда массив { id, name, active }.
function listItems(kind) {
  const saved = listsDoc && Array.isArray(listsDoc[kind]) ? listsDoc[kind] : null;
  const base = saved || (kind === "customers" ? DEFAULT_CUSTOMERS : DEFAULT_CONTRACTORS);
  return base.filter((x) => x && x.id).map((x) => ({ id: String(x.id), name: String(x.name || ""), active: x.active !== false }));
}
function activeCustomers() { return listItems("customers").filter((x) => x.active); }
function activeContractors() { return listItems("contractors").filter((x) => x.active); }

function listNameById(kind, id, fallback) {
  const item = listItems(kind).find((x) => x.id === id);
  return item ? item.name : (fallback || "");
}
function customerName(id, fallback) {
  if (!id) return fallback || "";
  return listNameById("customers", id, fallback);
}
function contractorName(id, fallback) {
  return listNameById("contractors", id, fallback) || "Подрядчик";
}
// «Наш» или название подрядчика — для подписей и ярлыков
function ownerName(ownerId, fallback) {
  return !ownerId || ownerId === "own" ? "Наш" : contractorName(ownerId, fallback);
}

function saveLists(next) {
  if (!listsKnown) return Promise.reject(new Error("справочник ещё не загрузился — нужна сеть"));
  const clean = (arr) => arr.map((x) => ({ id: String(x.id), name: String(x.name).trim(), active: x.active !== false }));
  return db.collection("nskConfig").doc("lists").set({
    customers: clean(next.customers),
    contractors: clean(next.contractors),
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    updatedByUid: currentUser.uid,
    updatedByName: currentName,
  });
}
function newListId(prefix) {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// ---------- техника ----------
function equipmentOwnerId(e) {
  return e && e.ownerId && e.ownerId !== "own" ? e.ownerId : "own";
}
function equipmentLabel(e) {
  return String(e.name || "") + (e.plateNumber ? " — " + e.plateNumber : "");
}
function equipmentById(id) {
  return equipmentCache.find((e) => e.id === id) || null;
}

// Список для выбора техники. Сначала — техника «своего» владельца
// (нашего водителя — наша, водителя подрядчика — его подрядчика),
// остальная ниже: бывает, что человек выходит на чужой машине.
//   myOwnerId — "own" или id подрядчика; keepId — техника, которую надо
//   показать, даже если её убрали из списка (правка старой смены).
function equipmentOptionsHtml(myOwnerId, selectedId, keepId) {
  const list = equipmentCache.filter((e) => e.active !== false || e.id === keepId);
  const opt = (e) => `<option value="${escapeHtml(e.id)}" ${selectedId === e.id ? "selected" : ""}>${escapeHtml(equipmentLabel(e))}</option>`;
  const mine = list.filter((e) => equipmentOwnerId(e) === myOwnerId);
  const rest = list.filter((e) => equipmentOwnerId(e) !== myOwnerId);
  if (!mine.length || !rest.length) return list.map(opt).join("");
  const title = myOwnerId === "own" ? "Наша техника" : "Техника: " + contractorName(myOwnerId);
  return `<optgroup label="${escapeHtml(title)}">${mine.map(opt).join("")}</optgroup>`
    + `<optgroup label="Остальная техника">${rest.map(opt).join("")}</optgroup>`;
}

// keepId — заказчик из старой записи, даже если его уже скрыли
function customerOptionsHtml(selectedId, keepId) {
  return listItems("customers")
    .filter((c) => c.active || c.id === keepId)
    .map((c) => `<option value="${escapeHtml(c.id)}" ${selectedId === c.id ? "selected" : ""}>${escapeHtml(c.name)}</option>`)
    .join("");
}
