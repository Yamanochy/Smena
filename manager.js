// ============================================================
// ПУТЕВЫЕ — экран руководителя: все путевые листы за период,
// отбор по тому, чей водитель, по заказчику и по водителю,
// выгрузка реестра в Excel для сверки.
//
// Записи берутся из двух мест и показываются одним списком:
//   tabelShifts — смены наших водителей (те же, что видит Табель);
//   nskWaybills — путевые водителей подрядчиков.
// Смены наших вносятся и правятся в Табеле (там зарплата). Путевые
// подрядчиков — прямо здесь: нажми на строку, чтобы поправить, или на
// «Внести путевой за водителя», если водитель не внёс смену сам.
// ============================================================

let wbFilter = null;        // { from, to, owner, customer, driver }
let wbOwn = [];             // смены наших за период
let wbContractor = [];      // путевые подрядчиков за период
let wbUnsubs = [];
let wbLoadedKey = "";       // на какой период сейчас подписаны
let wbReady = { own: false, con: false };

function resetManagerState() {
  wbUnsubs.forEach((u) => { try { u(); } catch (e) {} });
  wbUnsubs = []; wbOwn = []; wbContractor = []; wbLoadedKey = ""; wbFilter = null;
  wbReady = { own: false, con: false };
}

function monthRange(year, month) {
  const lastDay = new Date(year, month + 1, 0).getDate();
  const p = `${year}-${pad2(month + 1)}-`;
  return { from: p + "01", to: p + pad2(lastDay), mid: p + "15", mid2: p + "16" };
}

function ensureWbFilter() {
  if (wbFilter) return wbFilter;
  const r = monthRange(selectedYear, selectedMonth);
  wbFilter = { from: r.from, to: r.to, owner: "all", customer: "all", driver: "all" };
  return wbFilter;
}

function subscribeManagerData() {
  ensureWbFilter();
  subscribeWaybillsPeriod();
  if (typeof subscribePeople === "function") subscribePeople();
}

// читаем только выбранный период — не всю историю
function subscribeWaybillsPeriod() {
  const f = ensureWbFilter();
  const from = f.from <= f.to ? f.from : f.to;
  const to = f.from <= f.to ? f.to : f.from;
  const key = from + "|" + to;
  if (key === wbLoadedKey) return;
  wbLoadedKey = key;
  wbUnsubs.forEach((u) => { try { u(); } catch (e) {} });
  wbUnsubs = []; wbOwn = []; wbContractor = [];
  wbReady = { own: false, con: false };

  const listen = (col, assign, flag) => {
    wbUnsubs.push(db.collection(col).where("date", ">=", from).where("date", "<=", to)
      .onSnapshot((snap) => {
        if (wbLoadedKey !== key) return; // период уже сменили
        assign(snap.docs.map((d) => ({ id: d.id, ...d.data(), _col: col })));
        wbReady[flag] = true;
        softRender();
      }, (err) => { console.error("Путевые не загрузились (" + col + ")", err); wbReady[flag] = true; softRender(); }));
  };
  listen(COL_OWN, (list) => { wbOwn = list; }, "own");
  listen(COL_CONTRACTOR, (list) => { wbContractor = list; }, "con");
}

// ---------- единый вид записи ----------
// Один человек — одна строка в отборе и в своде по водителям.
//   Наш водитель: по фамилии и имени, как это делает Табель. Смену мог
//   внести он сам (в записи есть его аккаунт), а мог руководитель в Табеле
//   (аккаунта в записи может не быть) — это всё равно один человек.
//   Водитель подрядчика: по аккаунту — тёзки у разных подрядчиков не сольются.
function wbDriverKey(r) {
  if (r._col === COL_CONTRACTOR) {
    return r.driverUid ? "u:" + r.driverUid : "c:" + (r.contractorId || "") + ":" + nameKey(r.driverName);
  }
  return "n:" + nameKey(r.driverName);
}
function wbNormalize(r) {
  const contractor = r._col === COL_CONTRACTOR;
  const eq = equipmentById(r.equipmentId);
  const hours = contractor ? Number(r.hours || 0) : (r.payType === "hourly" ? Number(r.hours || 0) : 0);
  return {
    id: r.id, col: r._col, raw: r, contractor,
    date: r.date || "",
    driverKey: wbDriverKey(r),
    driverName: r.driverName || "—",
    ownerId: contractor ? (r.contractorId || "?") : "own",
    ownerName: contractor ? contractorName(r.contractorId, r.contractorName) : "Наш",
    equipmentName: r.equipmentName || (eq ? eq.name : ""),
    plate: eq ? (eq.plateNumber || "") : "",
    customerId: r.customerId || "",
    customerName: customerName(r.customerId, r.customerName),
    hours,
    pay: contractor ? 0 : Number(r.computedPay || 0),
    note: r.note || "",
    photos: Array.isArray(r.photoUrls) ? r.photoUrls : [],
    self: r.source === "driver-app",
    edited: !!r.managerEdited,
    createdMs: r.createdAt && r.createdAt.toMillis ? r.createdAt.toMillis() : 0,
  };
}

