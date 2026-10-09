// ============================================================
// ВОДИТЕЛИ — экран руководителя: заявки на доступ и пометка,
// чей это водитель.
//
//   Наш водитель        — зарплату платим мы. Ему нужна карточка в
//                         Табеле (ставки, реквизиты), поэтому «нашего»
//                         подтверждают там: отсюда Табель открывается
//                         сразу на нужной заявке.
//   Водитель подрядчика — зарплату платит подрядчик. Карточки в Табеле
//                         нет, доступ выдаётся здесь одной кнопкой.
//
// Пометка хранится в документе доступа nskAccess/{uid аккаунта}:
//   наш:        { driverId, fullName, hourlyRate, shiftRate, email, active }  — пишет Табель
//   подрядчика: { kind: "contractor", contractorId, contractorName,
//                 fullName, phone, email, active }                             — пишет «Смена»
// ============================================================

let accessRequests = [];     // заявки (nskUsers)
let accessLinks = [];        // выданные доступы (nskAccess)
let requestsLoaded = false, accessLoaded = false;
let closedAccessOpen = false; // раскрыт ли раздел «Доступ закрыт»
let deepLinkUid = null;       // заявка, которую просили открыть по ссылке из Табеля

function resetPeopleState() {
  accessRequests = []; accessLinks = [];
  requestsLoaded = false; accessLoaded = false; closedAccessOpen = false;
}

// Табель умеет открыть «Смену» сразу на заявке: …/Smena/#zayavka=<uid>
function readDeepLink() {
  const m = String(location.hash || "").match(/zayavka=([A-Za-z0-9_-]+)/);
  if (!m) return;
  deepLinkUid = m[1];
  try { history.replaceState(null, "", location.pathname + location.search); } catch (e) {}
}
readDeepLink();
window.addEventListener("hashchange", () => { readDeepLink(); tryOpenDeepLink(); });

function tryOpenDeepLink() {
  if (!deepLinkUid || !appStarted || currentRole !== "manager" || !requestsLoaded || !accessLoaded) return;
  const uid = deepLinkUid;
  deepLinkUid = null;
  currentTab = "people";
  render();
  const req = waitingRequests().find((r) => r.id === uid);
  if (req) openConfirmSheet(req, "contractor");
  else toast("Этой заявки уже нет среди ожидающих: её подтвердили или отклонили.");
}

function subscribePeople() {
  unsubs.push(db.collection("nskUsers").onSnapshot((snap) => {
    accessRequests = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    requestsLoaded = true;
    tryOpenDeepLink();
    softRender();
  }, (err) => console.error("Заявки не загрузились", err)));
  unsubs.push(db.collection("nskAccess").onSnapshot((snap) => {
    accessLinks = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    accessLoaded = true;
    tryOpenDeepLink();
    softRender();
  }, (err) => console.error("Доступы не загрузились", err)));
}

// зарегистрировались, но доступа ещё нет
function waitingRequests() {
  // пока список доступов не пришёл из базы, «ждущими» выглядели бы все подряд
  if (!accessLoaded) return [];
  const linked = new Set(accessLinks.map((a) => a.id));
  const ms = (r) => (r.createdAt && r.createdAt.toMillis ? r.createdAt.toMillis() : 0);
  return accessRequests.filter((r) => !linked.has(r.id)).sort((a, b) => ms(a) - ms(b));
}
function activeDriversCount() {
  return accessLinks.filter((a) => a.active === true).length;
}
function requestOf(uid) {
  return accessRequests.find((r) => r.id === uid) || null;
}
function ratesText(a) {
  const parts = [];
  if (a.hourlyRate) parts.push(fmtMoney(a.hourlyRate) + "/ч");
  if (a.shiftRate) parts.push(fmtMoney(a.shiftRate) + " за смену");
  return parts.join(", ") || "ставка не задана";
}

function contractorAccessDoc(request, contractor, fullName) {
  return {
    kind: "contractor",
    contractorId: contractor.id,
    contractorName: contractor.name,
    fullName,
    phone: (request && request.phone) || "",
    email: (request && request.email) || "",
    active: true,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    confirmedByUid: currentUser.uid,
    confirmedByName: currentName,
  };
}

