// ============================================================
// УСТАНОВКА НА ТЕЛЕФОН — кнопка и подсказки.
//
// Зачем: водителю не нужно искать пункт установки в меню браузера.
// Что показать, зависит от телефона и браузера:
//   • Chrome и Samsung Internet на Android сами сообщают странице, что
//     приложение можно поставить, — тогда показываем кнопку;
//   • iPhone так не умеет — показываем шаги через «Поделиться»;
//   • страница открыта внутри мессенджера — оттуда поставить нельзя,
//     просим открыть её в обычном браузере;
//   • приложение уже стоит — говорим, где искать значок;
//   • открыто самим установленным приложением — не показываем ничего.
//
// Файл ни от чего не зависит. Остальные файлы зовут его функции только
// после проверки typeof: если он почему-то не загрузился, вход и смены
// работают как раньше, просто без подсказки.
// ============================================================

const INSTALL_HIDE_KEY = "smena-install-hidden"; // подсказку внутри приложения закрыли крестиком
const INSTALL_DONE_KEY = "smena-installed";      // с этого телефона приложение уже ставили
const INSTALL_WAIT_MS = 4000;        // сколько ждём предложения от браузера, прежде чем показать шаги вручную
const INSTALL_DONE_AFTER_MS = 90000; // через сколько после согласия считаем установку завершённой
const INSTALL_UA = navigator.userAgent || "";

let installPromptEvent = null; // браузер разрешил показать своё окно установки
let installAccepted = false;   // человек только что согласился — идёт установка
let installAcceptSeq = 0;      // номер согласия: по нему старый таймер узнаёт, что он уже не актуален
let installAcceptedAt = 0;     // когда согласился (чтобы запоздавший сигнал браузера не начал отсчёт заново)
let installDetected = false;   // браузер сам подтвердил: приложение стоит
let installWaitOver = false;   // подождали предложения браузера и не дождались
let installCopied = null;      // "ok" | "fail" — чем кончилось «Скопировать ссылку»
let installPollTimer = null;

// память телефона может быть закрыта (режим инкогнито и т. п.) — тогда просто не запоминаем
function installLsGet(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
function installLsSet(key, value) { try { localStorage.setItem(key, value); } catch (e) {} }
function installLsDel(key) { try { localStorage.removeItem(key); } catch (e) {} }

// ---------- на чём открыта страница ----------
function installIsIOS() {
  // iPad представляется компьютером Mac, отличаем его по сенсорному экрану
  return /iPhone|iPad|iPod/i.test(INSTALL_UA) || (/Macintosh/i.test(INSTALL_UA) && navigator.maxTouchPoints > 1);
}
function installIsAndroid() { return /Android/i.test(INSTALL_UA); }
function installIsMobile() { return installIsAndroid() || installIsIOS(); }

// страница открыта как установленное приложение, а не вкладкой браузера
function installIsStandalone() {
  try {
    if (["standalone", "fullscreen", "minimal-ui"].some((mode) => window.matchMedia("(display-mode: " + mode + ")").matches)) return true;
  } catch (e) {}
  return navigator.standalone === true; // так отвечает iPhone
}

// Страница открыта внутри другого приложения (мессенджер, соцсеть).
//   • Telegram маскируется под обычный браузер, но оставляет на странице
//     свой служебный объект TelegramWebviewProxy — по нему и узнаём.
//   • Остальные на Android помечают себя буквами «wv».
//   • На iPhone встроенные окна не называют себя Safari.
function installIsInAppBrowser() {
  try { if (typeof window.TelegramWebviewProxy !== "undefined") return true; } catch (e) {}
  if (installIsAndroid()) return /;\s*wv\)/.test(INSTALL_UA);
  if (installIsIOS()) return !/Safari/i.test(INSTALL_UA);
  return false;
}

// ---------- что показывать ----------
// null — ничего; иначе один из видов подсказки
function installKind() {
  if (installIsStandalone()) return null;
  if (installIsInAppBrowser()) return "inapp";
  const mobile = installIsMobile(); // на компьютере хватит кнопки: остальные тексты написаны про телефон
  if (installAccepted) return "installing";
  if (installDetected) return mobile ? "installed" : null; // браузер подтвердил — это главнее всего остального
  if (installPromptEvent) return "prompt";
  if (!mobile) return null;
  if (installLsGet(INSTALL_DONE_KEY) === "1") return "installed";
  if (installIsIOS()) return "ios";
  if (installWaitOver) return "manual";
  return null;
}