function wbAllRecords() {
  return wbOwn.concat(wbContractor).map(wbNormalize);
}
function wbApplyFilter(list, opts) {
  const f = ensureWbFilter();
  const skip = opts || {};
  return list.filter((r) => {
    if (f.owner !== "all" && r.ownerId !== f.owner) return false;
    if (!skip.customer && f.customer !== "all" && r.customerId !== (f.customer === "none" ? "" : f.customer)) return false;
    if (!skip.driver && f.driver !== "all" && r.driverKey !== f.driver) return false;
    return true;
  });
}
function wbFiltered() {
  return wbApplyFilter(wbAllRecords()).sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return b.createdMs - a.createdMs;
  });
}
function wbTotalsOf(list) {
  return {
    count: list.length,
    hours: list.reduce((s, r) => s + r.hours, 0),
    shiftOnly: list.filter((r) => !r.hours).length,
    pay: list.reduce((s, r) => s + r.pay, 0),
  };
}

// «01.10–31.10»
function shortPeriod(from, to) {
  const a = parseISO(from), b = parseISO(to);
  const p = (d) => pad2(d.getDate()) + "." + pad2(d.getMonth() + 1);
  return p(a) + "–" + p(b);
}
function longPeriod(from, to) {
  return fmtISO(from) + " — " + fmtISO(to);
}

// три числа в шапке
function managerTotals() {
  const f = ensureWbFilter();
  const t = wbTotalsOf(wbFiltered());
  t.periodShort = shortPeriod(f.from, f.to);
  return t;
}

// ---------- экран ----------
function renderWaybills() {
  app.innerHTML = "";
  const f = ensureWbFilter();
  const wrap = el("div", "space-y-3");
  const hasInstall = typeof installSlot === "function";
  if (hasInstall) wrap.appendChild(installSlot("inapp", "top"));

  // ----- период -----
  const card = el("div", "card p-3 space-y-3");
  card.id = "wb-filters";
  const fromD = parseISO(f.from);
  const yr = fromD.getFullYear(), mo = fromD.getMonth();
  const r = monthRange(yr, mo);
  const now = new Date();
  const atCurrent = yr === now.getFullYear() && mo === now.getMonth();
  const half = f.from === r.from && f.to === r.to ? "all" : f.from === r.from && f.to === r.mid ? "h1" : f.from === r.mid2 && f.to === r.to ? "h2" : "custom";

  card.innerHTML = `
    <div class="flex items-center justify-between">
      <button type="button" id="wb-prev" class="btn btn-ghost btn-sm w-10 px-0 text-lg" aria-label="Предыдущий месяц">‹</button>
      <div class="title">${MONTHS_RU[mo]} ${yr}</div>
      <button type="button" id="wb-next" class="btn btn-ghost btn-sm w-10 px-0 text-lg" aria-label="Следующий месяц" ${atCurrent ? "disabled" : ""}>›</button>
    </div>
    <div class="seg">
      <button type="button" data-half="all" class="wb-half chip ${half === "all" ? "chip-on" : ""}">Весь месяц</button>
      <button type="button" data-half="h1" class="wb-half chip num ${half === "h1" ? "chip-on" : ""}">1–15</button>
      <button type="button" data-half="h2" class="wb-half chip num ${half === "h2" ? "chip-on" : ""}">16–${parseISO(r.to).getDate()}</button>
    </div>
    <div class="grid grid-cols-2 gap-2">
      <label class="lbl">С даты<input id="wb-from" type="date" class="field field-sm num" value="${f.from}" /></label>
      <label class="lbl">По дату<input id="wb-to" type="date" class="field field-sm num" value="${f.to}" /></label>
    </div>
    <label class="lbl">Чьи водители<select id="wb-owner" class="field field-sm"></select></label>
    <label class="lbl">Заказчик<select id="wb-customer" class="field field-sm"></select></label>
    <label class="lbl">Водитель<select id="wb-driver" class="field field-sm"></select></label>`;
  wrap.appendChild(card);

  const setPeriod = (from, to) => {
    f.from = from; f.to = to; f.driver = "all";
    const d = parseISO(from <= to ? from : to);
    selectedMonth = d.getMonth(); selectedYear = d.getFullYear();
    subscribeWaybillsPeriod();
    render();
  };
  card.querySelector("#wb-prev").onclick = () => { const m = monthRange(mo === 0 ? yr - 1 : yr, mo === 0 ? 11 : mo - 1); setPeriod(m.from, m.to); };
  card.querySelector("#wb-next").onclick = () => { if (atCurrent) return; const m = monthRange(mo === 11 ? yr + 1 : yr, mo === 11 ? 0 : mo + 1); setPeriod(m.from, m.to); };
  card.querySelectorAll(".wb-half").forEach((b) => {
    b.onclick = () => {
      if (b.dataset.half === "h1") setPeriod(r.from, r.mid);
      else if (b.dataset.half === "h2") setPeriod(r.mid2, r.to);
      else setPeriod(r.from, r.to);
    };
  });
  const fromInput = card.querySelector("#wb-from"), toInput = card.querySelector("#wb-to");
  const datesChanged = () => {
    if (!fromInput.value || !toInput.value) return;
    if (fromInput.value > toInput.value) { toast("Дата «с» позже даты «по» — поправь период.", true); return; }
    setPeriod(fromInput.value, toInput.value);
  };
  fromInput.onchange = datesChanged;
  toInput.onchange = datesChanged;

  card.querySelector("#wb-owner").onchange = (e) => { f.owner = e.target.value; f.driver = "all"; refreshWaybillResults(); renderHeaderHero(); };
  card.querySelector("#wb-customer").onchange = (e) => { f.customer = e.target.value; refreshWaybillResults(); renderHeaderHero(); };
  card.querySelector("#wb-driver").onchange = (e) => { f.driver = e.target.value; refreshWaybillResults(); renderHeaderHero(); };

  const results = el("div", "space-y-3");
  results.id = "wb-results";
  wrap.appendChild(results);
  if (hasInstall) wrap.appendChild(installSlot("inapp", "bottom"));
  app.appendChild(wrap);
  refreshWaybillResults();
}

