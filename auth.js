// ============================================================
// ВХОД, РЕГИСТРАЦИЯ И ДОСТУП.
//
// Кода руководителя здесь нет намеренно: любой «секретный код»
// в коде сайта виден каждому, кто откроет страницу.
//   Руководитель — тот, чей email в списке MANAGER_EMAILS
//   (и в правилах базы; именно правила — настоящая защита).
//   Водитель — тот, чей аккаунт руководитель привязал к карточке
//   в Табеле. До привязки человек видит только экран ожидания,
//   к данным его не пускают сами правила базы.
//
// Аккаунты общие с Досатуем: у кого он уже есть, входит тем же
// email и паролем и нажимает «Запросить доступ».
// ============================================================

const authScreen = document.getElementById("auth-screen");
const shell = document.getElementById("app-shell");

let accessUnsub = null;         // подписка на свой документ доступа
let pendingRegistration = null; // { name, phone } — человек только что зарегистрировался

function showShell() { authScreen.classList.add("hidden"); shell.classList.remove("hidden"); }
function showAuth() { shell.classList.add("hidden"); authScreen.classList.remove("hidden"); }

// общая рамка для экранов входа и ожидания
function authFrame(innerHtml) {
  showAuth();
  // Рамка прижата к верху, а не выровнена по центру: под формой позже
  // появляется подсказка про установку, и при выравнивании по центру поля
  // входа уезжали бы из-под пальца.
  authScreen.innerHTML = `
    <div class="min-h-screen flex items-start justify-center px-5 pb-8 bg-diesel" style="padding-top:max(2rem,12vh)">
      <div class="w-full max-w-sm">
        <div class="text-center mb-6">
          <img src="icon-192.png" alt="" class="w-16 h-16 rounded-2xl mx-auto mb-3 shadow" />
          <div class="text-white text-2xl font-bold font-display">Смена</div>
          <div class="text-white/50 text-xs font-num tracking-wide mt-1">ТЕХНИКА · НОВОСИБИРСК</div>
        </div>
        <div data-install-slot data-variant="auth" data-place="top" class="mb-4" hidden></div>
        <div class="bg-white rounded-xl p-5 space-y-3">${innerHtml}</div>
        <div data-install-slot data-variant="auth" data-place="bottom" class="mt-4" hidden></div>
      </div>
    </div>`;
  // кнопка «Установить на телефон» и подсказки — см. install.js
  if (typeof refreshInstallUi === "function") refreshInstallUi();
}

const INPUT_CLS = "mt-1 w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm";

