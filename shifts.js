// ============================================================
// СМЕНЫ.
// Водитель: сетка месяца, форма «Внести смену», список своих смен.
// Руководитель: все смены за месяц, только просмотр (правки — в Табеле).
//
// Смена пишется в коллекцию Табеля tabelShifts теми же полями, что
// пишет сам Табель, поэтому в Табеле она появляется сразу и считается
// как обычная. Ставка и сумма проверяются правилами базы: подставить
// себе чужую ставку или «лишние» рубли водитель не может.
// ============================================================

let equipmentCache = [];      // техника из Табеля (tabelEquipment)
let myShifts = [];            // водитель: все его смены
let shiftFormOpen = false;
let shiftFormState = null;    // { existing | null, date }
let shiftSelectedFiles = [];  // новые фото в открытой форме

let managerShifts = [];       // руководитель: смены выбранного месяца
let managerUnsub = null;
let accessRequests = [];      // руководитель: заявки (nskUsers)
let accessLinks = [];         // руководитель: выданные доступы (nskAccess)

const LAST_EQUIPMENT_KEY = "smena-last-equipment";
const LAST_PAYTYPE_KEY = "smena-last-paytype";

function resetShiftsState() {
  equipmentCache = []; myShifts = [];
  shiftFormOpen = false; shiftFormState = null; shiftSelectedFiles = [];
  managerShifts = []; accessRequests = []; accessLinks = [];
  if (managerUnsub) { try { managerUnsub(); } catch (e) {} managerUnsub = null; }
}

function closeShiftForm() {
  shiftFormOpen = false; shiftFormState = null; shiftSelectedFiles = [];
}

// ============================================================
// ВОДИТЕЛЬ
// ============================================================

function subscribeDriverData() {
  const uid = currentUser.uid;

  unsubs.push(db.collection("tabelEquipment").onSnapshot((snap) => {
    equipmentCache = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "ru"));
    softRender();
  }, (err) => console.error("Техника не загрузилась", err)));

  // Отбор по своему uid обязателен: правила базы отдают водителю только
  // его смены, и запрос «дай все» был бы отклонён целиком.
  // includeMetadataChanges — чтобы пометка «отправляется» снималась,
  // как только сервер подтвердил запись.
  unsubs.push(db.collection("tabelShifts").where("driverUid", "==", uid)
    .onSnapshot({ includeMetadataChanges: true }, (snap) => {
      myShifts = snap.docs.map((d) => ({ id: d.id, ...d.data(), _pending: d.metadata.hasPendingWrites }));
      softRender();
    }, (err) => console.error("Смены не загрузились", err)));

  if (typeof subscribeMoney === "function") subscribeMoney();
}

function shiftSortDesc(a, b) {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  const ta = a.createdAt && a.createdAt.toMillis ? a.createdAt.toMillis() : Infinity;
  const tb = b.createdAt && b.createdAt.toMillis ? b.createdAt.toMillis() : Infinity;
  return tb - ta;
}

function myShiftsOfMonth() {
  return myShifts.filter((s) => inSelectedMonth(s.date, selectedYear, selectedMonth)).sort(shiftSortDesc);
}

function driverMonthTotals() {
  const list = myShiftsOfMonth();
  return {
    count: list.length,
    hours: list.reduce((s, x) => s + (x.payType === "hourly" ? Number(x.hours || 0) : 0), 0),
    pay: list.reduce((s, x) => s + Number(x.computedPay || 0), 0),
  };
}

// самая ранняя дата, за которую водитель ещё может внести смену сам
function minShiftDate() { return addDaysISO(todayISO(), -BACKDATE_DAYS); }

function canEditShift(s) {
  if (!currentUser || s.createdByUid !== currentUser.uid) return false;
  if (s.managerEdited || s._pending) return false;
  const created = s.createdAt && s.createdAt.toMillis ? s.createdAt.toMillis() : null;
  if (!created) return false;
  // минута в запасе — часы телефона и сервера могут чуть расходиться
  return Date.now() < created + EDIT_HOURS * 3600 * 1000 - 60 * 1000;
}
function lockReason(s) {
  if (s._pending) return "Смена ещё отправляется — подожди минуту.";
  if (currentUser && s.createdByUid !== currentUser.uid) return "Эту смену внёс руководитель. Если в ней ошибка — напиши ему.";
  if (s.managerEdited) return "Смену уже поправил руководитель. Если что-то не так — напиши ему.";
  return `Править смену можно ${EDIT_HOURS} ч после внесения. Дальше — через руководителя.`;
}

function shiftPayLine(s) {
  return s.payType === "hourly"
    ? `${fmtHours(s.hours)} ч × ${fmtMoney(s.rate)}`
    : `посменно`;
}