const INSTALL_ICONS = {
  phone: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="2" width="12" height="20" rx="2.5"/><path d="M12 7v7M9 11.5l3 3 3-3"/><path d="M10.5 18.5h3"/></svg>`,
  check: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>`,
  open: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/></svg>`,
  share: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="display:inline;vertical-align:-2px"><path d="M12 15V3"/><path d="M8 7l4-4 4 4"/><path d="M7 11H6a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-1"/></svg>`,
  close: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6l12 12M18 6 6 18"/></svg>`,
};

const INSTALL_FIND_ICON = "открой список всех приложений (проведи пальцем вверх по главному экрану) и набери «Смена» в поиске";

// тексты: заголовок, пояснение, шаги, кнопка
//   variant — где показываем: "auth" (экран входа) или "inapp" (внутри приложения)
function installView(kind, variant) {
  const mobile = installIsMobile();
  if (kind === "prompt") {
    return {
      icon: "phone",
      title: mobile ? "Поставь «Смену» на телефон" : "Установи «Смену» как приложение",
      text: mobile
        ? "Появится значок, как у обычного приложения. Вносить смены можно будет и без сети."
        : "Откроется отдельным окном, без вкладок браузера.",
      button: { act: "go", label: mobile ? "Установить на телефон" : "Установить", primary: true },
    };
  }
  if (kind === "installing") {
    return {
      icon: "phone",
      title: "Устанавливается…",
      text: mobile
        ? "Обычно меньше минуты. Повторно нажимать не нужно. Значок «Смена» появится на главном экране или в списке всех приложений — дальше открывай приложение с него."
        : "Значок «Смена» появится в списке приложений компьютера.",
    };
  }
  if (kind === "installed") {
    // installDetected — браузер подтвердил; иначе знаем только, что с этого телефона ставили
    return {
      icon: "check", good: true,
      title: installDetected ? "Приложение уже установлено" : "Приложение уже ставили на этот телефон",
      text: "Открывай его со значка «Смена». Не видишь значок на главном экране — " + INSTALL_FIND_ICON + "."
        + (installDetected ? "" : " Значка нет и там — подожди пару минут, потом открой меню браузера (⋮ или ≡) и выбери пункт «Установить…»."),
    };
  }
  if (kind === "ios") {
    return {
      icon: "phone",
      title: "Поставь «Смену» на главный экран",
      steps: [
        "Нажми «Поделиться» " + INSTALL_ICONS.share + " — квадрат со стрелкой вверх. Не видишь его — сначала нажми три точки ⋯ рядом с адресом.",
        "Прокрути список и выбери «На экран „Домой“».",
        "Нажми «Добавить».",
      ],
      text: "Входить после этого нужно уже в самом приложении. Нет пункта «На экран „Домой“» — открой эту страницу в Safari.",
    };
  }
  if (kind === "inapp") {
    const ios = installIsIOS();
    // подписи короткие, в одну строку: иначе кнопка вырастет и сдвинет форму под собой
    const copyLabel = installCopied === "ok" ? (ios ? "Скопировано. Вставь в Safari" : "Скопировано. Вставь в Chrome")
      : installCopied === "fail" ? (location.origin + location.pathname).replace(/^https?:\/\//, "") // не скопировалось — показываем адрес, чтобы набрать руками
      : "Скопировать ссылку";
    return {
      icon: "open", loud: true,
      title: ios ? "Открой эту страницу в Safari" : "Открой эту страницу в Chrome",
      text: "Сейчас она открыта внутри другого приложения (например, мессенджера) — отсюда «Смену» на телефон не поставить. "
        + (ios ? "Нажми значок компаса или «Открыть в Safari»." : "Нажми три точки ⋮ вверху экрана и выбери «Открыть в Chrome» или «Открыть в браузере».")
        + (variant === "inapp" ? " Там нужно будет войти ещё раз — тем же email и паролем." : ""),
      button: { act: "copy", label: copyLabel },
    };
  }
  if (kind === "manual") {
    return {
      icon: "phone",
      title: "Поставь «Смену» на телефон",
      steps: [
        "Открой меню браузера — значок ⋮ или ≡ в углу экрана.",
        "Выбери «Установить и создать ярлык», «Установить приложение» или «Добавить на главный экран» — название зависит от браузера.",
        "Нажми «Установить».",
      ],
      text: "Пишет «Это приложение уже установлено»? Нажми на эту надпись — приложение откроется. Чтобы найти его значок, " + INSTALL_FIND_ICON + ". Нет таких пунктов в меню — открой страницу в Chrome.",
    };
  }
  return null;
}

// ---------- отрисовка ----------
// Подсказка живёт в «гнёздах» — пустых блоках с пометкой data-install-slot.
// Меняем только их содержимое: поля входа и открытую форму смены не трогаем,
// иначе у человека пропадало бы то, что он набирал.
//   variant: "auth" — на экране входа, "inapp" — внутри приложения (её можно закрыть крестиком)
//   place:   "top" — только просьба открыть в браузере (её важно увидеть сразу),
//            "bottom" — всё остальное (появляется позже и не должно сдвигать кнопки)
function installSlot(variant, place) {
  const slot = document.createElement("div");
  slot.setAttribute("data-install-slot", "");
  slot.dataset.variant = variant;
  slot.dataset.place = place || "bottom";
  slot.hidden = true;
  installFillSlot(slot);
  return slot;
}

function installFillSlot(slot) {
  // подсказка — вещь второстепенная: что бы в ней ни сломалось, экран под ней должен жить
  try {
    installFillSlotUnsafe(slot);
  } catch (e) {
    try { slot.hidden = true; slot.innerHTML = ""; } catch (e2) {}
  }
}

function installFillSlotUnsafe(slot) {
  const variant = slot.dataset.variant === "inapp" ? "inapp" : "auth";
  const place = slot.dataset.place === "top" ? "top" : "bottom";
  const kind = installKind();
  const view = kind ? installView(kind, variant) : null;

  let show = !!view && (place === "top") === (kind === "inapp");
  // внутри приложения подсказку можно закрыть; сообщение «устанавливается» показываем всё равно
  if (show && variant === "inapp" && kind !== "installing" && installLsGet(INSTALL_HIDE_KEY) === "1") show = false;

  if (!show) { slot.hidden = true; slot.innerHTML = ""; slot.dataset.kind = ""; return; }
  slot.hidden = false;
  slot.dataset.kind = kind;

  // вид один и тот же на экране входа и внутри приложения (везде тёмный фон)
  const box = "card p-4" + (view.loud ? " card-accent" : "");
  const iconCls = view.good ? "bg-signal/15 text-signal" : "bg-gold/15 text-gold";
  const textCls = "text-[13px] t-soft leading-relaxed";
  const btnCls = (b) => "btn btn-block mt-3 " + (b.primary ? "btn-gold" : "btn-ghost");

  slot.innerHTML = `
    <div class="${box}">
      <div class="flex items-start gap-3">
        <div class="shrink-0 w-9 h-9 rounded-lg flex items-center justify-center ${iconCls}">${INSTALL_ICONS[view.icon]}</div>
        <div class="min-w-0 flex-1">
          <div class="t-strong">${view.title}</div>
          ${view.steps ? `<ol class="${textCls} list-decimal pl-4 mt-1 space-y-0.5">${view.steps.map((s) => `<li>${s}</li>`).join("")}</ol>` : ""}
          ${view.text ? `<div class="${textCls} mt-1">${view.text}</div>` : ""}
        </div>
        ${variant === "inapp" && kind !== "installing" ? `<button type="button" data-install-hide aria-label="Скрыть подсказку" class="shrink-0 -mt-1 -mr-1 w-8 h-8 rounded-lg flex items-center justify-center t-mute">${INSTALL_ICONS.close}</button>` : ""}
      </div>
      ${view.button ? `<button type="button" data-install-act="${view.button.act}" class="${btnCls(view.button)}">${view.button.label}</button>` : ""}
    </div>`;

  const actBtn = slot.querySelector("[data-install-act]");
  if (actBtn) actBtn.onclick = () => (actBtn.dataset.installAct === "copy" ? installCopyLink() : installRun(actBtn));
  const hideBtn = slot.querySelector("[data-install-hide]");
  if (hideBtn) hideBtn.onclick = () => { installLsSet(INSTALL_HIDE_KEY, "1"); refreshInstallUi(); };
}

// состояние поменялось — обновляем все гнёзда, которые сейчас есть на экране
function refreshInstallUi() {
  try {
    document.querySelectorAll("[data-install-slot]").forEach(installFillSlot);
  } catch (e) {}
}

// ---------- действия ----------
// «Установить»: показываем окно браузера и ждём, что человек ответит
async function installRun(btn) {
  const ev = installPromptEvent;
  if (!ev) { refreshInstallUi(); return; }
  btn.disabled = true;
  installPromptEvent = null; // предложение одноразовое: второй раз то же самое показать нельзя
  try {
    // ответ приходит двумя путями (у старых браузеров — только вторым); берём, какой придёт первым
    const later = ev.userChoice && typeof ev.userChoice.then === "function" ? ev.userChoice : null;
    const shown = Promise.resolve(ev.prompt()).then((r) => (r && r.outcome ? r : later));
    const choice = await (later ? Promise.race([shown, later]) : shown);
    if (choice && choice.outcome === "accepted") installMarkAccepted();
    // отказался или закрыл окно: браузер обычно тут же предлагает установку
    // заново, и кнопка возвращается; если нет — останутся шаги «через меню»
  } catch (e) {}
  refreshInstallUi();
}

function installMarkAccepted() {
  const seq = ++installAcceptSeq;
  installAccepted = true;
  installAcceptedAt = Date.now();
  installLsSet(INSTALL_DONE_KEY, "1");
  installStartPolling();
  // Не каждый браузер умеет подтвердить, что установка закончилась. Чтобы
  // «Устанавливается…» не висело вечно, через полторы минуты считаем её
  // завершённой. Если на деле она сорвалась, браузер снова предложит
  // установку — и кнопка вернётся сама.
  setTimeout(() => {
    if (seq !== installAcceptSeq || !installAccepted) return; // это таймер от прошлого согласия
    installAccepted = false;
    refreshInstallUi();
  }, INSTALL_DONE_AFTER_MS);
}

// «Скопировать ссылку»: чтобы вставить её в адресную строку нормального браузера
async function installCopyLink() {
  const url = location.origin + location.pathname;
  let ok = false;
  try {
    await navigator.clipboard.writeText(url);
    ok = true;
  } catch (e) {
    try {
      const ta = document.createElement("textarea");
      ta.value = url;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      ok = document.execCommand("copy");
      ta.remove();
    } catch (e2) {}
  }
  installCopied = ok ? "ok" : "fail";
  refreshInstallUi();
}

// ---------- что сообщает браузер ----------
// Спрашиваем браузер, стоит ли уже приложение. Умеет это только Chrome на
// Android, и только если в manifest.json приложение указано в
// related_applications; остальные браузеры честно отвечают «не знаю».
function installCheckInstalled() {
  try {
    if (!navigator.getInstalledRelatedApps) return Promise.resolve(false);
    return navigator.getInstalledRelatedApps()
      .then((apps) => Array.isArray(apps) && apps.some((a) => a && a.platform === "webapp"))
      .catch(() => false);
  } catch (e) {
    return Promise.resolve(false);
  }
}

function installNoteDetected() {
  if (installDetected && !installAccepted && !installPromptEvent) return;
  installDetected = true;
  installAccepted = false;
  installPromptEvent = null; // браузер подтвердил установку — предлагать её больше незачем
  installLsSet(INSTALL_DONE_KEY, "1");
  installStopPolling();
  refreshInstallUi();
}

// после согласия установка идёт в фоне до минуты — ждём, пока браузер её подтвердит
function installStartPolling() {
  if (installPollTimer || !navigator.getInstalledRelatedApps) return;
  let tries = 0;
  installPollTimer = setInterval(() => {
    tries++;
    installCheckInstalled().then((yes) => {
      if (yes) installNoteDetected();
      else if (tries >= 36) installStopPolling(); // три минуты — дальше не спрашиваем
    });
  }, 5000);
}
function installStopPolling() {
  if (installPollTimer) { clearInterval(installPollTimer); installPollTimer = null; }
}

// Браузер готов поставить приложение (значит, сейчас оно не установлено).
// installAccepted здесь не сбрасываем: если человек только что согласился,
// «Устанавливается…» должно спокойно довисеть свои полторы минуты, а не
// мигнуть обратно в кнопку. Предложение при этом запоминаем — пригодится,
// если установка сорвалась.
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault(); // окно покажем сами, по кнопке
  installPromptEvent = e;
  installDetected = false;
  installLsDel(INSTALL_DONE_KEY);
  refreshInstallUi();
});