function renderLoginScreen(mode = "login", message = "", isError = true) {
  if (mode === "register") {
    authFrame(`
      <div class="font-bold font-display text-lg text-diesel">Регистрация водителя</div>
      <div class="text-xs text-slate-500">Если у тебя уже есть вход в Досатуй, регистрироваться не нужно — <a href="#" id="af-toggle2" class="font-semibold text-diesel underline">войди тем же email и паролем</a>.</div>
      <label class="block text-xs text-slate-500">Фамилия, имя, отчество
        <input id="af-name" autocomplete="name" class="${INPUT_CLS}" placeholder="Иванов Иван Иванович" />
      </label>
      <label class="block text-xs text-slate-500">Телефон
        <input id="af-phone" type="tel" autocomplete="tel" class="${INPUT_CLS}" placeholder="+7 900 000 00 00" />
      </label>
      <label class="block text-xs text-slate-500">Email
        <input id="af-email" type="email" autocomplete="username" class="${INPUT_CLS}" />
      </label>
      <label class="block text-xs text-slate-500">Пароль (не короче 6 символов)
        <input id="af-pass" type="password" autocomplete="new-password" class="${INPUT_CLS}" />
      </label>
      <div id="af-error" class="text-sm hidden"></div>
      <button id="af-submit" class="w-full py-3 rounded-lg bg-diesel text-white font-semibold text-sm">Зарегистрироваться</button>
      <div class="text-xs text-slate-400">После регистрации руководитель подтвердит доступ — тогда приложение откроется.</div>
      <div class="text-center text-xs text-slate-400 pt-1">Уже есть аккаунт? <a href="#" id="af-toggle" class="text-diesel font-semibold underline">Войти</a></div>`);
  } else {
    authFrame(`
      <label class="block text-xs text-slate-500">Email
        <input id="af-email" type="email" autocomplete="username" class="${INPUT_CLS}" />
      </label>
      <label class="block text-xs text-slate-500">Пароль
        <input id="af-pass" type="password" autocomplete="current-password" class="${INPUT_CLS}" />
      </label>
      <div id="af-error" class="text-sm hidden"></div>
      <button id="af-submit" class="w-full py-3 rounded-lg bg-diesel text-white font-semibold text-sm">Войти</button>
      <button id="af-forgot" class="w-full text-xs text-slate-400 underline">Забыл пароль</button>
      <div class="text-center text-xs text-slate-400 pt-1">Первый раз здесь? <a href="#" id="af-toggle" class="text-diesel font-semibold underline">Зарегистрироваться</a></div>`);
  }

  const errBox = document.getElementById("af-error");
  const say = (text, bad = true) => {
    errBox.textContent = text;
    errBox.className = "text-sm " + (bad ? "text-brick" : "text-shift");
  };
  if (message) say(message, isError);

  const toggle = (e) => { e.preventDefault(); renderLoginScreen(mode === "login" ? "register" : "login"); };
  document.getElementById("af-toggle").onclick = toggle;
  const toggle2 = document.getElementById("af-toggle2");
  if (toggle2) toggle2.onclick = toggle;

  const btn = document.getElementById("af-submit");
  btn.onclick = async () => {
    const email = document.getElementById("af-email").value.trim();
    const pass = document.getElementById("af-pass").value;
    if (mode === "register") {
      const name = document.getElementById("af-name").value.trim().replace(/\s+/g, " ");
      const phone = document.getElementById("af-phone").value.trim();
      if (name.split(" ").length < 2) return say("Напиши фамилию и имя полностью — по ним руководитель тебя узнает.");
      if (!email || pass.length < 6) return say("Нужны email и пароль не короче 6 символов.");
      btn.disabled = true; btn.textContent = "Регистрирую…";
      // запоминаем до создания аккаунта: обработчик входа ниже сработает
      // раньше, чем мы успеем что-то сделать после регистрации
      pendingRegistration = { name, phone };
      try {
        await auth.createUserWithEmailAndPassword(email, pass);
      } catch (e) {
        pendingRegistration = null;
        say(friendlyAuthError(e));
        btn.disabled = false; btn.textContent = "Зарегистрироваться";
      }
    } else {
      if (!email || !pass) return say("Введи email и пароль.");
      btn.disabled = true; btn.textContent = "Вхожу…";
      try {
        await auth.signInWithEmailAndPassword(email, pass);
      } catch (e) {
        say(friendlyAuthError(e));
        btn.disabled = false; btn.textContent = "Войти";
      }
    }
  };

  const forgot = document.getElementById("af-forgot");
  if (forgot) {
    forgot.onclick = async () => {
      const email = document.getElementById("af-email").value.trim();
      if (!email) return say("Сначала впиши email, на который пришлём письмо.");
      try {
        await auth.sendPasswordResetEmail(email);
        say("Письмо для смены пароля отправлено на " + email + ". Проверь и папку «Спам».", false);
      } catch (e) {
        say(friendlyAuthError(e));
      }
    };
  }
}