function renderDriverShifts() {
  app.innerHTML = "";
  const wrap = el("div", "space-y-3");

  if (shiftFormOpen) {
    wrap.appendChild(renderShiftForm());
    app.appendChild(wrap);
    return;
  }

  wrap.appendChild(monthSwitcher());
  wrap.appendChild(renderMonthGrid());

  const addBtn = el("button", "w-full py-3.5 rounded-xl bg-route text-diesel font-bold text-base flex items-center justify-center gap-2 shadow-sm active:bg-route-600",
    `${ICONS.plus}<span>Внести смену</span>`);
  addBtn.id = "add-shift-btn";
  addBtn.onclick = () => openShiftForm({ date: todayISO() });
  wrap.appendChild(addBtn);

  renderOutboxCards(wrap);

  const list = myShiftsOfMonth();
  const pendingUpdates = new Set(myOutbox().filter((q) => q.mode === "update").map((q) => q.id));
  const card = el("div", "bg-white rounded-xl border border-slate-200 overflow-hidden");
  if (!list.length) {
    card.appendChild(el("div", "p-5 text-sm text-slate-400 text-center",
      `За ${MONTHS_RU[selectedMonth].toLowerCase()} смен нет. Нажми «Внести смену» или на нужный день в сетке.`));
  } else {
    const body = el("div", "divide-y divide-slate-100");
    list.forEach((s) => body.appendChild(renderShiftRow(s, pendingUpdates.has(s.id))));
    card.appendChild(body);
  }
  wrap.appendChild(card);
  app.appendChild(wrap);
}

// ---------- сетка месяца: «табель» одним взглядом ----------
// Закрашенный день — смена внесена, штриховка — можно внести,
// пунктир — смена ждёт отправки. Нажатие на день открывает форму.
function renderMonthGrid() {
  const card = el("div", "bg-white rounded-xl border border-slate-200 p-3");
  const today = todayISO();
  const minDate = minShiftDate();
  const daysInMonth = new Date(selectedYear, selectedMonth + 1, 0).getDate();
  const lead = (new Date(selectedYear, selectedMonth, 1).getDay() + 6) % 7; // неделя с понедельника

  const byDay = {}; // iso -> { hours, shiftCount, ids, pending }
  const slot = (iso) => (byDay[iso] = byDay[iso] || { hours: 0, shiftCount: 0, ids: [], pending: 0 });
  myShifts.forEach((s) => {
    if (!inSelectedMonth(s.date, selectedYear, selectedMonth)) return;
    const d = slot(s.date);
    if (s.payType === "hourly") d.hours += Number(s.hours || 0); else d.shiftCount += 1;
    d.ids.push(s.id);
  });
  const known = new Set(myShifts.map((s) => s.id));
  myOutbox().forEach((q) => {
    if (q.mode !== "create" || known.has(q.id)) return;
    if (!inSelectedMonth(q.fields.date, selectedYear, selectedMonth)) return;
    slot(q.fields.date).pending += 1;
  });

  const head = el("div", "grid grid-cols-7 gap-1 mb-1");
  ["пн", "вт", "ср", "чт", "пт", "сб", "вс"].forEach((w, i) => {
    head.appendChild(el("div", `text-center text-[10px] ${i > 4 ? "text-brick/70" : "text-slate-400"}`, w));
  });
  card.appendChild(head);

  const grid = el("div", "grid grid-cols-7 gap-1");
  for (let i = 0; i < lead; i++) grid.appendChild(el("div", ""));
  for (let day = 1; day <= daysInMonth; day++) {
    const iso = `${selectedYear}-${pad2(selectedMonth + 1)}-${pad2(day)}`;
    const info = byDay[iso];
    const future = iso > today;
    const addable = !future && iso >= minDate;
    const hasShift = info && info.ids.length > 0;

    let cls = "daycell relative rounded-lg flex items-center justify-center font-num text-xs font-semibold ";
    let label = "";
    if (hasShift) {
      cls += "bg-diesel text-white";
      label = info.hours > 0 ? fmtHours(info.hours) : "см";
    } else if (info && info.pending) {
      cls += "bg-route/15 text-route-600 border border-dashed border-route";
      label = "…";
    } else if (future) {
      cls += "text-slate-300";
    } else if (addable) {
      cls += "daycell-empty text-slate-400";
    } else {
      cls += "bg-slate-50 text-slate-300";
    }
    if (iso === today) cls += " ring-2 ring-route";

    const cell = el("button", cls);
    cell.type = "button";
    cell.innerHTML = `<span class="absolute top-0.5 left-1 text-[9px] font-medium ${hasShift ? "text-white/60" : ""}">${day}</span>${label ? `<span class="mt-2">${label}</span>` : ""}`;
    cell.setAttribute("aria-label", `${day} ${MONTHS_RU[selectedMonth]}${hasShift ? ", смена внесена" : ""}`);
    if (future) {
      cell.disabled = true;
    } else {
      cell.onclick = () => {
        if (addable) { openShiftForm({ date: iso }); return; }
        if (hasShift) {
          const row = document.getElementById("shift-row-" + info.ids[0]);
          if (row) row.scrollIntoView({ block: "center" });
          return;
        }
        toast(`Смену старше ${BACKDATE_DAYS} дней вносит руководитель — напиши ему.`);
      };
    }
    grid.appendChild(cell);
  }
  card.appendChild(grid);
  card.appendChild(el("div", "text-[11px] text-slate-400 mt-2", "В клетке — часы за день. Нажми на день, чтобы внести смену."));
  return card;
}