// Браузер сообщил об установке. Если это отклик на нашу же кнопку (согласие
// было только что), отсчёт уже идёт — заново его не начинаем. Иначе
// приложение поставили через меню браузера — тогда отмечаем сами.
window.addEventListener("appinstalled", () => {
  installPromptEvent = null;
  const fresh = Date.now() - installAcceptedAt < 5 * 60000;
  if (!installDetected && !fresh) installMarkAccepted();
  refreshInstallUi();
});

// вернулся на страницу (например, после установки) — переспросим
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") installCheckInstalled().then((yes) => { if (yes) installNoteDetected(); });
});

// страница сама стала окном приложения (так бывает на компьютере сразу после установки)
try {
  const installModeQuery = window.matchMedia("(display-mode: standalone)");
  if (installModeQuery.addEventListener) installModeQuery.addEventListener("change", refreshInstallUi);
  else if (installModeQuery.addListener) installModeQuery.addListener(refreshInstallUi);
} catch (e) {}

installCheckInstalled().then((yes) => { if (yes) installNoteDetected(); });

// предложение от браузера приходит через 1–3 секунды после загрузки;
// не пришло — показываем, как поставить через меню
(function () {
  const startWait = () => setTimeout(() => { installWaitOver = true; refreshInstallUi(); }, INSTALL_WAIT_MS);
  if (document.readyState === "complete") startWait();
  else window.addEventListener("load", startWait);
})();