function friendlyAuthError(e) {
  const map = {
    "auth/email-already-in-use": "Этот email уже зарегистрирован — нажми «Войти».",
    "auth/invalid-email": "В адресе почты ошибка — проверь его.",
    "auth/weak-password": "Пароль слишком простой — нужно не меньше 6 символов.",
    "auth/user-not-found": "Такого пользователя нет. Проверь email или зарегистрируйся.",
    "auth/wrong-password": "Неверный пароль.",
    "auth/invalid-credential": "Неверный email или пароль.",
    "auth/invalid-login-credentials": "Неверный email или пароль.",
    "auth/user-disabled": "Этот аккаунт отключён. Обратись к руководителю.",
    "auth/too-many-requests": "Слишком много попыток. Подожди несколько минут.",
    "auth/network-request-failed": "Нет связи с сервером. Проверь интернет и попробуй ещё раз.",
  };
  return map[e.code] || ("Ошибка: " + e.message);
}

// ---------- экраны «в приложение пока нельзя» ----------
function renderGate(kind, info) {
  const who = `<div class="text-xs text-slate-400">Аккаунт: ${escapeHtml(currentUser && currentUser.email || "")}</div>`;
  const out = `<button id="gate-logout" class="w-full text-xs text-slate-400 underline pt-1">Выйти и войти другим аккаунтом</button>`;
  let html = "";
  if (kind === "checking") {
    html = `<div class="text-sm text-slate-600">Проверяю доступ…</div>${who}${out}`;
  } else if (kind === "offline") {
    html = `
      <div class="font-bold font-display text-lg text-diesel">Нет сети</div>
      <div class="text-sm text-slate-600">Для первого входа нужна связь: приложение должно проверить твой доступ. Как только сеть появится, проверка пройдёт сама.</div>
      ${who}${out}`;
  } else if (kind === "pending") {
    html = `
      <div class="font-bold font-display text-lg text-diesel">Заявка отправлена</div>
      <div class="text-sm text-slate-600">Руководитель подтвердит доступ, и приложение откроется само — заново входить не придётся.</div>
      <div class="text-sm text-slate-600">Если ждёшь больше дня — позвони руководителю.</div>
      ${info && info.name ? `<div class="text-xs text-slate-400">В заявке: ${escapeHtml(info.name)}${info.phone ? ", " + escapeHtml(info.phone) : ""}</div>` : ""}
      ${who}${out}`;
  } else if (kind === "disabled") {
    html = `
      <div class="font-bold font-display text-lg text-brick">Доступ отключён</div>
      <div class="text-sm text-slate-600">Руководитель закрыл этому аккаунту доступ в приложение. Если это ошибка — позвони ему.</div>
      ${who}${out}`;
  } else if (kind === "request") {
    html = `
      <div class="font-bold font-display text-lg text-diesel">Нужен доступ</div>
      <div class="text-sm text-slate-600">Этот аккаунт ещё не подключён к приложению. Отправь заявку — руководитель её подтвердит.</div>
      <label class="block text-xs text-slate-500">Фамилия, имя, отчество
        <input id="gate-name" autocomplete="name" class="${INPUT_CLS}" placeholder="Иванов Иван Иванович" value="${escapeHtml(info && info.name || "")}" />
      </label>
      <label class="block text-xs text-slate-500">Телефон
        <input id="gate-phone" type="tel" autocomplete="tel" class="${INPUT_CLS}" placeholder="+7 900 000 00 00" />
      </label>
      <div id="gate-error" class="text-sm text-brick hidden"></div>
      <button id="gate-submit" class="w-full py-3 rounded-lg bg-diesel text-white font-semibold text-sm">Запросить доступ</button>
      ${who}${out}`;
  } else {
    html = `
      <div class="font-bold font-display text-lg text-brick">Не получилось проверить доступ</div>
      <div class="text-sm text-slate-600">${escapeHtml(info || "Попробуй закрыть и открыть приложение заново.")}</div>
      ${who}${out}`;
  }
  authFrame(html);
  document.getElementById("gate-logout").onclick = () => auth.signOut();

  const submit = document.getElementById("gate-submit");
  if (submit) {
    submit.onclick = async () => {
      const name = document.getElementById("gate-name").value.trim().replace(/\s+/g, " ");
      const phone = document.getElementById("gate-phone").value.trim();
      const errBox = document.getElementById("gate-error");
      if (name.split(" ").length < 2) {
        errBox.textContent = "Напиши фамилию и имя полностью — по ним руководитель тебя узнает.";
        errBox.classList.remove("hidden");
        return;
      }
      submit.disabled = true; submit.textContent = "Отправляю…";
      try {
        await submitAccessRequest(name, phone);
        renderGate("pending", { name, phone });
      } catch (e) {
        errBox.textContent = "Не отправилось: " + (navigator.onLine ? e.message : "нет сети.");
        errBox.classList.remove("hidden");
        submit.disabled = false; submit.textContent = "Запросить доступ";
      }
    };
  }
}

