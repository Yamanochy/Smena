// ============================================================
// СМЕНА — приложение водителей техники в Новосибирске.
//
// Водитель сам вносит смену (дата, техника, заказчик, часы, фото
// путевого листа). Куда она попадает, зависит от того, чей он:
//   наш водитель        → tabelShifts: это коллекция Табеля, смена сразу
//                         видна там и идёт в зарплату;
//   водитель подрядчика → nskWaybills: отдельная коллекция, Табель её
//                         не читает, в зарплату запись попасть не может.
// Чей водитель — отмечает руководитель при подтверждении заявки
// (вкладка «Водители»), пометка лежит в документе доступа (kind).
//
// Служебные коллекции приложения:
//   nskUsers    — заявки на доступ (кто зарегистрировался)
//   nskAccess   — выданный доступ: чей водитель, ФИО, для наших — ставки
//   nskWaybills — путевые водителей подрядчиков
//   nskConfig   — справочники: заказчики и подрядчики
//   nskChat     — чат бригады
//   nskPush     — адреса для push-уведомлений
//
// Файлы: app.js (это ядро) · lists.js (справочники и техника) ·
// shifts.js (экран водителя) · manager.js (путевые и реестры) ·
// people.js (водители и заявки) · catalog.js (справочники) ·
// money.js · chat.js · auth.js · outbox.js · install.js
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
let currentAccess = null;  // для водителя — его документ доступа (nskAccess)
let currentName = "";      // как подписывать человека в шапке и в чате

// ---------- состояние экрана ----------
let appStarted = false;
let currentTab = "shifts";
let selectedMonth = new Date().getMonth();
let selectedYear = new Date().getFullYear();
let unsubs = []; // подписки на базу — снимаем при выходе

const MONTHS_RU = ["Январь","Февраль","Март","Апрель","Май","Июнь","Июль","Август","Сентябрь","Октябрь","Ноябрь","Декабрь"];
const MONTHS_SHORT = ["янв","фев","мар","апр","мая","июн","июл","авг","сен","окт","ноя","дек"];
const WEEKDAYS_RU = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];

const svg = (size, body, sw) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw || 2}" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
const ICONS = {
  shifts: svg(21, `<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 3v3M16 3v3"/>`),
  money: svg(21, `<rect x="2" y="6" width="20" height="14" rx="2"/><path d="M2 10h20"/><path d="M6 15h4"/>`),
  chat: svg(21, `<path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.7 8.7 0 0 1-4-1L3 20l1-5.5a8.38 8.38 0 0 1-1-4A8.38 8.38 0 0 1 11.5 2a8.5 8.5 0 0 1 9.5 9.5z"/>`),
  waybills: svg(21, `<path d="M7 3h8l4 4v14H7z"/><path d="M15 3v4h4"/><path d="M10 12h6M10 16h6"/>`),
  people: svg(21, `<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.6-5.5 6-5.5s6 2.2 6 5.5"/><path d="M16 5.2a3 3 0 0 1 0 5.6M17.5 14.8c2.1.6 3.5 2.3 3.5 4.7"/>`),
  catalog: svg(21, `<path d="M2 17h1M21 17h1M3 17V10a1 1 0 0 1 1-1h5l2-3h3v6h6a1 1 0 0 1 1 1v4"/><path d="M16 17H8"/><circle cx="6.5" cy="17" r="2"/><circle cx="17.5" cy="17" r="2"/>`),
  plus: svg(16, `<path d="M12 5v14M5 12h14"/>`, 2.4),
  camera: svg(15, `<path d="M4 8a2 2 0 0 1 2-2h1l1.5-2h7L17 6h1a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><circle cx="12" cy="13" r="3.5"/>`),
  cameraBig: svg(22, `<path d="M4 8a2 2 0 0 1 2-2h1l1.5-2h7L17 6h1a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><circle cx="12" cy="13" r="3.5"/>`, 1.8),
  clock: svg(10, `<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>`, 2.5),
  alert: svg(10, `<path d="M12 3 2.5 20h19z"/><path d="M12 10v4M12 17h.01"/>`, 2.5),
  check: svg(10, `<path d="M5 12.5l4.5 4.5L19 7.5"/>`, 3),
  lock: svg(13, `<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>`),
  pencil: svg(13, `<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>`),
  bell: svg(13, `<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>`),
  send: svg(18, `<path d="M4 12 20 4l-6 16-3-7z"/><path d="m11 13 9-9"/>`),
  clip: svg(18, `<path d="M21 11.5V17a4 4 0 0 1-4 4H8a5 5 0 0 1-5-5V8a4 4 0 0 1 4-4 4 4 0 0 1 4 4v8a2 2 0 0 1-4 0V9"/>`),
  trash: svg(13, `<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>`),
  close: svg(12, `<path d="M6 6l12 12M18 6 6 18"/>`, 2.6),
  download: svg(16, `<path d="M12 3v12m0 0-4-4m4 4 4-4"/><path d="M4 20h16"/>`, 2.2),
  chevron: svg(14, `<path d="m9 6 6 6-6 6"/>`, 2.4),
  open: svg(14, `<path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/>`),
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
// «2026-10-07» → «07.10.2026»
function fmtISO(iso) { return iso ? fmtRU(parseISO(iso)) : "—"; }
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
// «Иванов Иван Иванович» → «Иванов И.И.» (для шапки)
function initialsName(name) {
  const w = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (w.length < 2 || w[0].includes("@")) return w.join(" ");
  return w[0] + " " + w.slice(1, 3).map((x) => x[0].toUpperCase() + ".").join("");
}
function isManagerEmail(email) {
  const e = String(email || "").toLowerCase();
  return MANAGER_EMAILS.map((x) => x.toLowerCase()).includes(e);
}
// чей водитель по документу доступа: true — подрядчика, false — наш
function isContractorAccess(access) {
  return !!access && access.kind === "contractor";
}

// дата слева в строке: число крупно, под ним «окт, пн»
function dateboxHtml(iso) {
  if (!iso) return `<div class="datebox"><div class="d">—</div></div>`;
  const d = parseISO(iso);
  return `<div class="datebox"><div class="d">${pad2(d.getDate())}</div><div class="m">${MONTHS_SHORT[d.getMonth()]}, ${WEEKDAYS_RU[d.getDay()]}</div></div>`;
}

// короткое сообщение поверх экрана
function toast(text, isError) {
  const t = el("div", "toast" + (isError ? " toast-bad" : ""));
  t.setAttribute("role", "status");
  t.textContent = text;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), isError ? 6000 : 3500);
}