// ---------- записи, которые ещё не ушли на сервер ----------
function renderOutboxCards(wrap) {
  const known = new Set(myShifts.map((s) => s.id));
  myOutbox().forEach((q) => {
    // новая смена уже видна в списке ниже (база показала её до подтверждения сервера)
    if (q.mode === "create" && known.has(q.id) && !q.error) return;
    const f = q.fields;
    const sending = outboxSendingId === q.id;
    const card = el("div", `rounded-xl border border-dashed p-3 ${q.error ? "border-brick bg-brick/5" : "border-route bg-route/10"}`);
    const rate = accessRate(currentAccess, f.payType);
    const hours = f.payType === "hourly" ? Number(f.hours) : null;
    const photoCount = (q.keepUrls || []).length + (q.photoBlobs || []).length;
    let tag;
    if (q.error) tag = `<span class="inline-flex items-center gap-1 text-[10px] font-num text-brick bg-brick/10 px-1.5 py-0.5 rounded">${ICONS.alert}НЕ ПРИНЯТО</span>`;
    else if (sending) tag = `<span class="inline-flex items-center gap-1 text-[10px] font-num text-route-600 bg-route/20 px-1.5 py-0.5 rounded">${ICONS.clock}ОТПРАВЛЯЕТСЯ</span>`;
    else tag = `<span class="inline-flex items-center gap-1 text-[10px] font-num text-route-600 bg-route/20 px-1.5 py-0.5 rounded">${ICONS.clock}ЖДЁТ СЕТИ</span>`;
    card.innerHTML = `
      <div class="flex items-start justify-between gap-2">
        <div class="min-w-0">
          <div class="font-semibold text-slate-800 text-sm">${q.mode === "update" ? "Правка смены · " : ""}${fmtDay(f.date)}</div>
          <div class="text-xs text-slate-500 truncate">${escapeHtml(f.equipmentName || "—")}</div>
          <div class="text-xs text-slate-400 font-num">${f.payType === "hourly" ? `${fmtHours(hours)} ч` : "посменно"} · фото: ${photoCount}</div>
        </div>
        <div class="text-right shrink-0">
          ${q.mode === "create" && rate ? `<div class="font-bold font-num text-slate-500 text-sm">${fmtMoney(computePay(f.payType, rate, hours))}</div>` : ""}
          <div class="mt-1">${tag}</div>
        </div>
      </div>
      ${q.error ? `<div class="text-xs text-brick mt-2">${escapeHtml(q.error)}</div>` : ""}`;
    if (!sending) {
      const actions = el("div", "flex gap-2 mt-2");
      if (q.error) {
        const retry = el("button", "text-xs font-semibold text-diesel bg-white border border-slate-200 px-3 py-1.5 rounded-lg", "Отправить ещё раз");
        retry.onclick = () => outboxRetry(q.id);
        actions.appendChild(retry);
      }
      const del = el("button", "text-xs font-semibold text-brick bg-white border border-slate-200 px-3 py-1.5 rounded-lg", "Удалить");
      del.onclick = () => {
        if (confirm(q.mode === "update" ? "Отменить эту правку? Сама смена останется как была." : "Удалить эту смену? Она ещё не отправлена, восстановить будет нельзя.")) outboxRemove(q.id);
      };
      actions.appendChild(del);
      card.appendChild(actions);
    }
    wrap.appendChild(card);
  });
}