// заявка на доступ — её увидит руководитель в Табеле (вкладка «Водители»)
function submitAccessRequest(name, phone) {
  return db.collection("nskUsers").doc(currentUser.uid).set({
    name,
    phone: phone || "",
    email: currentUser.email || "",
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
  });
}

// доступа нет — выясняем, подавал ли человек заявку
async function resolveNoAccess(user) {
  if (pendingRegistration) {
    const reg = pendingRegistration;
    pendingRegistration = null;
    try {
      await submitAccessRequest(reg.name, reg.phone);
      if (currentUser === user) renderGate("pending", reg);
    } catch (e) {
      // аккаунт создан, а заявка не ушла — дадим отправить её кнопкой
      if (currentUser === user) renderGate("request", reg);
    }
    return;
  }
  try {
    const req = await db.collection("nskUsers").doc(user.uid).get();
    if (currentUser !== user) return;
    if (req.exists) { renderGate("pending", req.data()); return; }
    // имя подставим из профиля Досатуя, если человек оттуда
    let name = "";
    try {
      const prof = await db.collection("users").doc(user.uid).get();
      name = (prof.exists && prof.data().name) || "";
    } catch (e) {}
    if (currentUser === user) renderGate("request", { name });
  } catch (e) {
    if (currentUser === user) renderGate("request", null);
  }
}

// Следим за своим документом доступа: как только руководитель привяжет
// аккаунт в Табеле — приложение откроется само; отключит — закроется.
function watchAccess(user) {
  renderGate("checking");
  accessUnsub = db.collection("nskAccess").doc(user.uid)
    .onSnapshot({ includeMetadataChanges: true }, (snap) => {
      if (currentUser !== user) return;

      if (snap.exists && snap.data().active === true) {
        currentRole = "driver";
        currentAccess = snap.data();
        currentName = shortName(currentAccess.fullName);
        showShell();
        if (!appStarted) startApp();
        else { renderUserBar(); softRender(); } // руководитель поменял ставку или ФИО
        return;
      }

      // ответ пока только из памяти телефона — это ещё не «доступа нет»
      if (!snap.exists && snap.metadata.fromCache) {
        if (!appStarted) renderGate(navigator.onLine ? "checking" : "offline");
        return;
      }

      if (appStarted) stopApp();
      currentRole = null; currentAccess = null;
      if (snap.exists) renderGate("disabled");
      else resolveNoAccess(user);
    }, (err) => {
      if (currentUser !== user) return;
      if (appStarted) stopApp();
      renderGate("error", err && err.message);
    });
}

auth.onAuthStateChanged((user) => {
  if (accessUnsub) { try { accessUnsub(); } catch (e) {} accessUnsub = null; }

  if (!user) {
    currentUser = null; currentRole = null; currentAccess = null; currentName = "";
    stopApp();
    renderLoginScreen("login");
    return;
  }

  currentUser = user;

  if (isManagerEmail(user.email)) {
    currentRole = "manager";
    currentAccess = null;
    // имя берём из профиля Досатуя — это тот же проект, заводить заново не нужно
    db.collection("users").doc(user.uid).get()
      .then((doc) => (doc.exists && doc.data().name) || user.email)
      .catch(() => user.email)
      .then((name) => {
        if (currentUser !== user) return; // успел выйти
        currentName = name;
        showShell();
        startApp();
      });
    return;
  }

  watchAccess(user);
});
