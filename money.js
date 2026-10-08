// ============================================================
// ДЕНЬГИ — сколько начислено за месяц, сколько выдано авансом и
// сколько осталось получить. Только для водителя и только про него.
//
// Считается ТЕМ ЖЕ способом, что строка человека во вкладке «Итого»
// в Табеле, чтобы цифры у водителя и у руководителя совпадали:
//   начислено = смены в Новосибирске + заработок в Досатуе (если есть)
//   аванс     = авансы, зачтённые ЗА этот месяц (а не по дате перевода)
//   остаток   = начислено − аванс
// Если в Табеле меняется расчёт — менять нужно и здесь.
// ============================================================

let myAdvances = [];       // авансы этого водителя
let dosatuyByMonth = {};   // "2026-9" -> { at, total, trips, maintPay } — заработок в Досатуе
let dosatuyLoading = {};

function resetMoneyState() {
  myAdvances = []; dosatuyByMonth = {}; dosatuyLoading = {};
}

function subscribeMoney() {
  // отбор по своему uid обязателен — правила отдают водителю только его авансы
  unsubs.push(db.collection("tabelAdvances").where("driverUid", "==", currentUser.uid)
    .onSnapshot((snap) => {
      myAdvances = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      softRender();
    }, (err) => console.error("Авансы не загрузились", err)));
}

// как в Табеле: аванс относится к расчётному месяцу, а не к дате перевода
function advanceInSelectedMonth(a, year, month) {
  if (a.periodYear !== undefined && a.periodMonth !== undefined) {
    return a.periodYear === year && a.periodMonth === month;
  }
  return inSelectedMonth(a.date, year, month);
}

// Заработок этого же человека в Досатуе за месяц (если он ездит и там).
// Формулы повторяют dosatuy-ref.js в Табеле: рейс 6 000 ₽, ТО 6 000 ₽
// на экипаж, ремонт — по цене из записи; на двоих делится пополам.
// Читаем разово и держим 5 минут, а не подпиской — чтобы не тратить
// лимит чтений базы на тех, кто в Досатуе не работает.
async function loadDosatuyMonth(year, month) {
  const key = year + "-" + month;
  const cached = dosatuyByMonth[key];
  if (cached && Date.now() - cached.at < 5 * 60 * 1000) return;
  if (dosatuyLoading[key] || !currentAccess) return;
  dosatuyLoading[key] = true;
  const prefix = `${year}-${pad2(month + 1)}-`;
  const me = nameKey(currentAccess.fullName);
  try {
    const [ttn, maint] = await Promise.all([
      db.collection("ttnDocs").where("ttnDate", ">=", prefix + "01").where("ttnDate", "<=", prefix + "31").get(),
      db.collection("maintenanceDocs").where("date", ">=", prefix + "01").where("date", "<=", prefix + "31").get(),
    ]);
    let trips = 0, maintPay = 0;
    ttn.forEach((d) => { if (nameKey(d.data().driverName) === me) trips += 1; });
    maint.forEach((d) => {
      const m = d.data();
      const workers = [m.primaryWorker, m.secondaryWorker].filter(Boolean);
      const base = (m.type === "Ремонт" && m.repairPrice) ? Number(m.repairPrice) : 6000;
      const share = workers.length === 2 ? Math.round(base / 2) : base;
      workers.forEach((w) => { if (nameKey(w) === me) maintPay += share; });
    });
    dosatuyByMonth[key] = { at: Date.now(), trips, maintPay, total: trips * 6000 + maintPay };
  } catch (e) {
    // нет доступа к данным Досатуя или нет сети — просто не показываем эту строку
    dosatuyByMonth[key] = { at: Date.now(), failed: true, trips: 0, maintPay: 0, total: 0 };
  } finally {
    dosatuyLoading[key] = false;
    if (appStarted && currentTab === "money") softRender();
  }
}