// ---------- экран ----------
function renderPeople() {
  app.innerHTML = "";
  const wrap = el("div", "space-y-3");

  if (!accessLoaded || !requestsLoaded) {
    wrap.appendChild(el("div", "card empty", "Загружаю…"));
    app.appendChild(wrap);
    return;
  }

  // ----- заявки -----
  const waiting = waitingRequests();
  if (waiting.length) {
    wrap.appendChild(el("div", "eyebrow t-gold", `Ждут доступа: ${waiting.length}`));
    waiting.forEach((r) => {
      const card = el("div", "card card-accent p-3");
      card.dataset.request = r.id;
      const when = r.createdAt && r.createdAt.toDate ? fmtRU(r.createdAt.toDate()) : "";
      card.innerHTML = `
        <div class="t-strong break-words">${escapeHtml(r.name || "без имени")}</div>
        <div class="text-[13px] t-soft break-all">${escapeHtml(r.email || "")}${r.phone ? " · " + escapeHtml(r.phone) : ""}</div>
        ${when ? `<div class="text-xs t-mute mt-0.5">заявка от ${when}</div>` : ""}`;
      const actions = el("div", "flex items-center gap-2 mt-3");
      const ok = el("button", "btn btn-gold btn-sm flex-1", "Подтвердить");
      ok.type = "button";
      ok.onclick = () => openConfirmSheet(r);
      const no = el("button", "btn btn-danger btn-sm", "Отклонить");
      no.type = "button";
      no.onclick = async () => {
        if (offlineBlocked()) return;
        if (!confirm(`Отклонить заявку «${r.name || r.email}»? Человек сможет подать её заново.`)) return;
        try { await db.collection("nskUsers").doc(r.id).delete(); toast("Заявка отклонена."); }
        catch (e) { toast("Не получилось: " + e.message, true); }
      };
      actions.appendChild(ok); actions.appendChild(no);
      card.appendChild(actions);
      wrap.appendChild(card);
    });
  }

  // ----- водители с доступом -----
  const active = accessLinks.filter((a) => a.active === true);
  const byName = (a, b) => String(a.fullName || "").localeCompare(String(b.fullName || ""), "ru");
  const own = active.filter((a) => !isContractorAccess(a)).sort(byName);
  const groups = [];
  const knownIds = new Set();
  listItems("contractors").forEach((c) => {
    knownIds.add(c.id);
    const list = active.filter((a) => isContractorAccess(a) && a.contractorId === c.id).sort(byName);
    if (list.length) groups.push({ title: c.name, list });
  });
  // подрядчика уже нет в справочнике, а водители остались
  const orphan = active.filter((a) => isContractorAccess(a) && !knownIds.has(a.contractorId)).sort(byName);
  if (orphan.length) groups.push({ title: "Подрядчик не из справочника", list: orphan });

  const section = (title, list, emptyText) => {
    wrap.appendChild(el("div", "eyebrow pt-2", `${escapeHtml(title)}${list.length ? " · " + list.length : ""}`));
    if (!list.length) { wrap.appendChild(el("div", "card empty", emptyText)); return; }
    const card = el("div", "card rows");
    list.forEach((a) => card.appendChild(renderPersonRow(a, false)));
    wrap.appendChild(card);
  };
  section("Наши водители", own, "Наших водителей с доступом пока нет. Нашего водителя подтверждают в Табеле: там его карточка со ставками.");
  groups.forEach((g) => section(g.title, g.list, ""));
  if (!groups.length) {
    wrap.appendChild(el("div", "eyebrow pt-2", "Водители подрядчиков"));
    wrap.appendChild(el("div", "card empty", "Пока никого. Когда водитель подрядчика зарегистрируется, его заявка появится вверху — отметь, чей он, и доступ откроется."));
  }

  // ----- закрытый доступ -----
  const closed = accessLinks.filter((a) => a.active !== true).sort(byName);
  if (closed.length) {
    const box = el("div", "card overflow-hidden");
    const head = el("button", "w-full px-3 py-3 flex items-center justify-between gap-3 text-left");
    head.type = "button";
    head.id = "closed-toggle";
    head.innerHTML = `<span class="t-strong t-soft">Доступ закрыт: ${closed.length}</span><span class="text-xs t-mute shrink-0">${closedAccessOpen ? "Скрыть" : "Показать"}</span>`;
    head.onclick = () => { closedAccessOpen = !closedAccessOpen; render(); };
    box.appendChild(head);
    if (closedAccessOpen) {
      const body = el("div", "rows border-t border-rivet");
      closed.forEach((a) => body.appendChild(renderPersonRow(a, true)));
      box.appendChild(body);
    }
    wrap.appendChild(box);
  }

  wrap.appendChild(el("div", "text-xs t-mute px-1",
    "Водитель сначала сам регистрируется в «Смене». После этого его заявка появляется здесь, и ты отмечаешь, чей он."));
  app.appendChild(wrap);
}