// списки выбора зависят от того, что есть в периоде — пересобираем их на
// месте, не трогая сами поля (иначе открытый список закрывался бы сам)
function fillSelect(sel, options, value) {
  if (!sel || document.activeElement === sel) return;
  const html = options.map(([v, label]) => `<option value="${escapeHtml(v)}">${escapeHtml(label)}</option>`).join("");
  if (sel.dataset.sig !== html) { sel.innerHTML = html; sel.dataset.sig = html; }
  sel.value = value;
}

function refreshWaybillResults() {
  const box = document.getElementById("wb-results");
  if (!box) return;
  const f = ensureWbFilter();
  const all = wbAllRecords();

  // --- варианты в списках ---
  const ownerOpts = [["all", "Все водители"], ["own", "Наши"]];
  const seenOwners = new Set();
  listItems("contractors").forEach((c) => {
    const used = all.some((r) => r.ownerId === c.id);
    if (c.active || used) { ownerOpts.push([c.id, c.name]); seenOwners.add(c.id); }
  });
  all.forEach((r) => { if (r.contractor && !seenOwners.has(r.ownerId)) { seenOwners.add(r.ownerId); ownerOpts.push([r.ownerId, r.ownerName]); } });
  if (!ownerOpts.some(([v]) => v === f.owner)) f.owner = "all";

  const custOpts = [["all", "Все заказчики"]];
  listItems("customers").forEach((c) => { if (c.active || all.some((r) => r.customerId === c.id)) custOpts.push([c.id, c.name]); });
  if (all.some((r) => !r.customerId)) custOpts.push(["none", "Заказчик не указан"]);
  if (!custOpts.some(([v]) => v === f.customer)) f.customer = "all";

  const driverMap = new Map();
  wbApplyFilter(all, { driver: true, customer: true }).forEach((r) => { if (!driverMap.has(r.driverKey)) driverMap.set(r.driverKey, r.driverName); });
  const driverOpts = [["all", "Все водители"]].concat(
    Array.from(driverMap.entries()).sort((a, b) => a[1].localeCompare(b[1], "ru")));
  if (!driverOpts.some(([v]) => v === f.driver)) f.driver = "all";

  fillSelect(document.getElementById("wb-owner"), ownerOpts, f.owner);
  fillSelect(document.getElementById("wb-customer"), custOpts, f.customer);
  fillSelect(document.getElementById("wb-driver"), driverOpts, f.driver);

  // --- список ---
  const list = wbFiltered();
  const t = wbTotalsOf(list);
  box.innerHTML = "";

  const loading = !wbReady.own || !wbReady.con;
  const exportBtn = el("button", "btn btn-line-gold btn-block", `${ICONS.download}<span>Скачать реестр (Excel)</span>`);
  exportBtn.type = "button";
  exportBtn.id = "wb-export";
  exportBtn.disabled = !list.length;
  exportBtn.onclick = () => exportWaybillRegistry(exportBtn);
  box.appendChild(exportBtn);

  const addBtn = el("button", "btn btn-ghost btn-block", `${ICONS.plus}<span>Внести путевой за водителя</span>`);
  addBtn.type = "button";
  addBtn.id = "wb-add";
  addBtn.onclick = openNewWaybillSheet;
  box.appendChild(addBtn);

  const head = el("div", "flex items-baseline justify-between gap-3 pt-1");
  head.innerHTML = `
    <div class="eyebrow">Путевые листы</div>
    <div class="text-xs t-soft num text-right">${t.count} ${plural(t.count, "путевой", "путевых", "путевых")} · ${fmtHours(t.hours)} ч${t.pay ? " · нашим " + fmtMoney(t.pay) : ""}</div>`;
  box.appendChild(head);

  if (!list.length) {
    box.appendChild(el("div", "card empty", loading ? "Загружаю…"
      : (all.length ? "Под этот отбор ничего не попало. Попробуй убрать фильтр по заказчику или водителю."
        : `За ${longPeriod(f.from, f.to)} путевых нет.`)));
    return;
  }

  let lastDate = "";
  let dayBox = null;
  list.forEach((r) => {
    if (r.date !== lastDate) {
      lastDate = r.date;
      const day = list.filter((x) => x.date === r.date);
      const dt = wbTotalsOf(day);
      const dh = el("div", "flex items-baseline justify-between gap-2 px-1 pt-2");
      dh.innerHTML = `<div class="t-strong num">${fmtDay(r.date)}</div><div class="text-xs t-mute num">${dt.count} ${plural(dt.count, "путевой", "путевых", "путевых")} · ${fmtHours(dt.hours)} ч</div>`;
      box.appendChild(dh);
      dayBox = el("div", "card rows");
      box.appendChild(dayBox);
    }
    dayBox.appendChild(renderWaybillRow(r));
  });

  box.appendChild(el("div", "text-xs t-mute px-1",
    "Смены наших водителей вносятся и правятся в Табеле. Путевой водителя подрядчика можно поправить здесь — нажми на строку."));
}

