// ============================================================
// СМЕНА — приложение водителей техники в Новосибирске.
//
// Водитель сам вносит смену (дата, техника, часы, фото путевого),
// она сразу попадает в Табель: пишем в ту же коллекцию tabelShifts.
// Свои коллекции у приложения только служебные:
//   nskUsers  — заявки на доступ (кто зарегистрировался)
//   nskAccess — выданный доступ + ставки водителя (ведёт Табель)
//   nskChat   — чат бригады
//   nskPush   — адреса для push-уведомлений
// ============================================================

firebase.initializeApp(FIREBASE_CONFIG);
const auth = firebase.auth();
const db = firebase.firestore();

// офлайн-кэш Firestore — без него приложение виснет без сети
db.enablePersistence({ synchronizeTabs: true }).catch(() => {});

const app = document.getElementById("app");

// ---------- кто вошёл (заполняет auth.js) ----------
let currentUser = null;    // пользователь Firebase Auth
let currentRole = null;    // "driver" | "manager"
let currentAccess = null;  // для водителя: { driverId, fullName, hourlyRate, shiftRate, active }
let currentName = "";      // как подписывать человека в шапке и в чате

// ---------- состояние экрана ----------
let appStarted = false;
let currentTab = "shifts";
let selectedMonth = new Date().getMonth();
let selectedYear = new Date().getFullYear();
let unsubs = []; // подписки на базу — снимаем при выходе

const MONTHS_RU = ["Январь","Февраль","Март","Апрель","Май","Июнь","Июль","Август","Сентябрь","Октябрь","Ноябрь","Декабрь"];
const WEEKDAYS_RU = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];

const ICONS = {
  shifts: `<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 3v3M16 3v3"/></svg>`,
  money: `<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="14" rx="2"/><path d="M2 10h20"/><path d="M6 15h4"/></svg>`,
  chat: `<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.7 8.7 0 0 1-4-1L3 20l1-5.5a8.38 8.38 0 0 1-1-4A8.38 8.38 0 0 1 11.5 2a8.5 8.5 0 0 1 9.5 9.5z"/></svg>`,
  plus: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>`,
  camera: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="inline -mt-0.5 mr-1.5"><path d="M4 8a2 2 0 0 1 2-2h1l1.5-2h7L17 6h1a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><circle cx="12" cy="13" r="3.5"/></svg>`,
  cameraBig: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8a2 2 0 0 1 2-2h1l1.5-2h7L17 6h1a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><circle cx="12" cy="13" r="3.5"/></svg>`,
  clock: `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>`,
  alert: `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 2.5 20h19z"/><path d="M12 10v4M12 17h.01"/></svg>`,
  lock: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>`,
  pencil: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/></svg>`,
  bell: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="inline -mt-0.5 mr-1"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>`,
  send: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12 20 4l-6 16-3-7z"/><path d="m11 13 9-9"/></svg>`,
  clip: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5V17a4 4 0 0 1-4 4H8a5 5 0 0 1-5-5V8a4 4 0 0 1 4-4 4 4 0 0 1 4 4v8a2 2 0 0 1-4 0V9"/></svg>`,
  trash: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>`,
  close: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6l12 12M18 6 6 18"/></svg>`,
};