function renderShiftRow(s, hasPendingUpdate) {
  const editable = canEditShift(s) && !hasPendingUpdate;
  const row = el("div", "p-3 flex gap-3 items-center");
  row.id = "shift-row-" + s.id;

  const photos = Array.isArray(s.photoUrls) ? s.photoUrls : [];
  const thumb = el("button", "relative shrink-0 w-14 h-14 rounded-lg bg-slate-100 overflow-hidden flex items-center justify-center text-slate-300");
  thumb.type = "button";
  thumb.setAttribute("aria-label", "Фото путевого листа");
  if (photos[0]) {
    thumb.innerHTML = `<img src="${escapeHtml(photos[0])}" alt="" class="w-14 h-14 object-cover" />${photos.length > 1 ? `<span class="absolute bottom-0.5 right-0.5 bg-diesel text-white text-[9px] font-num rounded px-1">+${photos.length - 1}</span>` : ""}`;
    thumb.onclick = () => openLightbox(photos);
  } else {
    thumb.innerHTML = ICONS.cameraBig;
    thumb.disabled = true;
  }
  row.appendChild(thumb);

  let tags = "";
  if (s._pending) tags += `<span class="inline-flex items-center gap-1 text-[10px] font-num text-route-600 bg-route/15 px-1.5 py-0.5 rounded">${ICONS.clock}ОТПРАВЛЯЕТСЯ</span>`;
  if (hasPendingUpdate) tags += `<span class="inline-flex items-center gap-1 text-[10px] font-num text-route-600 bg-route/15 px-1.5 py-0.5 rounded">${ICONS.clock}ПРАВКА ЖДЁТ СЕТИ</span>`;
  if (currentUser && s.createdByUid !== currentUser.uid) tags += `<span class="text-[10px] text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">внёс руководитель</span>`;
  else if (s.managerEdited) tags += `<span class="text-[10px] text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">поправил руководитель</span>`;

  const info = el("button", "flex-1 min-w-0 text-left");
  info.type = "button";
  info.innerHTML = `
    <div class="text-sm font-semibold text-slate-800"><span class="font-num">${fmtDay(s.date)}</span></div>
    <div class="text-xs text-slate-500 truncate">${escapeHtml(s.equipmentName || "техника не указана")}</div>
    <div class="text-xs text-slate-400 font-num truncate">${shiftPayLine(s)}${s.note ? `<span class="font-sans"> · ${escapeHtml(s.note)}</span>` : ""}</div>
    ${tags ? `<div class="flex flex-wrap gap-1 mt-1">${tags}</div>` : ""}`;
  row.appendChild(info);

  const right = el("button", "shrink-0 text-right flex flex-col items-end gap-1");
  right.type = "button";
  right.innerHTML = `
    <div class="font-bold font-num text-diesel text-sm">${fmtMoney(s.computedPay)}</div>
    <div class="${editable ? "text-route-600" : "text-slate-300"}">${editable ? ICONS.pencil : ICONS.lock}</div>`;
  right.setAttribute("aria-label", editable ? "Изменить смену" : "Смена закрыта для правки");
  row.appendChild(right);

  const open = () => {
    if (editable) openShiftForm({ existing: s });
    else toast(hasPendingUpdate ? "Правка этой смены ещё ждёт отправки." : lockReason(s));
  };
  info.onclick = open;
  right.onclick = open;
  return row;
}

// ---------- форма смены ----------
function openShiftForm({ existing, date }) {
  shiftFormOpen = true;
  shiftSelectedFiles = [];
  shiftFormState = { existing: existing || null, date: existing ? existing.date : (date || todayISO()) };
  render();
  window.scrollTo(0, 0);
}