// showOwner — подписать, чей водитель (в общем списке «Доступ закрыт»;
// в разделах по владельцам это и так видно из заголовка)
function renderPersonRow(a, showOwner) {
  const contractor = isContractorAccess(a);
  const row = el("button", "w-full p-3 flex items-center gap-3 text-left");
  row.type = "button";
  row.dataset.person = a.id;
  const req = requestOf(a.id);
  const phone = a.phone || (req && req.phone) || "";
  const sub = contractor
    ? [phone, a.email].filter(Boolean).map(escapeHtml).join(" · ")
    : [ratesText(a), a.email].filter(Boolean).map(escapeHtml).join(" · ");
  row.innerHTML = `
    <div class="flex-1 min-w-0">
      <div class="t-strong truncate">${escapeHtml(a.fullName || "без имени")}</div>
      <div class="text-[13px] t-soft truncate">${sub || "контактов нет"}</div>
    </div>
    ${showOwner ? `<span class="pill ${contractor ? "pill-gold" : ""} shrink-0 max-w-[40%]">${escapeHtml(contractor ? contractorName(a.contractorId, a.contractorName) : "Наш")}</span>` : ""}
    <span class="t-mute shrink-0">${ICONS.chevron}</span>`;
  row.onclick = () => openPersonSheet(a);
  return row;
}