// ---------- мелкие помощники ----------
function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function pad2(n) { return String(n).padStart(2, "0"); }
function isoOf(d) { return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }
function todayISO() { return isoOf(new Date()); }
function parseISO(s) { return new Date(s + "T00:00:00"); }
function addDaysISO(iso, days) { const d = parseISO(iso); d.setDate(d.getDate() + days); return isoOf(d); }
function fmtRU(d) { return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" }); }
// «07.10, ср»
function fmtDay(iso) {
  if (!iso) return "—";
  const d = parseISO(iso);
  return pad2(d.getDate()) + "." + pad2(d.getMonth() + 1) + ", " + WEEKDAYS_RU[d.getDay()];
}
function fmtMoney(n) { return Math.round(n || 0).toLocaleString("ru-RU") + " ₽"; }
// 8 → «8», 7.5 → «7,5»
function fmtHours(h) { return String(Math.round(Number(h || 0) * 100) / 100).replace(".", ","); }
function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
function inSelectedMonth(dateStr, year, month) {
  if (!dateStr) return false;
  const p = String(dateStr).split("-");
  return parseInt(p[0], 10) === year && parseInt(p[1], 10) - 1 === month;
}
// То же сопоставление людей, что в Табеле: по фамилии и имени (первые два
// слова), чтобы «Мусаев Абдула» и «Мусаев Абдула Могомедович» были одним
// человеком. Менять здесь — только вместе с nameKey в Табеле.
function nameKey(name) {
  return String(name || "").trim().toLowerCase().split(/\s+/).slice(0, 2).join(" ");
}
// «Иванов Иван Иванович» → «Иванов Иван»
function shortName(name) {
  return String(name || "").trim().split(/\s+/).slice(0, 2).join(" ");
}
function isManagerEmail(email) {
  const e = String(email || "").toLowerCase();
  return MANAGER_EMAILS.map((x) => x.toLowerCase()).includes(e);
}

// короткое сообщение поверх экрана
function toast(text, isError) {
  const t = el("div", `fixed top-3 left-1/2 -translate-x-1/2 z-50 ${isError ? "bg-brick" : "bg-diesel"} text-white rounded-xl shadow-lg px-4 py-3 max-w-xs w-[90%] text-sm`);
  t.textContent = text;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), isError ? 6000 : 3500);
}