function renderWaybillRow(r) {
  const row = el("div", "p-3 flex items-center gap-3");
  row.dataset.waybill = r.id;
  row.appendChild(photoThumb(r.photos, 46));

  const info = el("button", "flex-1 min-w-0 text-left");
  info.type = "button";
  // кто внёс, показываем только когда это не сам водитель или запись правили
  const source = [r.self ? "" : "внёс руководитель", r.edited ? "поправлено" : ""].filter(Boolean).join(", ");
  info.innerHTML = `
    <div class="t-strong truncate">${escapeHtml(r.driverName)}</div>
    <div class="text-[13px] t-soft truncate">${escapeHtml(r.equipmentName || "техника не указана")}</div>
    <div class="text-[13px] truncate ${r.customerName ? "t-soft" : "t-mute"}">${escapeHtml(r.customerName || "заказчик не указан")}${r.note ? " · " + escapeHtml(r.note) : ""}</div>
    <div class="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1.5">
      <span class="pill ${r.contractor ? "pill-gold" : ""}">${escapeHtml(r.ownerName)}</span>
      ${source ? `<span class="tag tag-mute">${source}</span>` : ""}
    </div>`;
  info.onclick = () => openWaybillSheet(r);
  row.appendChild(info);

  const right = el("div", "shrink-0 text-right");
  right.innerHTML = `
    <div class="num font-bold text-[17px] leading-tight">${r.hours ? fmtHours(r.hours) + " ч" : "смена"}</div>
    ${r.contractor ? "" : `<div class="num text-xs t-soft">${fmtMoney(r.pay)}</div>`}`;
  row.appendChild(right);
  return row;
}