// ---------- подтверждение заявки: чей это водитель ----------
// preset — что выбрать сразу ("contractor", когда пришли по ссылке из Табеля)
function openConfirmSheet(request, preset) {
  const contractors = activeContractors();
  const sheet = openSheet(`
    <div class="title">Подтвердить доступ</div>
    <div class="note">
      <div class="t-strong text-chalk break-words">${escapeHtml(request.name || "без имени")}</div>
      <div class="break-all">${escapeHtml(request.email || "")}${request.phone ? " · " + escapeHtml(request.phone) : ""}</div>
    </div>
    <div class="lbl" id="cf-kind-label">Чей это водитель</div>
    <div class="space-y-2" role="radiogroup" aria-labelledby="cf-kind-label">
      <button type="button" role="radio" data-kind="own" class="cf-kind choice">
        <div class="c-title">Наш водитель</div>
        <div class="c-text">Зарплату платим мы. Смены идут в Табель.</div>
      </button>
      <button type="button" role="radio" data-kind="contractor" class="cf-kind choice">
        <div class="c-title">Водитель подрядчика</div>
        <div class="c-text">Зарплату платит подрядчик. В Табель не попадает.</div>
      </button>
    </div>
    <div id="cf-contractor-wrap" class="hidden space-y-3">
      <label class="lbl">Подрядчик
        <select id="cf-contractor" class="field">
          <option value="">Выбери подрядчика</option>
          ${contractors.map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join("")}
        </select>
      </label>
      <label class="lbl">ФИО для реестров
        <input id="cf-name" class="field" maxlength="120" value="${escapeHtml(request.name || "")}" />
      </label>
    </div>
    <div id="cf-hint" class="text-[13px] t-soft"></div>
    <div id="cf-error" class="note note-bad hidden" role="alert"></div>
    <div class="flex gap-2">
      <button type="button" id="cf-ok" class="btn btn-gold flex-1" disabled>Подтвердить</button>
      <button type="button" id="cf-cancel" class="btn btn-ghost">Отмена</button>
    </div>`);
  const c = sheet.card;
  const okBtn = c.querySelector("#cf-ok");
  const hint = c.querySelector("#cf-hint");
  const err = c.querySelector("#cf-error");
  const wrapCon = c.querySelector("#cf-contractor-wrap");
  const sel = c.querySelector("#cf-contractor");
  const nameInput = c.querySelector("#cf-name");
  let kind = null;
  const fail = (t) => { err.textContent = t; err.classList.remove("hidden"); };

  // тёзка среди наших с другим аккаунтом — возможно, человек завёл второй аккаунт
  const twin = accessLinks.find((a) => !isContractorAccess(a) && a.id !== request.id && nameKey(a.fullName) === nameKey(request.name));

  function update() {
    err.classList.add("hidden");
    c.querySelectorAll(".cf-kind").forEach((b) => {
      const on = b.dataset.kind === kind;
      b.classList.toggle("choice-on", on);
      b.setAttribute("aria-checked", on ? "true" : "false");
    });
    wrapCon.classList.toggle("hidden", kind !== "contractor");
    if (kind === "own") {
      hint.textContent = "Нашему водителю нужна карточка в Табеле: там его ставки и реквизиты. Табель откроется сразу на этой заявке — выбери карточку или создай новую.";
      okBtn.textContent = "Открыть в Табеле";
      okBtn.disabled = false;
    } else if (kind === "contractor") {
      hint.textContent = (twin ? `Среди наших уже есть «${twin.fullName}» с другим аккаунтом. Если это он же — выбери «Наш водитель». ` : "")
        + (contractors.length ? "Доступ откроется сразу. Денег он в приложении не увидит: только свои смены и часы." : "Справочник подрядчиков пуст — добавь подрядчика во вкладке «Справочники».");
      okBtn.textContent = "Подтвердить";
      okBtn.disabled = !sel.value;
    } else {
      hint.textContent = "";
      okBtn.textContent = "Подтвердить";
      okBtn.disabled = true;
    }
  }
  c.querySelectorAll(".cf-kind").forEach((b) => { b.onclick = () => { kind = b.dataset.kind; update(); }; });
  sel.onchange = update;
  c.querySelector("#cf-cancel").onclick = sheet.close;
  if (preset) kind = preset;
  update();

  okBtn.onclick = async () => {
    err.classList.add("hidden");
    // пока окно было открыто, заявку мог обработать второй руководитель
    if (!waitingRequests().some((r) => r.id === request.id)) {
      return fail("Пока окно было открыто, эту заявку уже подтвердили или отклонили. Закрой окно.");
    }
    if (kind === "own") {
      window.open(TABEL_URL + "#zayavka=" + encodeURIComponent(request.id), "_blank", "noopener");
      sheet.close();
      toast("Заявка открыта в Табеле. Как подтвердишь там — водитель появится в «Наших».");
      return;
    }
    const contractor = contractors.find((x) => x.id === sel.value);
    const fullName = nameInput.value.trim().replace(/\s+/g, " ");
    if (!contractor) return fail("Выбери подрядчика.");
    if (fullName.split(" ").length < 2) return fail("Впиши фамилию и имя — так водитель будет записан в реестрах.");
    if (offlineBlocked(fail)) return;
    okBtn.disabled = true; okBtn.textContent = "Подтверждаю…";
    try {
      await db.collection("nskAccess").doc(request.id).set(contractorAccessDoc(request, contractor, fullName));
      sheet.close();
      toast(`Доступ выдан: ${shortName(fullName)} — ${contractor.name}.`);
    } catch (e) {
      okBtn.disabled = false; okBtn.textContent = "Подтвердить";
      fail("Не получилось: " + e.message);
    }
  };
}

// ---------- карточка водителя: поменять пометку, закрыть доступ ----------
// Окно открыто, а второй руководитель (или ты сам в Табеле) тем временем
// поменял этому водителю пометку, карточку или доступ. Действовать по
// устаревшему окну нельзя: можно закрыть не ту карточку или дать не тот доступ.
const PERSON_CHANGED = "Пока окно было открыто, данные этого водителя изменились. Закрой окно и открой его карточку заново.";
function personChanged(a) {
  const live = accessLinks.find((x) => x.id === a.id);
  return !live
    || isContractorAccess(live) !== isContractorAccess(a)
    || (live.driverId || "") !== (a.driverId || "")
    || (live.contractorId || "") !== (a.contractorId || "")
    || (live.active === true) !== (a.active === true);
}