// ---------- фото: сжатие на телефоне и загрузка в Cloudinary ----------
function resizeImage(file, maxDim = 1600, quality = 0.75) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      let { width, height } = img;
      if (width >= height && width > maxDim) { height = Math.round(height * (maxDim / width)); width = maxDim; }
      else if (height > maxDim) { width = Math.round(width * (maxDim / height)); height = maxDim; }
      const canvas = document.createElement("canvas");
      canvas.width = width; canvas.height = height;
      canvas.getContext("2d").drawImage(img, 0, 0, width, height);
      canvas.toBlob((blob) => { URL.revokeObjectURL(url); blob ? resolve(blob) : reject(new Error("Не удалось обработать фото")); }, "image/jpeg", quality);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Не удалось открыть фото")); };
    img.src = url;
  });
}
function uploadToCloudinary(blob) {
  const form = new FormData();
  form.append("file", blob);
  form.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);
  return fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`, { method: "POST", body: form })
    .then(async (r) => {
      if (!r.ok) {
        const err = new Error("Не удалось загрузить фото (код " + r.status + ")");
        err.httpStatus = r.status; // по коду отличаем «сервер занят» от «фото не принято»
        throw err;
      }
      const data = await r.json();
      if (!data.secure_url) throw new Error("Облако не вернуло ссылку на фото");
      return data.secure_url;
    });
}

// ---------- просмотр фото во весь экран ----------
function openLightbox(urls, startIndex) {
  const list = (Array.isArray(urls) ? urls : [urls]).filter(Boolean);
  if (!list.length) return;
  let i = startIndex || 0;
  const overlay = el("div", "fixed inset-0 z-50 bg-black/90 flex flex-col");
  const top = el("div", "flex items-center justify-between px-4 py-3 text-white/70 text-sm");
  const counter = el("div", "font-num");
  const closeBtn = el("button", "px-3 py-1.5 rounded-lg bg-white/10 text-white text-sm font-semibold", "Закрыть");
  top.appendChild(counter); top.appendChild(closeBtn);
  const stage = el("div", "flex-1 flex items-center justify-center px-2 pb-4 min-h-0");
  const img = el("img", "max-w-full max-h-full object-contain rounded-lg");
  stage.appendChild(img);
  overlay.appendChild(top); overlay.appendChild(stage);
  function show() {
    img.src = list[i];
    counter.textContent = list.length > 1 ? `${i + 1} / ${list.length}` : "";
  }
  if (list.length > 1) {
    const navRow = el("div", "flex gap-2 px-4 pb-5");
    const prev = el("button", "flex-1 py-2.5 rounded-lg bg-white/10 text-white text-sm font-semibold", "Назад");
    const next = el("button", "flex-1 py-2.5 rounded-lg bg-white/10 text-white text-sm font-semibold", "Дальше");
    prev.onclick = () => { i = (i - 1 + list.length) % list.length; show(); };
    next.onclick = () => { i = (i + 1) % list.length; show(); };
    navRow.appendChild(prev); navRow.appendChild(next);
    overlay.appendChild(navRow);
  }
  closeBtn.onclick = () => overlay.remove();
  stage.onclick = (e) => { if (e.target === stage) overlay.remove(); };
  show();
  document.body.appendChild(overlay);
}

// ---------- запуск и остановка ----------
function startApp() {
  if (appStarted) return;
  appStarted = true;
  currentTab = "shifts";
  selectedMonth = new Date().getMonth();
  selectedYear = new Date().getFullYear();
  renderUserBar();
  buildNav();
  wireNav();
  if (currentRole === "manager") subscribeManagerData(); else subscribeDriverData();
  subscribeChat();
  render();
  refreshOutbox().then(() => { softRender(); flushOutbox(); });
  if (typeof clearUnreadBadge === "function") clearUnreadBadge();
}

// выход или отзыв доступа: снимаем подписки и забываем чужие данные
function stopApp() {
  appStarted = false;
  unsubs.forEach((u) => { try { u(); } catch (e) {} });
  unsubs = [];
  if (typeof resetShiftsState === "function") resetShiftsState();
  if (typeof resetMoneyState === "function") resetMoneyState();
  if (typeof resetChatState === "function") resetChatState();
  if (typeof removeChatInputBar === "function") removeChatInputBar();
  app.innerHTML = "";
}

function logout() {
  auth.signOut();
}

// ---------- шапка ----------
function renderUserBar() {
  const bar = document.getElementById("user-bar");
  if (!bar) return;
  const roleLabel = currentRole === "manager" ? "Руководитель" : "Водитель";
  bar.innerHTML = `
    <img src="icon-192.png" alt="" class="w-7 h-7 rounded-full object-cover ring-1 ring-route/50 shrink-0" />
    <span class="text-slate-300 truncate">${escapeHtml(currentName)}</span>
    <span class="text-slate-400 text-[10px] bg-white/10 px-2 py-0.5 rounded-full shrink-0">${roleLabel}</span>
    <button id="logout-btn" class="ml-auto shrink-0 text-slate-400 text-xs underline">Выйти</button>`;
  document.getElementById("logout-btn").onclick = () => {
    const waiting = (typeof outboxCache !== "undefined" ? outboxCache : []).filter((q) => currentUser && q.uid === currentUser.uid).length;
    if (waiting && !confirm(`На телефоне ${waiting} ${plural(waiting, "смена ждёт", "смены ждут", "смен ждут")} отправки. Они сохранятся и уйдут, когда войдёшь снова. Выйти?`)) return;
    logout();
  };
}

// главная цифра — сколько начислено за выбранный месяц:
// водителю — ему самому, руководителю — всем водителям вместе
function renderHeaderHero() {
  const hero = document.getElementById("header-hero");
  if (!hero || !appStarted) return;
  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 5 ? "Доброй ночи" : hour < 12 ? "Доброе утро" : hour < 18 ? "Добрый день" : "Добрый вечер";
  const monthLow = MONTHS_RU[selectedMonth].toLowerCase();

  let hello = greeting, value = "—", caption = "";
  if (currentRole === "manager") {
    const t = managerTotals();
    const isCurrentMonth = selectedYear === now.getFullYear() && selectedMonth === now.getMonth();
    value = fmtMoney(t.pay);
    caption = `начислено всем за ${monthLow}: ${t.count} ${plural(t.count, "смена", "смены", "смен")}`
      + (isCurrentMonth ? `, из них сегодня ${t.today}` : "");
  } else {
    // в карточке водителя ФИО идёт как «Фамилия Имя Отчество» — берём имя
    const words = String(currentAccess && currentAccess.fullName || "").trim().split(/\s+/);
    const first = words[1] || words[0] || "";
    if (first) hello = `${greeting}, ${escapeHtml(first)}`;
    const t = driverMonthTotals();
    value = fmtMoney(t.pay);
    caption = t.count
      ? `начислено за ${monthLow}: ${t.count} ${plural(t.count, "смена", "смены", "смен")}${t.hours ? ", " + fmtHours(t.hours) + " ч" : ""}`
      : `за ${monthLow} смен пока нет`;
  }

  hero.innerHTML = `
    <div class="text-sm text-white/60">${hello}</div>
    <div class="text-4xl font-bold font-num tracking-tight leading-none mt-1.5">${value}</div>
    <div class="text-xs text-white/55 mt-2">${caption}</div>
    <div class="mt-3 text-[11px] text-white/40 font-num tracking-wide">ТЕХНИКА · НОВОСИБИРСК</div>`;
}

// ---------- навигация ----------
function allowedTabs() {
  return currentRole === "manager" ? ["shifts", "chat"] : ["shifts", "money", "chat"];
}

function buildNav() {
  const nav = document.getElementById("nav");
  const all = {
    shifts: [ICONS.shifts, "Смены"],
    money: [ICONS.money, "Деньги"],
    chat: [ICONS.chat, "Чат"],
  };
  nav.innerHTML = allowedTabs().map((tab) => `
    <button class="tabbtn relative flex flex-col items-center gap-1 px-5 py-1 text-white/50 text-[10px] font-medium" data-tab="${tab}">
      <span class="tabicon-wrap w-8 h-8 rounded-full flex items-center justify-center transition-colors"><span class="tabicon">${all[tab][0]}</span></span>
      ${all[tab][1]}
    </button>`).join("");
}

function wireNav() {
  document.querySelectorAll(".tabbtn").forEach((btn) => {
    btn.onclick = () => {
      currentTab = btn.dataset.tab;
      if (typeof closeShiftForm === "function") closeShiftForm();
      render();
      window.scrollTo(0, 0);
    };
  });
}

function render() {
  if (!appStarted) return;
  if (!allowedTabs().includes(currentTab)) currentTab = "shifts";
  if (currentTab !== "chat") removeChatInputBar();
  if (currentTab === "shifts") {
    if (currentRole === "manager") renderManagerShifts(); else renderDriverShifts();
  } else if (currentTab === "money") {
    renderMoney();
  } else if (currentTab === "chat") {
    renderChat();
  }
  document.querySelectorAll(".tabbtn").forEach((b) => {
    b.classList.toggle("tab-active", b.dataset.tab === currentTab);
  });
  renderHeaderHero();
  if (typeof updateChatNavBadge === "function") updateChatNavBadge();
}

// Перерисовка «по данным» (пришло обновление из базы, ушла очередь).
// Никогда не трогает открытую форму смены и поле ввода чата — иначе
// у человека на глазах пропадает то, что он набирал.
function softRender() {
  if (!appStarted) return;
  const formOpen = typeof shiftFormOpen !== "undefined" && shiftFormOpen;
  if (formOpen || currentTab === "chat") { renderHeaderHero(); return; }
  render();
}

// ---------- переключатель месяца (общий для вкладок) ----------
function monthSwitcher() {
  const now = new Date();
  const atCurrent = selectedYear === now.getFullYear() && selectedMonth === now.getMonth();
  const wrap = el("div", "bg-white rounded-xl border border-slate-200 p-3 flex items-center justify-between");
  const prev = el("button", "w-9 h-9 rounded-lg bg-slate-100 text-slate-500 font-bold", "‹");
  const next = el("button", `w-9 h-9 rounded-lg bg-slate-100 font-bold ${atCurrent ? "text-slate-300" : "text-slate-500"}`, "›");
  prev.setAttribute("aria-label", "Предыдущий месяц");
  next.setAttribute("aria-label", "Следующий месяц");
  const label = el("div", "font-bold font-display text-diesel", `${MONTHS_RU[selectedMonth]} ${selectedYear}`);
  prev.onclick = () => {
    selectedMonth--; if (selectedMonth < 0) { selectedMonth = 11; selectedYear--; }
    onMonthChanged();
  };
  next.onclick = () => {
    if (atCurrent) return; // в будущем смен нет
    selectedMonth++; if (selectedMonth > 11) { selectedMonth = 0; selectedYear++; }
    onMonthChanged();
  };
  wrap.appendChild(prev); wrap.appendChild(label); wrap.appendChild(next);
  return wrap;
}
function onMonthChanged() {
  if (currentRole === "manager" && typeof subscribeManagerMonth === "function") subscribeManagerMonth();
  render();
}

function statCard(label, value, colorClass) {
  const c = el("div", "bg-white rounded-xl border border-slate-200 p-3 text-center");
  c.innerHTML = `<div class="text-base font-bold font-num ${colorClass || "text-diesel"}">${value}</div><div class="text-[10px] text-slate-400 mt-0.5">${label}</div>`;
  return c;
}

// приложение ставится на телефон и работает без сети через service worker
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
