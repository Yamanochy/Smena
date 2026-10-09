// ============================================================
// СМЕНЫ — экран водителя: сетка месяца, форма «Внести смену»,
// список своих смен.
//
// Наш водитель пишет в tabelShifts (коллекция Табеля): смена сразу видна
// в Табеле и считается как обычная. Ставка и сумма проверяются правилами
// базы — подставить себе чужую ставку или «лишние» рубли нельзя.
// Водитель подрядчика пишет в nskWaybills: те же дата, техника, заказчик
// и часы, но без ставки и суммы — денег он в приложении не видит.
//
// Читаем обе коллекции: если руководитель поменял пометку «чей
// водитель», прежние записи человека никуда не пропадают.
// ============================================================

let myOwnShifts = [];         // записи из tabelShifts
let myWaybills = [];          // записи из nskWaybills
let myShifts = [];            // всё вместе
let shiftFormOpen = false;
let shiftFormState = null;    // { existing | null, date }
let shiftSelectedFiles = [];  // новые фото в открытой форме

const LAST_EQUIPMENT_KEY = "smena-last-equipment";
const LAST_PAYTYPE_KEY = "smena-last-paytype";

function resetShiftsState() {
  myOwnShifts = []; myWaybills = []; myShifts = [];
  shiftFormOpen = false; shiftFormState = null; shiftSelectedFiles = [];
}

function closeShiftForm() {
  shiftFormOpen = false; shiftFormState = null; shiftSelectedFiles = [];
}