function renderMoney() {
  app.innerHTML = "";
  const wrap = el("div", "space-y-3");
  wrap.appendChild(monthSwitcher());

  loadDosatuyMonth(selectedYear, selectedMonth);
  const dz = dosatuyByMonth[selectedYear + "-" + selectedMonth];
  const dosatuy = dz && !dz.failed ? dz.total : 0;

  const t = driverMonthTotals();
  const advances = myAdvances
    .filter((a) => advanceInSelectedMonth(a, selectedYear, selectedMonth))
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  const advanced = advances.reduce((s, a) => s + Number(a.amount || 0), 0);
  const earned = t.pay + dosatuy;
  const remain = earned - advanced;

  // расчётный лист: строки вычитаются сверху вниз, итог — крупно
  const sheet = el("div", "bg-white rounded-xl border border-slate-200 overflow-hidden");
  const line = (label, value, sub) => `
    <div class="flex items-baseline justify-between gap-3 px-4 py-3">
      <div class="min-w-0"><div class="text-sm text-slate-700">${label}</div>${sub ? `<div class="text-[11px] text-slate-400">${sub}</div>` : ""}</div>
      <div class="font-num font-semibold text-slate-800 shrink-0">${value}</div>
    </div>`;
  const shiftsSub = t.count
    ? `${t.count} ${plural(t.count, "смена", "смены", "смен")}${t.hours ? ", " + fmtHours(t.hours) + " ч" : ""}`
    : "смен нет";
  let html = "";
  if (dosatuy) {
    html += line("Смены в Новосибирске", fmtMoney(t.pay), shiftsSub);
    html += `<div class="border-t border-slate-100"></div>`;
    html += line("Досатуй", fmtMoney(dosatuy), `${dz.trips} ${plural(dz.trips, "рейс", "рейса", "рейсов")}${dz.maintPay ? ", ТО и ремонт " + fmtMoney(dz.maintPay) : ""}`);
  } else {
    html += line("Начислено за смены", fmtMoney(t.pay), shiftsSub);
  }
  html += `<div class="border-t border-slate-100"></div>`;
  html += line("Выдано авансом", advanced ? "− " + fmtMoney(advanced) : fmtMoney(0),
    advances.length ? `${advances.length} ${plural(advances.length, "перевод", "перевода", "переводов")}` : "авансов не было");
  html += `
    <div class="border-t-2 border-diesel px-4 py-4 flex items-end justify-between gap-3 ${remain < 0 ? "bg-brick/5" : "bg-shift/5"}">
      <div class="text-sm font-semibold text-slate-700">${remain < 0 ? "Аванс больше начисленного на" : "Осталось получить"}</div>
      <div class="font-num font-bold text-2xl leading-none ${remain < 0 ? "text-brick" : "text-shift"}">${fmtMoney(Math.abs(remain))}</div>
    </div>`;
  sheet.innerHTML = html;
  wrap.appendChild(sheet);

  // смены, которые ещё лежат на телефоне, в сумму не входят — предупреждаем
  const known = new Set(myShifts.map((s) => s.id));
  const unsent = myOutbox().filter((q) => q.mode === "create" && !known.has(q.id) && inSelectedMonth(q.fields.date, selectedYear, selectedMonth)).length;
  if (unsent) {
    wrap.appendChild(el("div", "rounded-xl border border-dashed border-route bg-route/10 px-3 py-2 text-xs text-slate-600",
      `${unsent} ${plural(unsent, "смена ещё не отправлена", "смены ещё не отправлены", "смен ещё не отправлено")} и в сумму пока не ${plural(unsent, "вошла", "вошли", "вошло")}.`));
  }

  wrap.appendChild(el("div", "text-xs font-bold text-slate-400 pt-1", `Авансы за ${MONTHS_RU[selectedMonth].toLowerCase()}`));
  const card = el("div", "bg-white rounded-xl border border-slate-200 overflow-hidden");
  if (!advances.length) {
    card.appendChild(el("div", "p-5 text-sm text-slate-400 text-center", "За этот месяц авансов не было."));
  } else {
    const body = el("div", "divide-y divide-slate-100");
    advances.forEach((a) => {
      const row = el("div", "px-4 py-3 flex items-center justify-between gap-3");
      row.innerHTML = `
        <div class="min-w-0">
          <div class="text-sm text-slate-700">Переведено <span class="font-num">${a.date ? fmtRU(parseISO(a.date)) : "—"}</span></div>
          ${a.note ? `<div class="text-xs text-slate-400 truncate">${escapeHtml(a.note)}</div>` : ""}
        </div>
        <div class="font-num font-semibold text-route-600 shrink-0">${fmtMoney(a.amount)}</div>`;
      body.appendChild(row);
    });
    card.appendChild(body);
  }
  wrap.appendChild(card);

  wrap.appendChild(el("div", "text-[11px] text-slate-400 px-1",
    "Аванс считается за тот месяц, за который выдан, даже если деньги пришли позже. Расчёт ведёт руководитель; если сумма не сходится — напиши в чат."));

  app.appendChild(wrap);
}