// ---------- карточка путевого ----------
// Наш водитель — только просмотр (правка в Табеле, там пересчитывается
// зарплата). Водитель подрядчика — правка и удаление здесь.
function openWaybillSheet(r) {
  const raw = r.raw;
  if (!r.contractor) {
    const sheet = openSheet(`
      <div class="title">Смена нашего водителя</div>
      <div class="note">
        <div class="t-strong text-chalk">${escapeHtml(r.driverName)}</div>
        <div>${fmtISO(r.date)} · ${escapeHtml(r.equipmentName || "техника не указана")}</div>
        <div>${escapeHtml(r.customerName || "заказчик не указан")}${r.note ? " · " + escapeHtml(r.note) : ""}</div>
        <div class="num">${r.hours ? fmtHours(r.hours) + " ч × " + fmtMoney(raw.rate) : "посменно"} = ${fmtMoney(r.pay)}</div>
      </div>
      <div class="text-[13px] t-soft">Править и удалять смены наших водителей нужно в Табеле: там же пересчитывается зарплата.</div>
      <div class="flex gap-2">
        <a href="${TABEL_URL}" target="_blank" rel="noopener" class="btn btn-gold flex-1">Открыть Табель</a>
        <button type="button" id="ws-close" class="btn btn-ghost">Закрыть</button>
      </div>`);
    sheet.card.querySelector("#ws-close").onclick = sheet.close;
    return;
  }

  const keepCustomer = raw.customerId || null;
  const sheet = openSheet(`
    <div class="title">Путевой водителя подрядчика</div>
    <div class="note">
      <div class="t-strong text-chalk">${escapeHtml(r.driverName)}</div>
      <div>${escapeHtml(r.ownerName)} · ${r.self ? "внёс сам" : "внёс руководитель"}${r.edited ? ", уже правился" : ""}</div>
    </div>
    <label class="lbl">Дата<input id="ws-date" type="date" class="field num" value="${escapeHtml(raw.date || "")}" max="${todayISO()}" /></label>
    <label class="lbl">Техника
      <select id="ws-equipment" class="field">
        ${equipmentById(raw.equipmentId) ? "" : `<option value="${escapeHtml(raw.equipmentId || "")}" selected>${escapeHtml(raw.equipmentName || "не указана")}</option>`}
        ${equipmentOptionsHtml(raw.contractorId || "own", raw.equipmentId, raw.equipmentId)}
      </select>
    </label>
    <label class="lbl">Заказчик
      <select id="ws-customer" class="field">
        <option value="">Не указан</option>
        ${customerOptionsHtml(raw.customerId || "", keepCustomer)}
      </select>
    </label>
    <label class="lbl">Часы<input id="ws-hours" type="number" inputmode="decimal" min="0.5" max="24" step="0.5" class="field num" value="${raw.hours || ""}" /></label>
    <label class="lbl">Примечание<input id="ws-note" maxlength="300" class="field" value="${escapeHtml(raw.note || "")}" /></label>
    <div class="text-[13px] t-soft">После твоей правки водитель эту запись изменить уже не сможет.</div>
    <div id="ws-error" class="note note-bad hidden" role="alert"></div>
    <div class="flex gap-2">
      <button type="button" id="ws-save" class="btn btn-gold flex-1">Сохранить</button>
      <button type="button" id="ws-close" class="btn btn-ghost">Отмена</button>
    </div>
    <button type="button" id="ws-delete" class="btn btn-danger btn-sm btn-block">${ICONS.trash}<span>Удалить путевой</span></button>`);
  const c = sheet.card;
  const err = c.querySelector("#ws-error");
  const fail = (t) => { err.textContent = t; err.classList.remove("hidden"); };
  c.querySelector("#ws-close").onclick = sheet.close;

  c.querySelector("#ws-save").onclick = async () => {
    err.classList.add("hidden");
    const date = c.querySelector("#ws-date").value;
    const hours = Number(c.querySelector("#ws-hours").value) || 0;
    const eqId = c.querySelector("#ws-equipment").value;
    const eq = equipmentById(eqId);
    const custId = c.querySelector("#ws-customer").value;
    if (!date) return fail("Укажи дату.");
    if (date > todayISO()) return fail("Дата не может быть в будущем.");
    if (!hours || hours <= 0 || hours > 24) return fail("Часы — от 0,5 до 24.");
    if (offlineBlocked(fail)) return;
    const btn = c.querySelector("#ws-save");
    btn.disabled = true; btn.textContent = "Сохраняю…";
    try {
      await db.collection(COL_CONTRACTOR).doc(r.id).update({
        date,
        equipmentId: eqId,
        equipmentName: eq ? eq.name : (raw.equipmentName || ""),
        customerId: custId,
        customerName: custId ? customerName(custId, raw.customerName) : "",
        hours,
        note: c.querySelector("#ws-note").value.trim(),
        managerEdited: true,
        editedByUid: currentUser.uid,
        editedByName: currentName,
        editedAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
      sheet.close();
      toast("Путевой сохранён.");
    } catch (e) {
      btn.disabled = false; btn.textContent = "Сохранить";
      fail("Не получилось: " + e.message);
    }
  };
  c.querySelector("#ws-delete").onclick = async () => {
    if (offlineBlocked(fail)) return;
    if (!confirm(`Удалить путевой «${r.driverName}» за ${fmtISO(r.date)}? Вернуть его будет нельзя.`)) return;
    try {
      await db.collection(COL_CONTRACTOR).doc(r.id).delete();
      sheet.close();
      toast("Путевой удалён.");
    } catch (e) {
      fail("Не получилось: " + e.message);
    }
  };
}

// ---------- путевой вносит руководитель ----------
// Когда водитель подрядчика не внёс смену сам: забыл, остался без телефона
// или прошло больше BACKDATE_DAYS дней (дальше приложение его не пускает).
// Без этого реестр для сверки было бы нечем дополнить.
// Наших это не касается: их смены вносятся в Табеле, там считается зарплата.
// Запись получает пометку «внёс руководитель», водитель её править не может.
function openNewWaybillSheet() {
  if (typeof accessLoaded !== "undefined" && !accessLoaded) {
    toast("Список водителей ещё загружается — попробуй через пару секунд.");
    return;
  }
  const f = ensureWbFilter();
  const byName = (a, b) => String(a.fullName || "").localeCompare(String(b.fullName || ""), "ru");
  const drivers = (typeof accessLinks !== "undefined" ? accessLinks : []).filter((a) => isContractorAccess(a)).sort(byName);

  if (!drivers.length) {
    const empty = openSheet(`
      <div class="title">Новый путевой</div>
      <div class="note">Водителей подрядчиков пока нет. Внести путевой можно за водителя, который зарегистрировался в «Смене» и отмечен как водитель подрядчика, — это делается во вкладке «Водители».</div>
      <div class="text-[13px] t-soft">Смены наших водителей вносятся в Табеле: там же считается зарплата.</div>
      <div class="flex gap-2">
        <a href="${TABEL_URL}" target="_blank" rel="noopener" class="btn btn-ghost flex-1">${ICONS.open}<span>Открыть Табель</span></a>
        <button type="button" id="nw-cancel" class="btn btn-ghost">Закрыть</button>
      </div>`);
    empty.card.querySelector("#nw-cancel").onclick = empty.close;
    return;
  }

  // водители — по подрядчикам; с закрытым доступом — отдельно в конце
  // (путевой за прошлые дни может понадобиться и за того, кто уже не работает)
  const optionOf = (a, withOwner) => `<option value="${escapeHtml(a.id)}">${escapeHtml(a.fullName || "без имени")}${withOwner ? " — " + escapeHtml(contractorName(a.contractorId, a.contractorName)) : ""}</option>`;
  const open = drivers.filter((a) => a.active === true);
  const closed = drivers.filter((a) => a.active !== true);
  const known = new Set();
  let driverOptions = "";
  listItems("contractors").forEach((x) => {
    known.add(x.id);
    const list = open.filter((a) => a.contractorId === x.id);
    if (list.length) driverOptions += `<optgroup label="${escapeHtml(x.name)}">${list.map((a) => optionOf(a)).join("")}</optgroup>`;
  });
  const orphan = open.filter((a) => !known.has(a.contractorId));
  if (orphan.length) driverOptions += `<optgroup label="Подрядчик не из справочника">${orphan.map((a) => optionOf(a)).join("")}</optgroup>`;
  if (closed.length) driverOptions += `<optgroup label="Доступ закрыт">${closed.map((a) => optionOf(a, true)).join("")}</optgroup>`;

  const today = todayISO();
  // смотрим прошлый период — скорее всего, и путевой нужен за него
  const defaultDate = today >= f.from && today <= f.to ? today : (f.to < today ? f.to : today);
  const needCustomer = activeCustomers().length > 0;
  const saveLabel = "Сохранить путевой";

  const sheet = openSheet(`
    <div class="title">Новый путевой</div>
    <div class="text-[13px] t-soft">За водителя подрядчика — когда он не внёс смену сам. Смены наших водителей вносятся в Табеле.</div>
    <label class="lbl">Водитель
      <select id="nw-driver" class="field">
        <option value="">Выбери водителя</option>
        ${driverOptions}
      </select>
    </label>
    <label class="lbl">Дата<input id="nw-date" type="date" class="field num" value="${defaultDate}" max="${today}" /></label>
    <label class="lbl">Техника<select id="nw-equipment" class="field"></select></label>
    <label class="lbl">Заказчик
      <select id="nw-customer" class="field">
        <option value="">${needCustomer ? "Выбери заказчика" : "Не указан"}</option>
        ${customerOptionsHtml("", null)}
      </select>
    </label>
    <label class="lbl">Часы<input id="nw-hours" type="number" inputmode="decimal" min="0.5" max="24" step="0.5" class="field num" placeholder="например 10" /></label>
    <label class="lbl">Примечание<input id="nw-note" maxlength="300" class="field" placeholder="например: по бумажному путевому" /></label>
    <div>
      <div class="lbl">Фото путевого листа (необязательно), до ${MAX_PHOTOS} шт.</div>
      <div id="nw-thumbs" class="flex gap-2 flex-wrap mt-2 empty:hidden"></div>
      <button type="button" id="nw-photo" class="btn btn-ghost btn-sm mt-2">${ICONS.camera}<span>Приложить фото</span></button>
      <input type="file" accept="image/*" multiple id="nw-photo-input" class="hidden" />
    </div>
    <div class="text-[13px] t-soft">Водитель увидит запись у себя с пометкой «внёс руководитель». Изменить её он не сможет.</div>
    <div id="nw-error" class="note note-bad hidden" role="alert"></div>
    <div class="flex gap-2">
      <button type="button" id="nw-save" class="btn btn-gold flex-1">${saveLabel}</button>
      <button type="button" id="nw-cancel" class="btn btn-ghost">Отмена</button>
    </div>`);
  const c = sheet.card;
  const drvSel = c.querySelector("#nw-driver");
  const eqSel = c.querySelector("#nw-equipment");
  const save = c.querySelector("#nw-save");
  const err = c.querySelector("#nw-error");
  const fail = (t) => { err.textContent = t; err.classList.remove("hidden"); err.scrollIntoView({ block: "nearest" }); };
  c.querySelector("#nw-cancel").onclick = sheet.close;

  // техника подрядчика выбранного водителя — первой в списке
  const fillEquipment = () => {
    const a = drivers.find((x) => x.id === drvSel.value);
    const keep = eqSel.value;
    eqSel.innerHTML = `<option value="">Выбери технику</option>` + equipmentOptionsHtml(a ? (a.contractorId || "__none__") : "__none__", keep, null);
    eqSel.value = keep;
  };
  // в отборе уже выбран водитель подрядчика — подставляем его
  const picked = f.driver.indexOf("u:") === 0 ? f.driver.slice(2) : "";
  if (picked && drivers.some((a) => a.id === picked)) drvSel.value = picked;
  else if (drivers.length === 1) drvSel.value = drivers[0].id;
  drvSel.onchange = fillEquipment;
  fillEquipment();

  // фото (необязательно)
  const files = [];
  const thumbs = c.querySelector("#nw-thumbs");
  const renderThumbs = () => {
    thumbs.innerHTML = "";
    files.forEach((file, i) => {
      const w = el("div", "relative w-16 h-16");
      const img = el("img", "w-16 h-16 object-cover rounded-lg border border-rivet");
      img.src = URL.createObjectURL(file); img.alt = "";
      const del = el("button", "absolute -top-1.5 -right-1.5 w-6 h-6 rounded-full bg-flare text-white flex items-center justify-center", ICONS.close);
      del.type = "button"; del.setAttribute("aria-label", "Убрать фото");
      del.onclick = () => { files.splice(i, 1); renderThumbs(); };
      w.appendChild(img); w.appendChild(del); thumbs.appendChild(w);
    });
  };
  c.querySelector("#nw-photo").onclick = () => c.querySelector("#nw-photo-input").click();
  c.querySelector("#nw-photo-input").onchange = (e) => {
    const room = MAX_PHOTOS - files.length;
    if (room <= 0) {
      fail(`К путевому можно приложить не больше ${MAX_PHOTOS} фото.`);
    } else {
      Array.from(e.target.files).slice(0, room).forEach((x) => files.push(x));
      err.classList.add("hidden");
      renderThumbs();
    }
    e.target.value = "";
  };

  save.onclick = async () => {
    err.classList.add("hidden");
    const a = drivers.find((x) => x.id === drvSel.value);
    const date = c.querySelector("#nw-date").value;
    const eq = equipmentById(eqSel.value);
    const custId = c.querySelector("#nw-customer").value;
    const cust = listItems("customers").find((x) => x.id === custId) || null;
    const hours = Number(c.querySelector("#nw-hours").value) || 0;
    if (!a) return fail("Выбери водителя.");
    if (!date) return fail("Укажи дату.");
    if (date > todayISO()) return fail("Дата не может быть в будущем.");
    if (!eq) return fail("Выбери технику.");
    if (needCustomer && !cust) return fail("Выбери заказчика.");
    if (!hours || hours <= 0 || hours > 24) return fail("Часы — от 0,5 до 24.");
    if (offlineBlocked(fail)) return;

    save.disabled = true;
    try {
      // тот же водитель, день и техника уже есть — возможно, это повтор
      save.textContent = "Проверяю…";
      let dup = false;
      try {
        const same = await withTimeout(db.collection(COL_CONTRACTOR).where("driverUid", "==", a.id).where("date", "==", date).get(), 8000);
        dup = same.docs.some((d) => d.data().equipmentId === eq.id);
      } catch (e) { /* проверить не удалось — сохранению это не мешает */ }
      if (dup && !confirm(`За ${fmtISO(date)} у «${shortName(a.fullName)}» на «${eq.name}» путевой уже есть. Точно добавить ещё один?`)) {
        save.disabled = false; save.textContent = saveLabel;
        return;
      }

      const photoUrls = [];
      for (let i = 0; i < files.length; i++) {
        save.textContent = `Загружаю фото ${i + 1}/${files.length}…`;
        photoUrls.push(await uploadToCloudinary(await resizeImage(files[i])));
      }

      save.textContent = "Сохраняю…";
      await db.collection(COL_CONTRACTOR).add({
        date,
        driverUid: a.id,
        driverName: a.fullName || "",
        contractorId: a.contractorId || "",
        contractorName: a.contractorName || contractorName(a.contractorId),
        equipmentId: eq.id,
        equipmentName: eq.name || "",
        customerId: cust ? cust.id : "",
        customerName: cust ? cust.name : "",
        hours,
        note: c.querySelector("#nw-note").value.trim(),
        photoUrls,
        createdByUid: currentUser.uid,
        createdByName: currentName,
        source: "manager",                      // не «driver-app»: в списках это «внёс руководитель»
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
      sheet.close();
      const inPeriod = date >= f.from && date <= f.to;
      toast(inPeriod ? "Путевой внесён." : `Путевой за ${fmtISO(date)} внесён. Он вне выбранного периода — смени период, чтобы увидеть его в списке.`);
    } catch (e) {
      save.disabled = false; save.textContent = saveLabel;
      fail("Не получилось: " + ((e && e.message) || e));
    }
  };
}

// ---------- реестр в Excel ----------
// Четыре листа: сам реестр и своды по водителям, технике и заказчикам.
// В реестр попадает ровно то, что сейчас на экране (с учётом отбора).
function wbRegistryData() {
  const f = ensureWbFilter();
  const list = wbFiltered().slice().sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    const n = a.driverName.localeCompare(b.driverName, "ru");
    return n !== 0 ? n : a.createdMs - b.createdMs;
  });
  const t = wbTotalsOf(list);
  const ownerText = f.owner === "all" ? "Все водители" : f.owner === "own" ? "Наши водители" : "Подрядчик: " + contractorName(f.owner);
  const custText = f.customer === "all" ? "Все заказчики" : f.customer === "none" ? "Заказчик не указан" : "Заказчик: " + customerName(f.customer);
  const driverRec = f.driver === "all" ? null : list.find((r) => r.driverKey === f.driver);
  return { f, list, t, ownerText, custText, driverName: driverRec ? driverRec.driverName : "" };
}

function buildWaybillWorkbook() {
  const d = wbRegistryData();
  const { f, list, t } = d;
  const period = "Период: " + longPeriod(f.from, f.to);
  const sub = "Техника · Новосибирск";
  const showOwner = f.owner === "all";
  const hoursCell = (r) => (r.hours ? r.hours : "смена");
  const countWord = (n) => xlPlural(n, "путевой лист", "путевых листа", "путевых листов");
  const tail = t.shiftOnly ? `, из них без часов (посменно): ${t.shiftOnly}` : "";

  // ---- лист 1: реестр ----
  const cols = [
    { title: "№", width: 5, align: "center" },
    { title: "Дата", width: 12, align: "center" },
    { title: "Водитель", width: 30, wrap: true },
  ];
  if (showOwner) cols.push({ title: "Чей водитель", width: 20, wrap: true });
  // длинные названия переносятся на вторую строку, а не обрезаются
  cols.push(
    { title: "Техника", width: 28, wrap: true },
    { title: "Гос. номер", width: 14, align: "center" },
    { title: "Заказчик", width: 22, wrap: true },
    { title: "Часы", width: 9, align: "right" },
    { title: "Примечание", width: 30, wrap: true },
  );
  const hoursCol = cols.findIndex((c) => c.title === "Часы");
  const rows = list.map((r, i) => {
    const row = [i + 1, fmtISO(r.date), r.driverName];
    if (showOwner) row.push(r.ownerName);
    row.push(r.equipmentName, r.plate, r.customerName || "не указан", hoursCell(r), r.note);
    return row;
  });
  const signatures = [{ label: "Реестр составил", name: "" }];
  if (f.owner !== "all" && f.owner !== "own") signatures.push({ label: "С реестром согласен: " + contractorName(f.owner), name: "" });
  const ws1 = xlBuildSheet({
    title: "РЕЕСТР ПУТЕВЫХ ЛИСТОВ",
    subtitle: sub,
    lines: [period, d.ownerText + " · " + d.custText + (d.driverName ? " · Водитель: " + d.driverName : "")],
    columns: cols,
    rows,
    total: { label: `ИТОГО по реестру: ${list.length} ${countWord(list.length)}${tail}`, span: hoursCol, values: { [hoursCol]: t.hours } },
    signatures,
  });

  // ---- своды ----
  const group = (keyOf, labelOf) => {
    const map = new Map();
    list.forEach((r) => {
      const k = keyOf(r);
      if (!map.has(k)) map.set(k, { label: labelOf(r), count: 0, hours: 0 });
      const g = map.get(k); g.count += 1; g.hours += r.hours;
    });
    return Array.from(map.values()).sort((a, b) => String(a.label[0]).localeCompare(String(b.label[0]), "ru"));
  };
  const svod = (title, headCols, groups) => xlBuildSheet({
    title,
    lines: [period, d.ownerText + " · " + d.custText],
    columns: headCols.concat([{ title: "Путевых", width: 11, align: "center" }, { title: "Часов", width: 11, align: "right" }]),
    rows: groups.map((g) => g.label.concat([g.count, g.hours])),
    total: { label: "ИТОГО", span: headCols.length, values: { [headCols.length]: list.length, [headCols.length + 1]: t.hours } },
  });
  const ws2 = svod("СВОД ПО ВОДИТЕЛЯМ",
    [{ title: "Водитель", width: 32, wrap: true }, { title: "Чей водитель", width: 22, wrap: true }],
    group((r) => r.driverKey, (r) => [r.driverName, r.ownerName]));
  const ws3 = svod("СВОД ПО ТЕХНИКЕ",
    [{ title: "Техника", width: 34, wrap: true }, { title: "Гос. номер", width: 16, align: "center" }],
    group((r) => r.equipmentName + "|" + r.plate, (r) => [r.equipmentName || "не указана", r.plate]));
  const ws4 = svod("СВОД ПО ЗАКАЗЧИКАМ",
    [{ title: "Заказчик", width: 36, wrap: true }],
    group((r) => r.customerId, (r) => [r.customerName || "не указан"]));

  const wb = XLSX.utils.book_new();
  xlAppendSheet(wb, ws1, "Реестр", { landscape: true }); // широкая таблица — альбомный лист
  xlAppendSheet(wb, ws2, "По водителям");
  xlAppendSheet(wb, ws3, "По технике");
  xlAppendSheet(wb, ws4, "По заказчикам");

  const ownerTag = f.owner === "all" ? "все" : f.owner === "own" ? "наши" : contractorName(f.owner);
  return { wb, fileName: xlFileName(["Реестр_путевых", ownerTag, f.from, f.to]) };
}

async function exportWaybillRegistry(btn) {
  const label = btn ? btn.innerHTML : "";
  if (btn) { btn.disabled = true; btn.innerHTML = "<span>Готовлю файл…</span>"; }
  try {
    if (typeof XLSX === "undefined") {
      try { await loadScriptOnce(XLSX_URL); }
      catch (e) { toast("Не удалось загрузить модуль Excel — нужен интернет. Попробуй ещё раз, когда появится связь.", true); return; }
    }
    const { wb, fileName } = buildWaybillWorkbook();
    xlSaveFile(wb, fileName);
    toast("Реестр скачан: " + fileName);
  } catch (e) {
    console.error(e);
    toast("Не получилось собрать реестр: " + e.message, true);
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = label; }
  }
}