function subscribeDriverData() {
  const uid = currentUser.uid;
  // Отбор по своему uid обязателен: правила базы отдают водителю только
  // его записи, и запрос «дай все» был бы отклонён целиком.
  // includeMetadataChanges — чтобы пометка «отправляется» снималась,
  // как только сервер подтвердил запись.
  const listen = (col, assign) => {
    unsubs.push(db.collection(col).where("driverUid", "==", uid)
      .onSnapshot({ includeMetadataChanges: true }, (snap) => {
        assign(snap.docs.map((d) => ({ id: d.id, ...d.data(), _col: col, _pending: d.metadata.hasPendingWrites })));
        myShifts = myOwnShifts.concat(myWaybills);
        softRender();
      }, (err) => console.error("Смены не загрузились (" + col + ")", err)));
  };
  listen(COL_OWN, (list) => { myOwnShifts = list; });
  listen(COL_CONTRACTOR, (list) => { myWaybills = list; });

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

// часы записи: у почасовой смены и у путевого подрядчика — число, у посменной — нет
function shiftHours(s) {
  if (s._col === COL_OWN && s.payType !== "hourly") return 0;
  return Number(s.hours || 0);
}

function driverMonthTotals() {
  const list = myShiftsOfMonth();
  return {
    count: list.length,
    hours: list.reduce((sum, x) => sum + shiftHours(x), 0),
    pay: list.reduce((sum, x) => sum + Number(x.computedPay || 0), 0),
  };
}

// «сегодня»: done — смена за сегодня на сервере, wait — ещё не ушла, none — нет
function driverTodayState() {
  const today = todayISO();
  const mine = myShifts.filter((s) => s.date === today);
  if (mine.some((s) => !s._pending)) return "done";
  if (mine.length) return "wait";
  if (myOutbox().some((q) => q.mode === "create" && q.fields.date === today)) return "wait";
  return "none";
}

// самая ранняя дата, за которую водитель ещё может внести смену сам
function minShiftDate() { return addDaysISO(todayISO(), -BACKDATE_DAYS); }

// Смена лежит в Табеле, а человека с тех пор перевели к подрядчику: в
// зарплатных записях он больше ничего не меняет (так же решают правила базы).
function lockedInTabel(s) {
  return s._col === COL_OWN && isContractorAccess(currentAccess);
}

function canEditShift(s) {
  if (!currentUser || s.createdByUid !== currentUser.uid) return false;
  if (s.managerEdited || s._pending) return false;
  if (lockedInTabel(s)) return false;
  const created = s.createdAt && s.createdAt.toMillis ? s.createdAt.toMillis() : null;
  if (!created) return false;
  // минута в запасе — часы телефона и сервера могут чуть расходиться
  return Date.now() < created + EDIT_HOURS * 3600 * 1000 - 60 * 1000;
}
function lockReason(s) {
  if (s._pending) return "Смена ещё отправляется — подожди минуту.";
  if (currentUser && s.createdByUid !== currentUser.uid) return "Эту смену внёс руководитель. Если в ней ошибка — напиши ему.";
  if (s.managerEdited) return "Смену уже поправил руководитель. Если что-то не так — напиши ему.";
  if (lockedInTabel(s)) return "Эту смену ты внёс, когда числился нашим водителем, — она в Табеле. Поправить её может только руководитель.";
  return `Править смену можно ${EDIT_HOURS} ч после внесения. Дальше — через руководителя.`;
}

// «10 ч» или «смена» — крупная цифра справа в строке
function shiftAmountText(s) {
  const h = shiftHours(s);
  return h ? `${fmtHours(h)} ч` : "смена";
}

function renderDriverShifts() {
  app.innerHTML = "";
  const wrap = el("div", "space-y-3");

  if (shiftFormOpen) {
    wrap.appendChild(renderShiftForm());
    app.appendChild(wrap);
    return;
  }

  // подсказки про установку на телефон (install.js): сверху — только просьба
  // открыть страницу в обычном браузере, остальное — внизу, под списком
  const hasInstall = typeof installSlot === "function";
  if (hasInstall) wrap.appendChild(installSlot("inapp", "top"));

  wrap.appendChild(renderMonthGrid());

  const addBtn = el("button", "btn btn-gold btn-block", `${ICONS.plus}<span>Внести смену</span>`);
  addBtn.type = "button";
  addBtn.id = "add-shift-btn";
  addBtn.onclick = () => openShiftForm({ date: todayISO() });
  wrap.appendChild(addBtn);

  renderOutboxCards(wrap);

  const list = myShiftsOfMonth();
  const pendingUpdates = new Set(myOutbox().filter((q) => q.mode === "update").map((q) => q.id));
  wrap.appendChild(el("div", "eyebrow pt-2", `Смены за ${MONTHS_RU[selectedMonth].toLowerCase()}`));
  if (!list.length) {
    wrap.appendChild(el("div", "card empty",
      "Смен пока нет. Нажми «Внести смену» или на нужный день в сетке."));
  } else {
    const box = el("div", "space-y-2");
    box.id = "shift-list";
    list.forEach((s) => box.appendChild(renderShiftRow(s, pendingUpdates.has(s.id))));
    wrap.appendChild(box);
  }
  if (hasInstall) wrap.appendChild(installSlot("inapp", "bottom"));
  app.appendChild(wrap);
}

// ---------- сетка месяца: «табель» одним взглядом ----------
// Светлая клетка — смена внесена, штриховка — можно внести,
// пунктир — смена ждёт отправки. Нажатие на день открывает форму.
function renderMonthGrid() {
  const card = el("div", "card p-3");
  card.appendChild(monthSwitcher());

  const today = todayISO();
  const minDate = minShiftDate();
  const daysInMonth = new Date(selectedYear, selectedMonth + 1, 0).getDate();
  const lead = (new Date(selectedYear, selectedMonth, 1).getDay() + 6) % 7; // неделя с понедельника

  const byDay = {}; // iso -> { hours, shiftCount, ids, pending }
  const slot = (iso) => (byDay[iso] = byDay[iso] || { hours: 0, shiftCount: 0, ids: [], pending: 0 });
  myShifts.forEach((s) => {
    if (!inSelectedMonth(s.date, selectedYear, selectedMonth)) return;
    const d = slot(s.date);
    const h = shiftHours(s);
    if (h) d.hours += h; else d.shiftCount += 1;
    d.ids.push(s.id);
  });
  const known = new Set(myShifts.map((s) => s.id));
  myOutbox().forEach((q) => {
    if (q.mode !== "create" || known.has(q.id)) return;
    if (!inSelectedMonth(q.fields.date, selectedYear, selectedMonth)) return;
    slot(q.fields.date).pending += 1;
  });

  const head = el("div", "grid grid-cols-7 gap-1 mt-3 mb-1");
  ["пн", "вт", "ср", "чт", "пт", "сб", "вс"].forEach((w, i) => {
    head.appendChild(el("div", `text-center text-[10px] uppercase tracking-wider ${i > 4 ? "text-flare/70" : "text-mute"}`, w));
  });
  card.appendChild(head);

  const grid = el("div", "grid grid-cols-7 gap-1");
  grid.id = "month-grid";
  for (let i = 0; i < lead; i++) grid.appendChild(el("div", ""));
  for (let day = 1; day <= daysInMonth; day++) {
    const iso = `${selectedYear}-${pad2(selectedMonth + 1)}-${pad2(day)}`;
    const info = byDay[iso];
    const future = iso > today;
    const addable = !future && iso >= minDate;
    const hasShift = info && info.ids.length > 0;

    let cls = "daycell ";
    let label = "";
    if (hasShift) {
      cls += "day-lit";
      label = info.hours > 0 ? fmtHours(info.hours) : "см";
    } else if (info && info.pending) {
      cls += "day-wait";
      label = "…";
    } else if (future) {
      cls += "day-future";
    } else if (addable) {
      cls += "day-open";
    } else {
      cls += "day-closed";
    }
    if (iso === today) cls += " day-today";

    const cell = el("button", cls);
    cell.type = "button";
    cell.dataset.day = iso;
    cell.innerHTML = `<span class="dn">${day}</span>${label ? `<span class="dv">${label}</span>` : ""}`;
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
  card.appendChild(el("div", "text-xs t-mute mt-2", "В клетке — часы за день. Нажми на день, чтобы внести смену."));
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
    const card = el("div", `card p-3 ${q.error ? "card-bad" : "card-wait"}`);
    card.dataset.outbox = q.id;
    const hours = Number(f.hours) > 0 ? Number(f.hours) : null;
    const rate = isContractorAccess(currentAccess) ? 0 : accessRate(currentAccess, f.payType);
    const photoCount = (q.keepUrls || []).length + (q.photoBlobs || []).length;
    let tag;
    if (q.error) tag = `<span class="tag tag-bad">${ICONS.alert}Не принято</span>`;
    else if (sending) tag = `<span class="tag tag-wait">${ICONS.clock}Отправляется</span>`;
    else tag = `<span class="tag tag-wait">${ICONS.clock}Ждёт сети</span>`;
    const line2 = [f.customerName, f.note].filter(Boolean).map(escapeHtml).join(" · ");
    card.innerHTML = `
      <div class="flex items-center">
        ${dateboxHtml(f.date)}
        <div class="flex-1 min-w-0">
          <div class="t-strong truncate">${q.mode === "update" ? "Правка: " : ""}${escapeHtml(f.equipmentName || "—")}</div>
          ${line2 ? `<div class="text-[13px] t-soft truncate">${line2}</div>` : ""}
          <div class="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1">${tag}<span class="tag tag-mute">фото: ${photoCount}</span></div>
        </div>
        <div class="shrink-0 text-right pl-2">
          <div class="num font-bold text-[17px] leading-tight">${hours ? fmtHours(hours) + " ч" : "смена"}</div>
          ${q.mode === "create" && rate ? `<div class="num text-xs t-soft">${fmtMoney(computePay(f.payType, rate, hours))}</div>` : ""}
        </div>
      </div>
      ${q.error ? `<div class="text-[13px] t-bad mt-2">${escapeHtml(q.error)}</div>` : ""}`;
    if (!sending) {
      const actions = el("div", "flex gap-2 mt-3");
      if (q.error) {
        const retry = el("button", "btn btn-ghost btn-sm", "Отправить ещё раз");
        retry.type = "button";
        retry.onclick = () => outboxRetry(q.id);
        actions.appendChild(retry);
      }
      const del = el("button", "btn btn-danger btn-sm", "Удалить");
      del.type = "button";
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
  const contractor = s._col === COL_CONTRACTOR;
  const row = el("div", `card p-3 flex items-center ${editable ? "card-accent" : ""}`);
  row.id = "shift-row-" + s.id;
  row.insertAdjacentHTML("beforeend", dateboxHtml(s.date));

  const photos = Array.isArray(s.photoUrls) ? s.photoUrls : [];
  let tags = "";
  if (s._pending) tags += `<span class="tag tag-wait">${ICONS.clock}Отправляется</span>`;
  else if (hasPendingUpdate) tags += `<span class="tag tag-wait">${ICONS.clock}Правка ждёт сети</span>`;
  else tags += `<span class="tag tag-ok">${ICONS.check}${contractor ? "В реестре" : "В табеле"}</span>`;
  if (currentUser && s.createdByUid !== currentUser.uid) tags += `<span class="tag tag-mute">внёс руководитель</span>`;
  else if (s.managerEdited) tags += `<span class="tag tag-mute">поправил руководитель</span>`;

  const customer = customerName(s.customerId, s.customerName);
  const line2 = [customer, s.note].filter(Boolean).map(escapeHtml).join(" · ");

  const info = el("button", "flex-1 min-w-0 text-left");
  info.type = "button";
  info.dataset.open = s.id;
  info.innerHTML = `
    <div class="t-strong truncate">${escapeHtml(s.equipmentName || "техника не указана")}</div>
    ${line2 ? `<div class="text-[13px] t-soft truncate">${line2}</div>` : ""}
    <div class="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1">${tags}</div>`;
  row.appendChild(info);

  const right = el("div", "shrink-0 text-right pl-2 flex flex-col items-end gap-1");
  right.innerHTML = `
    <div class="num font-bold text-[17px] leading-tight">${shiftAmountText(s)}</div>
    ${contractor ? "" : `<div class="num text-xs t-soft">${fmtMoney(s.computedPay)}</div>`}`;
  const tools = el("div", "flex items-center gap-2 mt-0.5");
  if (photos.length) {
    const ph = el("button", "tag tag-mute", `${ICONS.camera}<span>${photos.length}</span>`);
    ph.type = "button";
    ph.setAttribute("aria-label", "Фото путевого листа");
    ph.onclick = () => openLightbox(photos);
    tools.appendChild(ph);
  }
  const edit = el("button", editable ? "t-gold" : "t-mute", editable ? ICONS.pencil : ICONS.lock);
  edit.type = "button";
  edit.setAttribute("aria-label", editable ? "Изменить смену" : "Смена закрыта для правки");
  tools.appendChild(edit);
  right.appendChild(tools);
  row.appendChild(right);

  const open = () => {
    if (editable) openShiftForm({ existing: s });
    else toast(hasPendingUpdate ? "Правка этой смены ещё ждёт отправки." : lockReason(s));
  };
  info.onclick = open;
  edit.onclick = open;
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
  // правим запись там, где она лежит; новую вносим по тому, чей водитель сейчас
  const contractor = existing ? existing._col === COL_CONTRACTOR : isContractorAccess(currentAccess);
  const card = el("div", "card p-4 space-y-4");
  card.id = "shift-form";
  const today = todayISO();
  const minDate = existing && existing.date < minShiftDate() ? existing.date : minShiftDate();

  const hasHourly = !contractor && (accessRate(currentAccess, "hourly") > 0 || (existing && existing.payType === "hourly"));
  const hasShift = !contractor && (accessRate(currentAccess, "shift") > 0 || (existing && existing.payType === "shift"));
  const myOwner = contractor ? (existing ? existing.contractorId : currentAccess.contractorId) || "own" : "own";
  const lastEquipment = existing ? existing.equipmentId : localStorage.getItem(LAST_EQUIPMENT_KEY);
  const equipmentOptions = equipmentOptionsHtml(myOwner, lastEquipment, existing ? existing.equipmentId : null);

  // заказчик: кнопками, пока их немного, — выбрать одним нажатием
  const keepCustomer = existing ? existing.customerId : null;
  const customers = listItems("customers").filter((c) => c.active || c.id === keepCustomer);
  let customerId = existing ? (existing.customerId || "") : "";
  const customerAsChips = customers.length > 0 && customers.length <= 6;

  let payType = contractor ? null : (existing ? existing.payType : null);
  if (!contractor && !payType) {
    if (hasHourly && !hasShift) payType = "hourly";
    else if (hasShift && !hasHourly) payType = "shift";
    else if (hasHourly && hasShift) payType = localStorage.getItem(LAST_PAYTYPE_KEY) === "shift" ? "shift" : "hourly";
  }

  card.innerHTML = `
    <div class="flex items-center justify-between">
      <div class="title">${existing ? "Правка смены" : "Новая смена"}</div>
      <button id="sf-cancel-top" type="button" class="btn btn-quiet btn-sm -mr-2">Отмена</button>
    </div>
    ${!contractor && !hasHourly && !hasShift ? `<div class="note note-bad">Тебе ещё не задали ставку, поэтому смену пока не сохранить. Напиши руководителю.</div>` : ""}
    ${!equipmentOptions ? `<div class="note note-bad">Список техники ещё не загрузился. При первом запуске нужна сеть — открой приложение там, где есть связь.</div>` : ""}
    <label class="lbl">Дата смены
      <input id="sf-date" type="date" min="${minDate}" max="${today}" value="${shiftFormState.date}" class="field num" />
    </label>
    <label class="lbl">Техника
      <select id="sf-equipment" class="field">
        <option value="">Выбери технику</option>
        ${equipmentOptions}
      </select>
    </label>
    ${customers.length ? `
    <div>
      <div class="lbl" id="sf-customer-label">На кого работал</div>
      ${customerAsChips
        ? `<div id="sf-customer-chips" class="grid grid-cols-2 gap-2 mt-1.5" role="radiogroup" aria-labelledby="sf-customer-label">
            ${customers.map((c) => `<button type="button" role="radio" data-id="${escapeHtml(c.id)}" class="sf-cust chip w-full whitespace-normal py-2 leading-tight">${escapeHtml(c.name)}</button>`).join("")}
           </div>`
        : `<select id="sf-customer" class="field" aria-labelledby="sf-customer-label">
            <option value="">Выбери заказчика</option>
            ${customerOptionsHtml(customerId, keepCustomer)}
           </select>`}
    </div>` : ""}
    <div id="sf-paytype-wrap" class="${hasHourly && hasShift ? "" : "hidden"}">
      <div class="lbl">Как оплачивается эта смена</div>
      <div class="seg mt-1.5">
        <button type="button" data-val="hourly" class="sf-pt-btn chip">По часам</button>
        <button type="button" data-val="shift" class="sf-pt-btn chip">За смену</button>
      </div>
    </div>
    <div id="sf-hours-wrap" class="hidden">
      <label class="lbl">Часы за смену
        <input id="sf-hours" type="number" inputmode="decimal" min="0.5" max="24" step="0.5" placeholder="например 10" value="${existing && existing.hours ? existing.hours : ""}" class="field num" />
      </label>
      <div class="seg mt-2">
        ${HOUR_CHIPS.map((h) => `<button type="button" data-h="${h}" class="sf-hour-chip chip num">${h}</button>`).join("")}
      </div>
    </div>
    <div id="sf-pay-hint" class="note num"></div>
    <label class="lbl">Объект или заметка (необязательно)
      <input id="sf-note" maxlength="300" class="field" placeholder="например: ул. Станционная, уборка снега" value="${existing && existing.note ? escapeHtml(existing.note) : ""}" />
    </label>
    <div>
      <div class="lbl">Фото путевого листа${PHOTO_REQUIRED ? "" : " (необязательно)"}, до ${MAX_PHOTOS} шт.</div>
      <div id="sf-thumbs" class="flex gap-2 flex-wrap mt-2 empty:hidden"></div>
      <div class="seg mt-2">
        <button id="sf-cam" type="button" class="btn btn-ghost">${ICONS.camera}<span>Камера</span></button>
        <button id="sf-gal" type="button" class="btn btn-ghost">Галерея</button>
      </div>
      <input type="file" accept="image/*" capture="environment" id="sf-cam-input" class="hidden" />
      <input type="file" accept="image/*" multiple id="sf-gal-input" class="hidden" />
    </div>
    <div id="sf-error" class="note note-bad hidden" role="alert"></div>
    <div class="flex gap-2">
      <button id="sf-save" type="button" class="btn btn-gold flex-1">${existing ? "Сохранить правку" : "Сохранить смену"}</button>
      <button id="sf-cancel" type="button" class="btn btn-ghost">Отмена</button>
    </div>
    ${existing ? `<button id="sf-delete" type="button" class="btn btn-danger btn-sm btn-block">${ICONS.trash}<span>Удалить смену</span></button>` : ""}`;

  const dateInput = card.querySelector("#sf-date");
  const eqSelect = card.querySelector("#sf-equipment");
  const hoursWrap = card.querySelector("#sf-hours-wrap");
  const hoursInput = card.querySelector("#sf-hours");
  const payHint = card.querySelector("#sf-pay-hint");
  const errBox = card.querySelector("#sf-error");
  const saveBtn = card.querySelector("#sf-save");
  const saveLabel = existing ? "Сохранить правку" : "Сохранить смену";
  let keptPhotos = existing && Array.isArray(existing.photoUrls) ? existing.photoUrls.slice() : [];

  function showError(text) { errBox.textContent = text; errBox.classList.remove("hidden"); errBox.scrollIntoView({ block: "nearest" }); }

  // заказчик
  const custSelect = card.querySelector("#sf-customer");
  function paintCustomer() {
    card.querySelectorAll(".sf-cust").forEach((b) => {
      const on = b.dataset.id === customerId;
      b.classList.toggle("chip-on", on);
      b.setAttribute("aria-checked", on ? "true" : "false");
    });
  }
  card.querySelectorAll(".sf-cust").forEach((b) => { b.onclick = () => { customerId = b.dataset.id; paintCustomer(); errBox.classList.add("hidden"); }; });
  if (custSelect) custSelect.onchange = () => { customerId = custSelect.value; };
  paintCustomer();

  // при правке ставка остаётся той, что записана в смене, — если не менялся способ оплаты
  function rateFor(pt) {
    if (existing && pt === existing.payType) return Number(existing.rate || 0);
    return accessRate(currentAccess, pt);
  }
  const needsHours = () => contractor || payType === "hourly";
  function updatePayUi() {
    card.querySelectorAll(".sf-pt-btn").forEach((b) => b.classList.toggle("chip-on", b.dataset.val === payType));
    hoursWrap.classList.toggle("hidden", !needsHours());
    const h = Number(hoursInput.value) || 0;
    card.querySelectorAll(".sf-hour-chip").forEach((c) => c.classList.toggle("chip-on", Number(c.dataset.h) === h));
    if (contractor) {
      const who = contractorName(myOwner === "own" ? "" : myOwner, existing ? existing.contractorName : currentAccess.contractorName);
      payHint.classList.remove("num");
      payHint.textContent = `Путевой пойдёт в реестр подрядчика: ${who}.`;
      return;
    }
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
    const add = (src, onDel, onOpen) => {
      const w = el("div", "relative w-16 h-16");
      const img = el("img", "w-16 h-16 object-cover rounded-lg border border-rivet");
      img.src = src; img.alt = "";
      if (onOpen) img.onclick = onOpen;
      const del = el("button", "absolute -top-1.5 -right-1.5 w-6 h-6 rounded-full bg-flare text-white flex items-center justify-center", ICONS.close);
      del.type = "button"; del.setAttribute("aria-label", "Убрать фото");
      del.onclick = onDel;
      w.appendChild(img); w.appendChild(del); box.appendChild(w);
    };
    keptPhotos.forEach((url, i) => add(url, () => { keptPhotos.splice(i, 1); renderThumbs(); }, () => openLightbox(keptPhotos, i)));
    shiftSelectedFiles.forEach((f, i) => add(URL.createObjectURL(f), () => { shiftSelectedFiles.splice(i, 1); renderThumbs(); }));
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
    const equipment = equipmentById(equipmentId);
    const hours = Number(hoursInput.value) || 0;
    const customer = customers.find((c) => c.id === customerId) || null;

    if (!date) return showError("Укажи дату смены.");
    if (date > today) return showError("Смену нельзя внести наперёд — выбери сегодняшнюю или прошедшую дату.");
    if (date < minDate) return showError(`Смену старше ${BACKDATE_DAYS} дней вносит руководитель — напиши ему.`);
    if (!equipment) return showError("Выбери технику.");
    if (customers.length && !customer) return showError("Выбери, на кого работал.");
    if (!contractor) {
      if (!payType) return showError("Выбери, как оплачивается смена.");
      if (!rateFor(payType)) return showError(`У тебя не задана ${payType === "hourly" ? "почасовая" : "посменная"} ставка — напиши руководителю.`);
    }
    if (needsHours()) {
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
      saveBtn.disabled = false; saveBtn.textContent = saveLabel;
      return showError("Не получилось обработать фото: " + e.message);
    }

    try {
      saveBtn.textContent = "Сохраняю…";
      await enqueueShift({
        mode: existing ? "update" : "create",
        // номер записи выдаём сразу — повторная отправка не создаст дубль
        docId: existing ? existing.id : db.collection(COL_OWN).doc().id,
        col: existing ? existing._col : null,
        fields: {
          date, equipmentId, equipmentName: equipment.name,
          customerId: customer ? customer.id : "",
          customerName: customer ? customer.name : "",
          payType: contractor ? null : payType,
          hours: needsHours() ? hours : null,
          note: card.querySelector("#sf-note").value.trim(),
        },
        keepUrls: keptPhotos,
        blobs,
      });
    } catch (e) {
      saveBtn.disabled = false; saveBtn.textContent = saveLabel;
      return showError("Не получилось сохранить на телефоне: " + e.message + ". Проверь, есть ли свободная память.");
    }

    localStorage.setItem(LAST_EQUIPMENT_KEY, equipmentId);
    if (payType) localStorage.setItem(LAST_PAYTYPE_KEY, payType);
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
      if (!confirm(`Удалить смену за ${fmtRU(parseISO(existing.date))}?${contractor ? "" : " Начисление за неё пропадёт."}`)) return;
      db.collection(existing._col).doc(existing.id).delete()
        .catch((e) => toast("Не удалось удалить: " + (e.code === "permission-denied" ? "срок правки вышел или смену поправил руководитель." : e.message), true));
      closeShiftForm();
      render();
    };
  }

  return card;
}