// окно, выезжающее снизу. Возвращает { overlay, card, close }.
function openSheet(html) {
  const overlay = el("div", "sheet-overlay");
  const card = el("div", "sheet space-y-3", html);
  overlay.appendChild(card);
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.onclick = (e) => { if (e.target === overlay) close(); };
  return { overlay, card, close };
}

// Действия руководителя (подтвердить, сохранить, удалить) требуют связи:
// без неё запись в базу не завершается, и кнопка «думала» бы бесконечно.
// Возвращает true, если сети нет, — и сам пишет об этом через say(текст).
function offlineBlocked(say) {
  if (navigator.onLine) return false;
  (say || ((t) => toast(t, true)))("Нет сети. Попробуй ещё раз, когда появится связь.");
  return true;
}

// подгрузить внешний модуль один раз (Excel — только по кнопке руководителя)
const loadedScripts = {};
function loadScriptOnce(url) {
  if (!loadedScripts[url]) {
    loadedScripts[url] = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = url;
      s.onload = resolve;
      s.onerror = () => { delete loadedScripts[url]; s.remove(); reject(new Error("не загрузился " + url)); };
      document.head.appendChild(s);
    });
  }
  return loadedScripts[url];
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
  const overlay = el("div", "fixed inset-0 z-50 bg-black/95 flex flex-col");
  const top = el("div", "flex items-center justify-between px-4 py-3 text-sm");
  const counter = el("div", "num t-soft");
  const closeBtn = el("button", "btn btn-ghost btn-sm", "Закрыть");
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
    const prev = el("button", "btn btn-ghost flex-1", "Назад");
    const next = el("button", "btn btn-ghost flex-1", "Дальше");
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

// маленькая картинка путевого листа в строке списка
function photoThumb(photos, size) {
  const px = size || 48;
  const list = Array.isArray(photos) ? photos : [];
  const b = el("button", "relative shrink-0 rounded-lg bg-deck border border-rivet overflow-hidden flex items-center justify-center text-mute");
  b.type = "button";
  b.style.width = b.style.height = px + "px";
  b.setAttribute("aria-label", list.length ? "Фото путевого листа" : "Фото нет");
  if (list[0]) {
    b.innerHTML = `<img src="${escapeHtml(list[0])}" alt="" loading="lazy" style="width:${px}px;height:${px}px;object-fit:cover" />`
      + (list.length > 1 ? `<span class="absolute bottom-0.5 right-0.5 bg-night/90 text-chalk text-[9px] num rounded px-1">+${list.length - 1}</span>` : "");
    b.onclick = (e) => { e.stopPropagation(); openLightbox(list); };
  } else {
    b.innerHTML = ICONS.cameraBig;
    b.disabled = true;
  }
  return b;
}