function renderShiftForm() {
  const existing = shiftFormState.existing;
  const card = el("div", "bg-white rounded-xl border border-slate-200 p-4 space-y-3");
  const today = todayISO();
  const minDate = existing && existing.date < minShiftDate() ? existing.date : minShiftDate();

  const hasHourly = accessRate(currentAccess, "hourly") > 0 || (existing && existing.payType === "hourly");
  const hasShift = accessRate(currentAccess, "shift") > 0 || (existing && existing.payType === "shift");
  const activeEquipment = equipmentCache.filter((e) => e.active !== false || (existing && e.id === existing.equipmentId));
  const lastEquipment = existing ? existing.equipmentId : localStorage.getItem(LAST_EQUIPMENT_KEY);

  let payType = existing ? existing.payType : null;
  if (!payType) {
    if (hasHourly && !hasShift) payType = "hourly";
    else if (hasShift && !hasHourly) payType = "shift";
    else if (hasHourly && hasShift) payType = localStorage.getItem(LAST_PAYTYPE_KEY) === "shift" ? "shift" : "hourly";
  }

  card.innerHTML = `
    <div class="flex items-center justify-between">
      <div class="font-bold font-display text-lg text-diesel">${existing ? "Правка смены" : "Новая смена"}</div>
      <button id="sf-cancel-top" type="button" class="text-xs text-slate-400 underline">Отмена</button>
    </div>
    ${!hasHourly && !hasShift ? `<div class="text-sm text-brick bg-brick/5 border border-brick/20 rounded-lg px-3 py-2">Тебе ещё не задали ставку, поэтому смену пока не сохранить. Напиши руководителю.</div>` : ""}
    ${!activeEquipment.length ? `<div class="text-sm text-brick bg-brick/5 border border-brick/20 rounded-lg px-3 py-2">Список техники ещё не загрузился. При первом запуске нужна сеть — открой приложение там, где есть связь.</div>` : ""}
    <label class="block text-xs text-slate-500">Дата смены
      <input id="sf-date" type="date" min="${minDate}" max="${today}" value="${shiftFormState.date}" class="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm font-num bg-white" />
    </label>
    <label class="block text-xs text-slate-500">Техника
      <select id="sf-equipment" class="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm bg-white">
        <option value="">Выбери технику</option>
        ${activeEquipment.map((e) => `<option value="${e.id}" ${lastEquipment === e.id ? "selected" : ""}>${escapeHtml(e.name)}${e.plateNumber ? " — " + escapeHtml(e.plateNumber) : ""}</option>`).join("")}
      </select>
    </label>
    <div id="sf-paytype-wrap" class="${hasHourly && hasShift ? "" : "hidden"}">
      <div class="text-xs text-slate-500 mb-1">Как оплачивается эта смена</div>
      <div class="flex gap-2">
        <button type="button" data-val="hourly" class="sf-pt-btn flex-1 py-2.5 rounded-lg text-sm font-semibold border">По часам</button>
        <button type="button" data-val="shift" class="sf-pt-btn flex-1 py-2.5 rounded-lg text-sm font-semibold border">За смену</button>
      </div>
    </div>
    <div id="sf-hours-wrap" class="hidden">
      <label class="block text-xs text-slate-500">Часы за смену
        <input id="sf-hours" type="number" inputmode="decimal" min="0.5" max="24" step="0.5" placeholder="например 10" value="${existing && existing.hours ? existing.hours : ""}" class="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2.5 text-base font-num" />
      </label>
      <div class="flex gap-2 mt-2">
        ${HOUR_CHIPS.map((h) => `<button type="button" data-h="${h}" class="sf-hour-chip flex-1 py-2 rounded-lg bg-slate-100 text-slate-600 text-sm font-num font-semibold">${h}</button>`).join("")}
      </div>
    </div>
    <div id="sf-pay-hint" class="text-sm text-slate-600 bg-slate-50 rounded-lg px-3 py-2 font-num"></div>
    <label class="block text-xs text-slate-500">Объект или заметка (необязательно)
      <input id="sf-note" maxlength="300" class="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm" placeholder="например: ул. Станционная, уборка снега" value="${existing && existing.note ? escapeHtml(existing.note) : ""}" />
    </label>
    <div>
      <div class="text-xs text-slate-500 mb-1">Фото путевого листа${PHOTO_REQUIRED ? "" : " (необязательно)"}, до ${MAX_PHOTOS} шт.</div>
      <div id="sf-thumbs" class="flex gap-2 flex-wrap mb-2"></div>
      <div class="flex gap-2">
        <button id="sf-cam" type="button" class="flex-1 py-2.5 rounded-lg bg-slate-100 text-slate-700 font-semibold text-sm flex items-center justify-center">${ICONS.camera}Камера</button>
        <button id="sf-gal" type="button" class="flex-1 py-2.5 rounded-lg bg-slate-100 text-slate-700 font-semibold text-sm">Галерея</button>
      </div>
      <input type="file" accept="image/*" capture="environment" id="sf-cam-input" class="hidden" />
      <input type="file" accept="image/*" multiple id="sf-gal-input" class="hidden" />
    </div>
    <div id="sf-error" class="text-sm text-brick hidden"></div>
    <div class="flex gap-2 pt-1">
      <button id="sf-save" type="button" class="flex-1 py-3 rounded-lg bg-diesel text-white font-semibold text-sm">${existing ? "Сохранить правку" : "Сохранить смену"}</button>
      <button id="sf-cancel" type="button" class="px-4 py-3 rounded-lg bg-slate-100 text-slate-600 font-semibold text-sm">Отмена</button>
    </div>
    ${existing ? `<button id="sf-delete" type="button" class="w-full text-xs text-brick font-semibold pt-1 flex items-center justify-center gap-1">${ICONS.trash}Удалить смену</button>` : ""}`;

  const dateInput = card.querySelector("#sf-date");
  const eqSelect = card.querySelector("#sf-equipment");
  const hoursWrap = card.querySelector("#sf-hours-wrap");
  const hoursInput = card.querySelector("#sf-hours");
  const payHint = card.querySelector("#sf-pay-hint");
  const errBox = card.querySelector("#sf-error");
  const saveBtn = card.querySelector("#sf-save");
  let keptPhotos = existing && Array.isArray(existing.photoUrls) ? existing.photoUrls.slice() : [];

  function showError(text) { errBox.textContent = text; errBox.classList.remove("hidden"); }

  // при правке ставка остаётся той, что записана в смене, — если не менялся способ оплаты
  function rateFor(pt) {
    if (existing && pt === existing.payType) return Number(existing.rate || 0);
    return accessRate(currentAccess, pt);
  }
  function updatePayUi() {
    card.querySelectorAll(".sf-pt-btn").forEach((b) => {
      const on = b.dataset.val === payType;
      b.className = "sf-pt-btn flex-1 py-2.5 rounded-lg text-sm font-semibold border " +
        (on ? "bg-diesel text-white border-diesel" : "bg-white text-slate-600 border-slate-200");
    });
    hoursWrap.classList.toggle("hidden", payType !== "hourly");
    const h = Number(hoursInput.value) || 0;
    card.querySelectorAll(".sf-hour-chip").forEach((c) => {
      const on = Number(c.dataset.h) === h;
      c.className = "sf-hour-chip flex-1 py-2 rounded-lg text-sm font-num font-semibold " + (on ? "bg-diesel text-white" : "bg-slate-100 text-slate-600");
    });
    if (!payType) { payHint.textContent = hasHourly || hasShift ? "Выбери, как оплачивается смена." : "Ставка не задана."; return; }
    const rate = rateFor(payType);
    if (payType === "hourly") {
      payHint.textContent = h ? `${fmtHours(h)} ч × ${fmtMoney(rate)} = ${fmtMoney(rate * h)}` : `Ставка ${fmtMoney(rate)} в час. Укажи часы.`;
    } else {
      payHint.textContent = `За смену: ${fmtMoney(rate)}`;
    }
  }
  card.querySelectorAll(".sf-pt-btn").forEach((b) => { b.onclick = () => { payType = b.dataset.val; updatePayUi(); }; });
  card.querySelectorAll(".sf-hour-chip").forEach((c) => { c.onclick = () => { hoursInput.value = c.dataset.h; updatePayUi(); }; });
  hoursInput.oninput = updatePayUi;
  updatePayUi();

  function totalPhotos() { return keptPhotos.length + shiftSelectedFiles.length; }
  function renderThumbs() {
    const box = card.querySelector("#sf-thumbs");
    box.innerHTML = "";
    keptPhotos.forEach((url, i) => {
      const w = el("div", "relative w-16 h-16");
      const img = el("img", "w-16 h-16 object-cover rounded-lg");
      img.src = url;
      img.onclick = () => openLightbox(keptPhotos, i);
      const del = el("button", "absolute -top-1.5 -right-1.5 w-6 h-6 rounded-full bg-brick text-white flex items-center justify-center", ICONS.close);
      del.type = "button"; del.setAttribute("aria-label", "Убрать фото");
      del.onclick = () => { keptPhotos.splice(i, 1); renderThumbs(); };
      w.appendChild(img); w.appendChild(del); box.appendChild(w);
    });
    shiftSelectedFiles.forEach((f, i) => {
      const w = el("div", "relative w-16 h-16");
      const img = el("img", "w-16 h-16 object-cover rounded-lg");
      img.src = URL.createObjectURL(f);
      const del = el("button", "absolute -top-1.5 -right-1.5 w-6 h-6 rounded-full bg-brick text-white flex items-center justify-center", ICONS.close);
      del.type = "button"; del.setAttribute("aria-label", "Убрать фото");
      del.onclick = () => { shiftSelectedFiles.splice(i, 1); renderThumbs(); };
      w.appendChild(img); w.appendChild(del); box.appendChild(w);
    });
  }
  function addFiles(files) {
    const room = MAX_PHOTOS - totalPhotos();
    if (room <= 0) { showError(`К смене можно приложить не больше ${MAX_PHOTOS} фото.`); return; }
    Array.from(files).slice(0, room).forEach((f) => shiftSelectedFiles.push(f));
    errBox.classList.add("hidden");
    renderThumbs();
  }
  renderThumbs();
  card.querySelector("#sf-cam").onclick = () => card.querySelector("#sf-cam-input").click();
  card.querySelector("#sf-gal").onclick = () => card.querySelector("#sf-gal-input").click();
  card.querySelector("#sf-cam-input").onchange = (e) => { if (e.target.files[0]) addFiles([e.target.files[0]]); e.target.value = ""; };
  card.querySelector("#sf-gal-input").onchange = (e) => { addFiles(e.target.files); e.target.value = ""; };

  const cancel = () => { closeShiftForm(); render(); };
  card.querySelector("#sf-cancel").onclick = cancel;
  card.querySelector("#sf-cancel-top").onclick = cancel;

  saveBtn.onclick = async () => {
    errBox.classList.add("hidden");
    const date = dateInput.value;
    const equipmentId = eqSelect.value;
    const equipment = equipmentCache.find((e) => e.id === equipmentId);
    const hours = Number(hoursInput.value) || 0;

    if (!date) return showError("Укажи дату смены.");
    if (date > today) return showError("Смену нельзя внести наперёд — выбери сегодняшнюю или прошедшую дату.");
    if (date < minDate) return showError(`Смену старше ${BACKDATE_DAYS} дней вносит руководитель — напиши ему.`);
    if (!equipment) return showError("Выбери технику.");
    if (!payType) return showError("Выбери, как оплачивается смена.");
    if (!rateFor(payType)) return showError(`У тебя не задана ${payType === "hourly" ? "почасовая" : "посменная"} ставка — напиши руководителю.`);
    if (payType === "hourly") {
      if (!hours || hours <= 0) return showError("Укажи, сколько часов отработал.");
      if (hours > 24) return showError("В смене не может быть больше 24 часов.");
      if (Math.round(hours * 2) !== hours * 2) return showError("Часы указывай с шагом полчаса: 8, 8,5, 9…");
    }
    if (PHOTO_REQUIRED && totalPhotos() === 0) return showError("Приложи фото путевого листа — без него смена не сохраняется.");

    // защита от двойного внесения: та же дата и та же техника
    const dupSynced = myShifts.some((s) => s.date === date && s.equipmentId === equipmentId && (!existing || s.id !== existing.id));
    const dupQueued = myOutbox().some((q) => q.mode === "create" && q.fields.date === date && q.fields.equipmentId === equipmentId);
    if ((dupSynced || dupQueued) && !confirm(`За ${fmtRU(parseISO(date))} на «${equipment.name}» смена уже внесена. Точно добавить ещё одну?`)) return;

    saveBtn.disabled = true;
    const blobs = [];
    try {
      for (let i = 0; i < shiftSelectedFiles.length; i++) {
        saveBtn.textContent = `Готовлю фото ${i + 1}/${shiftSelectedFiles.length}…`;
        blobs.push(await resizeImage(shiftSelectedFiles[i]));
      }
    } catch (e) {
      saveBtn.disabled = false; saveBtn.textContent = existing ? "Сохранить правку" : "Сохранить смену";
      return showError("Не получилось обработать фото: " + e.message);
    }

    try {
      saveBtn.textContent = "Сохраняю…";
      await enqueueShift({
        mode: existing ? "update" : "create",
        // номер записи выдаём сразу — повторная отправка не создаст дубль
        docId: existing ? existing.id : db.collection("tabelShifts").doc().id,
        fields: {
          date, equipmentId, equipmentName: equipment.name, payType,
          hours: payType === "hourly" ? hours : null,
          note: card.querySelector("#sf-note").value.trim(),
        },
        keepUrls: keptPhotos,
        blobs,
      });
    } catch (e) {
      saveBtn.disabled = false; saveBtn.textContent = existing ? "Сохранить правку" : "Сохранить смену";
      return showError("Не получилось сохранить на телефоне: " + e.message + ". Проверь, есть ли свободная память.");
    }

    localStorage.setItem(LAST_EQUIPMENT_KEY, equipmentId);
    localStorage.setItem(LAST_PAYTYPE_KEY, payType);
    closeShiftForm();
    // показываем месяц, в который попала смена
    const d = parseISO(date);
    selectedMonth = d.getMonth(); selectedYear = d.getFullYear();
    render();
    toast(navigator.onLine ? "Смена сохранена, отправляю." : "Смена сохранена на телефоне. Уйдёт сама, когда появится сеть.");
    flushOutbox();
  };

  if (existing) {
    card.querySelector("#sf-delete").onclick = () => {
      if (!confirm(`Удалить смену за ${fmtRU(parseISO(existing.date))}? Начисление за неё пропадёт.`)) return;
      db.collection("tabelShifts").doc(existing.id).delete()
        .catch((e) => toast("Не удалось удалить: " + (e.code === "permission-denied" ? "срок правки вышел или смену поправил руководитель." : e.message), true));
      closeShiftForm();
      render();
    };
  }

  return card;
}