function openPersonSheet(a) {
  const contractor = isContractorAccess(a);
  const req = requestOf(a.id);
  const phone = a.phone || (req && req.phone) || "";
  const contractors = listItems("contractors").filter((c) => c.active || c.id === a.contractorId);
  const isOpen = a.active === true;

  const head = `
    <div class="title break-words">${escapeHtml(a.fullName || "без имени")}</div>
    <div class="note">
      <div class="break-all">${[a.email, phone].filter(Boolean).map(escapeHtml).join(" · ") || "контактов нет"}</div>
      <div>${contractor ? "Водитель подрядчика: " + escapeHtml(contractorName(a.contractorId, a.contractorName)) : "Наш водитель · " + escapeHtml(ratesText(a))}</div>
      ${isOpen ? "" : `<div class="t-bad">Доступ закрыт</div>`}
    </div>`;

  // ----- наш водитель -----
  if (!contractor) {
    const sheet = openSheet(`${head}
      <div class="text-[13px] t-soft">Карточка, ставки, реквизиты и отключение доступа — в Табеле.</div>
      <a href="${TABEL_URL}" target="_blank" rel="noopener" class="btn btn-ghost btn-block">${ICONS.open}<span>Открыть Табель</span></a>
      <hr class="hr" />
      <div class="lbl">Это водитель подрядчика?</div>
      <select id="ps-contractor" class="field" style="margin-top:0">
        <option value="">Выбери подрядчика</option>
        ${activeContractors().map((x) => `<option value="${escapeHtml(x.id)}">${escapeHtml(x.name)}</option>`).join("")}
      </select>
      <div id="ps-error" class="note note-bad hidden" role="alert"></div>
      <div class="flex gap-2">
        <button type="button" id="ps-move" class="btn btn-line-gold flex-1" disabled>Перевести к подрядчику</button>
        <button type="button" id="ps-close" class="btn btn-ghost">Закрыть</button>
      </div>`);
    const c = sheet.card;
    const sel = c.querySelector("#ps-contractor");
    const move = c.querySelector("#ps-move");
    const err = c.querySelector("#ps-error");
    sel.onchange = () => { move.disabled = !sel.value; };
    c.querySelector("#ps-close").onclick = sheet.close;
    move.onclick = async () => {
      const target = activeContractors().find((x) => x.id === sel.value);
      if (!target) return;
      const say = (t) => { err.textContent = t; err.classList.remove("hidden"); };
      if (offlineBlocked(say)) return;
      if (personChanged(a)) return say(PERSON_CHANGED);
      if (!confirm(`Перевести «${a.fullName}» к подрядчику ${target.name}?\n\nНовые путевые пойдут в реестр подрядчика, в Табель и в зарплату — нет. Его карточка в Табеле уйдёт в «Убранные из списка». Смены, которые он уже внёс как наш, останутся в Табеле за свои даты.`)) return;
      move.disabled = true; move.textContent = "Перевожу…";
      try {
        const batch = db.batch();
        batch.set(db.collection("nskAccess").doc(a.id),
          contractorAccessDoc({ phone, email: a.email || (req && req.email) || "" }, target, a.fullName));
        if (a.driverId) batch.update(db.collection("tabelDrivers").doc(a.driverId), { active: false, linkedUid: null, linkedEmail: "" });
        await batch.commit();
        sheet.close();
        toast(`${shortName(a.fullName)} теперь водитель подрядчика ${target.name}.`);
      } catch (e) {
        move.disabled = false; move.textContent = "Перевести к подрядчику";
        err.textContent = "Не получилось: " + e.message; err.classList.remove("hidden");
      }
    };
    return;
  }

  // ----- водитель подрядчика -----
  const sheet = openSheet(`${head}
    <label class="lbl">ФИО для реестров
      <input id="ps-name" class="field" maxlength="120" value="${escapeHtml(a.fullName || "")}" />
    </label>
    <label class="lbl">Чей водитель
      <select id="ps-owner" class="field">
        ${contractors.map((x) => `<option value="${escapeHtml(x.id)}" ${x.id === a.contractorId ? "selected" : ""}>${escapeHtml(x.name)}</option>`).join("")}
        ${contractors.some((x) => x.id === a.contractorId) ? "" : `<option value="${escapeHtml(a.contractorId || "")}" selected>${escapeHtml(a.contractorName || "не из справочника")}</option>`}
        <option value="__own__">Наш водитель — перевести в Табель</option>
      </select>
    </label>
    <div id="ps-hint" class="text-[13px] t-soft"></div>
    <div id="ps-error" class="note note-bad hidden" role="alert"></div>
    <div class="flex gap-2">
      <button type="button" id="ps-save" class="btn btn-gold flex-1">Сохранить</button>
      <button type="button" id="ps-close" class="btn btn-ghost">Отмена</button>
    </div>
    <button type="button" id="ps-toggle" class="btn ${isOpen ? "btn-danger" : "btn-line-gold"} btn-sm btn-block">${isOpen ? "Закрыть доступ" : "Вернуть доступ"}</button>`);
  const c = sheet.card;
  const owner = c.querySelector("#ps-owner");
  const hint = c.querySelector("#ps-hint");
  const save = c.querySelector("#ps-save");
  const err = c.querySelector("#ps-error");
  const fail = (t) => { err.textContent = t; err.classList.remove("hidden"); };
  const toOwn = () => owner.value === "__own__";
  function update() {
    err.classList.add("hidden");
    if (toOwn()) {
      hint.textContent = "Нашему водителю нужна карточка в Табеле. Его доступ на время закроется: он увидит «заявка отправлена», пока ты не привяжешь его к карточке. Табель откроется сразу на его заявке.";
      save.textContent = "Перевести в наши";
    } else {
      hint.textContent = owner.value !== a.contractorId ? "Новые путевые пойдут в реестр нового подрядчика. Уже внесённые останутся у прежнего." : "";
      save.textContent = "Сохранить";
    }
  }
  owner.onchange = update;
  update();
  c.querySelector("#ps-close").onclick = sheet.close;

  save.onclick = async () => {
    err.classList.add("hidden");
    const fullName = c.querySelector("#ps-name").value.trim().replace(/\s+/g, " ");
    if (offlineBlocked(fail)) return;
    if (personChanged(a)) return fail(PERSON_CHANGED);
    if (toOwn()) {
      if (!req) return fail("У этого аккаунта не осталось заявки, поэтому Табель его не увидит. Закрой ему доступ — при следующем входе приложение предложит подать заявку заново.");
      if (!confirm(`Перевести «${a.fullName}» в наши водители?\n\nЕго доступ закроется, пока ты не привяжешь его к карточке в Табеле. Табель откроется сразу.`)) return;
      save.disabled = true; save.textContent = "Перевожу…";
      // окно открываем до обращения к базе: иначе телефон сочтёт его «всплывающим» и не покажет
      window.open(TABEL_URL + "#zayavka=" + encodeURIComponent(a.id), "_blank", "noopener");
      try {
        await db.collection("nskAccess").doc(a.id).delete();
        sheet.close();
        toast("Заявка вернулась в ожидающие и открыта в Табеле.");
      } catch (e) {
        save.disabled = false; update();
        fail("Не получилось: " + e.message);
      }
      return;
    }
    const target = contractors.find((x) => x.id === owner.value);
    if (fullName.split(" ").length < 2) return fail("Впиши фамилию и имя.");
    save.disabled = true; save.textContent = "Сохраняю…";
    try {
      const patch = { fullName, updatedAt: firebase.firestore.FieldValue.serverTimestamp() };
      if (target) { patch.contractorId = target.id; patch.contractorName = target.name; }
      await db.collection("nskAccess").doc(a.id).update(patch);
      sheet.close();
      toast("Сохранено.");
    } catch (e) {
      save.disabled = false; update();
      fail("Не получилось: " + e.message);
    }
  };

  c.querySelector("#ps-toggle").onclick = async () => {
    if (offlineBlocked(fail)) return;
    if (personChanged(a)) return fail(PERSON_CHANGED);
    const text = isOpen
      ? `Закрыть доступ «${a.fullName}»? Приложение у него закроется сразу. Его путевые останутся в реестрах.`
      : `Вернуть доступ «${a.fullName}»?`;
    if (!confirm(text)) return;
    try {
      await db.collection("nskAccess").doc(a.id).update({ active: !isOpen, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
      sheet.close();
      toast(isOpen ? "Доступ закрыт." : "Доступ открыт.");
    } catch (e) {
      fail("Не получилось: " + e.message);
    }
  };
}