// ---------- запуск и остановка ----------
function startApp() {
  if (appStarted) return;
  appStarted = true;
  currentTab = currentRole === "manager" ? "waybills" : "shifts";
  selectedMonth = new Date().getMonth();
  selectedYear = new Date().getFullYear();
  renderUserBar();
  buildNav();
  subscribeLists();
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
  if (typeof resetListsState === "function") resetListsState();
  if (typeof resetShiftsState === "function") resetShiftsState();
  if (typeof resetManagerState === "function") resetManagerState();
  if (typeof resetPeopleState === "function") resetPeopleState();
  if (typeof resetMoneyState === "function") resetMoneyState();
  if (typeof resetChatState === "function") resetChatState();
  if (typeof removeChatInputBar === "function") removeChatInputBar();
  document.querySelectorAll(".sheet-overlay").forEach((o) => o.remove());
  app.innerHTML = "";
}

function logout() {
  auth.signOut();
}

// ---------- шапка ----------
function roleLabel() {
  return currentRole === "manager" ? "Руководитель" : "Водитель";
}

function renderUserBar() {
  const bar = document.getElementById("user-bar");
  if (!bar) return;
  // имя — отдельной строкой во всю ширину: на узком телефоне рядом с
  // кнопкой «Выйти» длинная фамилия не помещалась
  bar.innerHTML = `
    <div class="flex items-center gap-3">
      <img src="icon-192.png" alt="" class="logo-sm" />
      <div class="wordmark min-w-0 flex-1">Смена</div>
      <button id="logout-btn" type="button" class="btn btn-quiet btn-sm shrink-0 -mr-2">Выйти</button>
    </div>
    <div class="who">${roleLabel()}: <b>${escapeHtml(initialsName(currentName))}</b></div>`;
  document.getElementById("logout-btn").onclick = () => {
    const waiting = (typeof outboxCache !== "undefined" ? outboxCache : []).filter((q) => currentUser && q.uid === currentUser.uid).length;
    if (waiting && !confirm(`На телефоне ${waiting} ${plural(waiting, "смена ждёт", "смены ждут", "смен ждут")} отправки. Они сохранятся и уйдут, когда войдёшь снова. Выйти?`)) return;
    logout();
  };
}

// три числа под шапкой
function statHtml(label, value, cls, sub, attrs) {
  return `<${attrs ? "button type=\"button\" " + attrs : "div"} class="stat">
    <div class="stat-l">${label}</div>
    <div class="stat-v ${cls || ""}">${value}</div>
    ${sub ? `<div class="stat-s">${sub}</div>` : ""}
  </${attrs ? "button" : "div"}>`;
}

function renderHeaderHero() {
  const hero = document.getElementById("header-hero");
  if (!hero || !appStarted) return;
  const monthName = MONTHS_RU[selectedMonth];

  let html = "";
  if (currentRole === "manager") {
    const t = managerTotals();
    const waiting = typeof waitingRequests === "function" ? waitingRequests().length : 0;
    html += statHtml("Путевых", t.count, "", escapeHtml(t.periodShort));
    html += statHtml("Часов", fmtHours(t.hours), "", t.shiftOnly ? `+ ${t.shiftOnly} без часов` : "за период");
    html += waiting
      ? statHtml("Ждут доступа", waiting, "t-gold", "открыть заявки", `id="hero-waiting"`)
      : statHtml("Водителей", typeof activeDriversCount === "function" ? activeDriversCount() : 0, "", "с доступом");
  } else {
    const t = driverMonthTotals();
    const today = driverTodayState();
    const todayCls = today === "done" ? "t-ok" : today === "wait" ? "t-gold" : "t-soft";
    const todayText = today === "done" ? `Внесена <span class="dot align-middle"></span>` : today === "wait" ? "Ждёт сети" : "Нет смены";
    html += statHtml("Сегодня", todayText, todayCls, fmtDay(todayISO()));
    const shiftsText = `${t.count} ${plural(t.count, "смена", "смены", "смен")}`;
    if (isContractorAccess(currentAccess)) {
      html += statHtml(monthName, shiftsText, "", escapeHtml(contractorName(currentAccess.contractorId, currentAccess.contractorName)));
      html += statHtml("Часов", fmtHours(t.hours), "t-gold", "за месяц");
    } else {
      html += statHtml(monthName, shiftsText, "", t.hours ? fmtHours(t.hours) + " ч" : "часов нет");
      html += statHtml("Начислено", fmtMoney(t.pay), "t-gold", "за месяц");
    }
  }
  hero.innerHTML = `<div class="stats">${html}</div>`;
  const w = document.getElementById("hero-waiting");
  if (w) w.onclick = () => { currentTab = "people"; render(); window.scrollTo(0, 0); };
}