// ============================================================
// РУКОВОДИТЕЛЬ — только просмотр
// ============================================================

function subscribeManagerData() {
  subscribeManagerMonth();
  unsubs.push(db.collection("nskUsers").onSnapshot((snap) => {
    accessRequests = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    softRender();
  }, (err) => console.error(err)));
  unsubs.push(db.collection("nskAccess").onSnapshot((snap) => {
    accessLinks = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    softRender();
  }, (err) => console.error(err)));
}

// читаем только выбранный месяц — не всю историю
function subscribeManagerMonth() {
  if (managerUnsub) { try { managerUnsub(); } catch (e) {} managerUnsub = null; }
  managerShifts = [];
  const prefix = `${selectedYear}-${pad2(selectedMonth + 1)}-`;
  managerUnsub = db.collection("tabelShifts")
    .where("date", ">=", prefix + "01").where("date", "<=", prefix + "31")
    .onSnapshot((snap) => {
      managerShifts = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort(shiftSortDesc);
      softRender();
    }, (err) => console.error("Смены не загрузились", err));
}

function managerTotals() {
  const today = todayISO();
  return {
    count: managerShifts.length,
    pay: managerShifts.reduce((s, x) => s + Number(x.computedPay || 0), 0),
    today: managerShifts.filter((x) => x.date === today).length,
  };
}