// ---------- навигация ----------
function allowedTabs() {
  if (currentRole === "manager") return ["waybills", "people", "catalog", "chat"];
  return isContractorAccess(currentAccess) ? ["shifts", "chat"] : ["shifts", "money", "chat"];
}

const TAB_INFO = {
  shifts: ["shifts", "Смены"],
  money: ["money", "Деньги"],
  chat: ["chat", "Чат"],
  waybills: ["waybills", "Путевые"],
  people: ["people", "Водители"],
  catalog: ["catalog", "Справочники"],
};

let navBuiltFor = "";
function buildNav() {
  const nav = document.getElementById("nav");
  const tabs = allowedTabs();
  navBuiltFor = tabs.join(",");
  nav.innerHTML = tabs.map((tab) => `
    <button type="button" class="tabbtn" data-tab="${tab}">
      <span class="tabicon">${ICONS[TAB_INFO[tab][0]]}</span>
      <span>${TAB_INFO[tab][1]}</span>
    </button>`).join("");
  nav.querySelectorAll(".tabbtn").forEach((btn) => {
    btn.onclick = () => {
      currentTab = btn.dataset.tab;
      if (typeof closeShiftForm === "function") closeShiftForm();
      render();
      window.scrollTo(0, 0);
    };
  });
}

// значки на вкладках: непрочитанное в чате, заявки у руководителя
function updateNavBadges() {
  if (typeof updateChatNavBadge === "function") updateChatNavBadge();
  const btn = document.querySelector('.tabbtn[data-tab="people"]');
  if (!btn) return;
  let dot = btn.querySelector(".navdot");
  const n = typeof waitingRequests === "function" ? waitingRequests().length : 0;
  if (n > 0) {
    if (!dot) { dot = el("span", "navdot navdot-gold"); btn.appendChild(dot); }
    dot.textContent = n > 9 ? "9+" : String(n);
  } else if (dot) {
    dot.remove();
  }
}

function render() {
  if (!appStarted) return;
  // руководитель мог поменять пометку «чей водитель» — набор вкладок другой
  if (navBuiltFor !== allowedTabs().join(",")) buildNav();
  if (!allowedTabs().includes(currentTab)) currentTab = allowedTabs()[0];
  if (currentTab !== "chat") removeChatInputBar();

  if (currentTab === "shifts") renderDriverShifts();
  else if (currentTab === "money") renderMoney();
  else if (currentTab === "waybills") renderWaybills();
  else if (currentTab === "people") renderPeople();
  else if (currentTab === "catalog") renderCatalog();
  else if (currentTab === "chat") renderChat();

  document.querySelectorAll(".tabbtn").forEach((b) => {
    b.classList.toggle("tab-active", b.dataset.tab === currentTab);
  });
  renderHeaderHero();
  updateNavBadges();
}

// Перерисовка «по данным» (пришло обновление из базы, ушла очередь).
// Никогда не трогает открытую форму смены, поле ввода чата и фильтры
// руководителя — иначе у человека на глазах пропадает то, что он набирал.
function softRender() {
  if (!appStarted) return;
  const formOpen = typeof shiftFormOpen !== "undefined" && shiftFormOpen;
  if (formOpen || currentTab === "chat") { renderHeaderHero(); updateNavBadges(); return; }
  if (currentTab === "waybills" && typeof refreshWaybillResults === "function" && document.getElementById("wb-results")) {
    refreshWaybillResults();
    renderHeaderHero();
    updateNavBadges();
    return;
  }
  render();
}

// ---------- переключатель месяца ----------
function monthSwitcher() {
  const now = new Date();
  const atCurrent = selectedYear === now.getFullYear() && selectedMonth === now.getMonth();
  const wrap = el("div", "flex items-center justify-between");
  const prev = el("button", "btn btn-ghost btn-sm w-10 px-0 text-lg", "‹");
  const next = el("button", "btn btn-ghost btn-sm w-10 px-0 text-lg", "›");
  prev.type = next.type = "button";
  prev.setAttribute("aria-label", "Предыдущий месяц");
  next.setAttribute("aria-label", "Следующий месяц");
  if (atCurrent) next.disabled = true; // в будущем смен нет
  const label = el("div", "title", `${MONTHS_RU[selectedMonth]} ${selectedYear}`);
  prev.onclick = () => {
    selectedMonth--; if (selectedMonth < 0) { selectedMonth = 11; selectedYear--; }
    render();
  };
  next.onclick = () => {
    if (atCurrent) return;
    selectedMonth++; if (selectedMonth > 11) { selectedMonth = 0; selectedYear++; }
    render();
  };
  wrap.appendChild(prev); wrap.appendChild(label); wrap.appendChild(next);
  return wrap;
}

// приложение ставится на телефон и работает без сети через service worker
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