function renderManagerShifts() {
  app.innerHTML = "";
  const wrap = el("div", "space-y-3");
  wrap.appendChild(monthSwitcher());

  // кто зарегистрировался, но ещё не привязан к карточке водителя
  const linked = new Set(accessLinks.map((l) => l.id));
  const waiting = accessRequests.filter((r) => !linked.has(r.id));
  if (waiting.length) {
    const box = el("div", "rounded-xl border border-route bg-route/10 p-3");
    box.innerHTML = `
      <div class="text-sm font-semibold text-diesel">${waiting.length} ${plural(waiting.length, "водитель ждёт", "водителя ждут", "водителей ждут")} доступа</div>
      <div class="text-xs text-slate-600 mt-1 space-y-0.5">${waiting.map((r) => `<div>${escapeHtml(r.name || "без имени")}${r.phone ? " · " + escapeHtml(r.phone) : ""} · ${escapeHtml(r.email || "")}</div>`).join("")}</div>
      <div class="text-xs text-slate-500 mt-2">Доступ выдаётся в Табеле: Водители → «Изменить данные» → «Доступ в приложение „Смена“».</div>
      <a href="${TABEL_URL}" target="_blank" rel="noopener" class="inline-block mt-2 text-xs font-semibold text-white bg-diesel px-3 py-1.5 rounded-lg">Открыть Табель</a>`;
    wrap.appendChild(box);
  }

  const note = el("div", "bg-white rounded-xl border border-slate-200 p-3 text-xs text-slate-500 flex items-center justify-between gap-3");
  note.innerHTML = `<span>Здесь только просмотр. Править смены, выдавать авансы и считать зарплату — в Табеле.</span><a href="${TABEL_URL}" target="_blank" rel="noopener" class="shrink-0 font-semibold text-diesel underline">Табель</a>`;
  wrap.appendChild(note);

  const card = el("div", "bg-white rounded-xl border border-slate-200 overflow-hidden");
  if (!managerShifts.length) {
    card.appendChild(el("div", "p-5 text-sm text-slate-400 text-center", `За ${MONTHS_RU[selectedMonth].toLowerCase()} смен пока нет.`));
  } else {
    let lastDate = "";
    managerShifts.forEach((s) => {
      if (s.date !== lastDate) {
        lastDate = s.date;
        const dayList = managerShifts.filter((x) => x.date === s.date);
        const daySum = dayList.reduce((a, x) => a + Number(x.computedPay || 0), 0);
        card.appendChild(el("div", "px-3 py-1.5 bg-slate-50 border-t border-slate-100 first:border-t-0 flex items-center justify-between text-[11px] text-slate-500 font-num",
          `<span class="font-semibold">${fmtDay(s.date)}</span><span>${dayList.length} ${plural(dayList.length, "смена", "смены", "смен")}, ${fmtMoney(daySum)}</span>`));
      }
      const row = el("div", "p-3 flex gap-3 items-center border-t border-slate-100");
      const photos = Array.isArray(s.photoUrls) ? s.photoUrls : [];
      const thumb = el("button", "relative shrink-0 w-12 h-12 rounded-lg bg-slate-100 overflow-hidden flex items-center justify-center text-slate-300");
      thumb.type = "button";
      if (photos[0]) {
        thumb.innerHTML = `<img src="${escapeHtml(photos[0])}" alt="" class="w-12 h-12 object-cover" />${photos.length > 1 ? `<span class="absolute bottom-0.5 right-0.5 bg-diesel text-white text-[9px] font-num rounded px-1">+${photos.length - 1}</span>` : ""}`;
        thumb.onclick = () => openLightbox(photos);
      } else {
        thumb.innerHTML = ICONS.cameraBig; thumb.disabled = true;
      }
      row.appendChild(thumb);
      const self = s.source === "driver-app";
      const info = el("div", "flex-1 min-w-0");
      info.innerHTML = `
        <div class="text-sm font-semibold text-slate-800 truncate">${escapeHtml(s.driverName || "—")}</div>
        <div class="text-xs text-slate-500 truncate">${escapeHtml(s.equipmentName || "техника не указана")}${s.note ? " · " + escapeHtml(s.note) : ""}</div>
        <div class="text-xs text-slate-400 font-num">${shiftPayLine(s)} <span class="font-sans text-[10px] ${self ? "text-shift" : "text-slate-400"}">· ${self ? "внёс сам" : "внёс руководитель"}${s.managerEdited ? ", поправлено" : ""}</span></div>`;
      row.appendChild(info);
      row.appendChild(el("div", "shrink-0 font-bold font-num text-diesel text-sm", fmtMoney(s.computedPay)));
      card.appendChild(row);
    });
  }
  wrap.appendChild(card);
  app.appendChild(wrap);
}
