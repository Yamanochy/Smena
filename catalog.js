// ============================================================
// СПРАВОЧНИКИ — экран руководителя: техника, заказчики, подрядчики.
// Всё, из чего потом выбирают водитель в форме смены и руководитель
// в фильтрах.
//
// Ничего не удаляется насовсем: техника и названия «убираются из
// списка» (active: false). Так старые путевые и реестры не теряют
// ни машину, ни заказчика.
// ============================================================

let catalogSection = "equipment"; // "equipment" | "customers" | "contractors"
let equipmentRemovedOpen = false;

const CATALOG_TEXT = {
  customers: {
    tab: "Заказчики", add: "Добавить заказчика", title: "Заказчик", ph: "например: МУП Энергия",
    empty: "Заказчиков пока нет. Добавь первого — водитель будет выбирать его в форме смены.",
    note: "Скрытого заказчика водитель выбрать не сможет, но в старых путевых и реестрах он останется.",
  },
  contractors: {
    tab: "Подрядчики", add: "Добавить подрядчика", title: "Подрядчик", ph: "например: ИП Иванов",
    empty: "Подрядчиков пока нет. Добавь — и сможешь отмечать, чей водитель.",
    note: "Скрытого подрядчика нельзя выбрать для нового водителя. Его водители и путевые остаются на месте.",
  },
};

function renderCatalog() {
  app.innerHTML = "";
  const wrap = el("div", "space-y-3");

  const seg = el("div", "seg");
  [["equipment", "Техника"], ["customers", "Заказчики"], ["contractors", "Подрядчики"]].forEach(([key, label]) => {
    const b = el("button", "chip" + (catalogSection === key ? " chip-on" : ""), label);
    b.type = "button";
    b.dataset.section = key;
    b.onclick = () => { catalogSection = key; render(); };
    seg.appendChild(b);
  });
  wrap.appendChild(seg);

  if (catalogSection === "equipment") renderEquipmentSection(wrap);
  else renderListSection(wrap, catalogSection);
  app.appendChild(wrap);
}

// ---------- техника ----------
function renderEquipmentSection(wrap) {
  const addBtn = el("button", "btn btn-gold btn-block", `${ICONS.plus}<span>Добавить технику</span>`);
  addBtn.type = "button";
  addBtn.id = "eq-add";
  addBtn.onclick = () => openEquipmentSheet(null);
  wrap.appendChild(addBtn);

  const active = equipmentCache.filter((e) => e.active !== false);
  const row = (e) => {
    const r = el("button", "w-full p-3 flex items-center gap-3 text-left");
    r.type = "button";
    r.dataset.equipment = e.id;
    r.innerHTML = `
      <div class="flex-1 min-w-0">
        <div class="t-strong truncate">${escapeHtml(e.name || "без названия")}</div>
        <div class="text-[13px] t-soft num truncate">${e.plateNumber ? escapeHtml(e.plateNumber) : "гос. номер не указан"}</div>
      </div>
      <span class="t-mute shrink-0">${ICONS.chevron}</span>`;
    r.onclick = () => openEquipmentSheet(e);
    return r;
  };
  const section = (title, list) => {
    if (!list.length) return;
    wrap.appendChild(el("div", "eyebrow pt-2", `${escapeHtml(title)} · ${list.length}`));
    const card = el("div", "card rows");
    list.forEach((e) => card.appendChild(row(e)));
    wrap.appendChild(card);
  };

  if (!active.length) {
    wrap.appendChild(el("div", "card empty", "Техники пока нет. Добавь первую машину — водитель будет выбирать её в форме смены."));
  }
  section("Наша техника", active.filter((e) => equipmentOwnerId(e) === "own"));
  const known = new Set(["own"]);
  listItems("contractors").forEach((c) => {
    known.add(c.id);
    section("Техника: " + c.name, active.filter((e) => equipmentOwnerId(e) === c.id));
  });
  section("Техника подрядчика не из справочника", active.filter((e) => !known.has(equipmentOwnerId(e))));

  const removed = equipmentCache.filter((e) => e.active === false);
  if (removed.length) {
    const box = el("div", "card overflow-hidden");
    const head = el("button", "w-full px-3 py-3 flex items-center justify-between gap-3 text-left");
    head.type = "button";
    head.id = "eq-removed-toggle";
    head.innerHTML = `<span class="t-strong t-soft">Убрано из списка: ${removed.length}</span><span class="text-xs t-mute shrink-0">${equipmentRemovedOpen ? "Скрыть" : "Показать"}</span>`;
    head.onclick = () => { equipmentRemovedOpen = !equipmentRemovedOpen; render(); };
    box.appendChild(head);
    if (equipmentRemovedOpen) {
      const body = el("div", "rows border-t border-rivet");
      removed.forEach((e) => {
        const r = el("div", "p-3 flex items-center gap-3");
        r.innerHTML = `
          <div class="flex-1 min-w-0">
            <div class="t-strong t-soft truncate">${escapeHtml(e.name || "без названия")}</div>
            <div class="text-[13px] t-mute num truncate">${e.plateNumber ? escapeHtml(e.plateNumber) : "гос. номер не указан"}</div>
          </div>`;
        const back = el("button", "btn btn-ghost btn-sm shrink-0", "Вернуть");
        back.type = "button";
        back.onclick = async () => {
          if (offlineBlocked()) return;
          back.disabled = true;
          try { await db.collection("tabelEquipment").doc(e.id).update({ active: true }); toast(`«${e.name}» снова в списке.`); }
          catch (er) { back.disabled = false; toast("Не получилось: " + er.message, true); }
        };
        r.appendChild(back);
        body.appendChild(r);
      });
      box.appendChild(body);
    }
    wrap.appendChild(box);
  }

  wrap.appendChild(el("div", "text-xs t-mute px-1",
    "Список общий с Табелем. Техника с пометкой подрядчика в Табеле не показывается."));
}

function openEquipmentSheet(existing) {
  const owner = existing ? equipmentOwnerId(existing) : "own";
  const contractors = listItems("contractors").filter((c) => c.active || c.id === owner);
  const sheet = openSheet(`
    <div class="title">${existing ? "Изменить технику" : "Добавить технику"}</div>
    <label class="lbl">Название
      <input id="ef-name" class="field" maxlength="120" placeholder="например: Погрузчик SDLG 933" value="${existing ? escapeHtml(existing.name || "") : ""}" />
    </label>
    <label class="lbl">Гос. номер
      <input id="ef-plate" class="field num" maxlength="30" placeholder="например: А 123 БВ 154" value="${existing ? escapeHtml(existing.plateNumber || "") : ""}" />
    </label>
    <label class="lbl">Чья техника
      <select id="ef-owner" class="field">
        <option value="own" ${owner === "own" ? "selected" : ""}>Наша</option>
        ${contractors.map((c) => `<option value="${escapeHtml(c.id)}" ${owner === c.id ? "selected" : ""}>${escapeHtml(c.name)}</option>`).join("")}
        ${owner !== "own" && !contractors.some((c) => c.id === owner) ? `<option value="${escapeHtml(owner)}" selected>Подрядчик не из справочника</option>` : ""}
      </select>
    </label>
    <div id="ef-error" class="note note-bad hidden" role="alert"></div>
    <div class="flex gap-2">
      <button type="button" id="ef-save" class="btn btn-gold flex-1">Сохранить</button>
      <button type="button" id="ef-cancel" class="btn btn-ghost">Отмена</button>
    </div>
    ${existing ? `<button type="button" id="ef-delete" class="btn btn-danger btn-sm btn-block">Убрать из списка</button>` : ""}`);
  const c = sheet.card;
  const err = c.querySelector("#ef-error");
  const fail = (t) => { err.textContent = t; err.classList.remove("hidden"); };
  c.querySelector("#ef-cancel").onclick = sheet.close;

  c.querySelector("#ef-save").onclick = async () => {
    err.classList.add("hidden");
    const name = c.querySelector("#ef-name").value.trim().replace(/\s+/g, " ");
    const plateNumber = c.querySelector("#ef-plate").value.trim().replace(/\s+/g, " ");
    const ownerId = c.querySelector("#ef-owner").value || "own";
    if (!name) return fail("Впиши название техники.");
    const same = equipmentCache.find((e) => e.active !== false && (!existing || e.id !== existing.id)
      && String(e.name || "").toLowerCase() === name.toLowerCase()
      && String(e.plateNumber || "").toLowerCase() === plateNumber.toLowerCase());
    if (same) return fail("Такая техника с таким же номером уже есть в списке.");
    if (offlineBlocked(fail)) return;
    const btn = c.querySelector("#ef-save");
    btn.disabled = true; btn.textContent = "Сохраняю…";
    try {
      const payload = { name, plateNumber, ownerId, active: true };
      if (existing) await db.collection("tabelEquipment").doc(existing.id).update(payload);
      else await db.collection("tabelEquipment").add({ ...payload, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
      sheet.close();
      toast(existing ? "Сохранено." : `«${name}» добавлена.`);
    } catch (e) {
      btn.disabled = false; btn.textContent = "Сохранить";
      fail("Не получилось: " + e.message);
    }
  };

  if (existing) {
    c.querySelector("#ef-delete").onclick = async () => {
      if (offlineBlocked(fail)) return;
      if (!confirm(`Убрать «${existing.name}» из списка? Водители больше не смогут её выбрать. Прошлые смены на ней останутся.`)) return;
      try {
        await db.collection("tabelEquipment").doc(existing.id).update({ active: false });
        sheet.close();
        toast("Убрано из списка.");
      } catch (e) {
        fail("Не получилось: " + e.message);
      }
    };
  }
}

// ---------- заказчики и подрядчики ----------
function renderListSection(wrap, kind) {
  const T = CATALOG_TEXT[kind];
  const addBtn = el("button", "btn btn-gold btn-block", `${ICONS.plus}<span>${T.add}</span>`);
  addBtn.type = "button";
  addBtn.id = "list-add";
  addBtn.onclick = () => openListItemSheet(kind, null);
  wrap.appendChild(addBtn);

  const items = listItems(kind);
  if (!items.length) {
    wrap.appendChild(el("div", "card empty", T.empty));
  } else {
    const card = el("div", "card rows");
    items.slice().sort((a, b) => (a.active === b.active ? 0 : a.active ? -1 : 1)).forEach((it) => {
      const count = kind === "contractors"
        ? accessLinks.filter((a) => a.active === true && isContractorAccess(a) && a.contractorId === it.id).length : 0;
      const r = el("button", "w-full p-3 flex items-center gap-3 text-left");
      r.type = "button";
      r.dataset.item = it.id;
      r.innerHTML = `
        <div class="flex-1 min-w-0">
          <div class="t-strong truncate ${it.active ? "" : "t-soft"}">${escapeHtml(it.name)}</div>
          ${kind === "contractors" ? `<div class="text-[13px] t-soft">${count ? `${count} ${plural(count, "водитель", "водителя", "водителей")} с доступом` : "водителей пока нет"}</div>` : ""}
        </div>
        ${it.active ? "" : `<span class="pill shrink-0">скрыт</span>`}
        <span class="t-mute shrink-0">${ICONS.chevron}</span>`;
      r.onclick = () => openListItemSheet(kind, it);
      card.appendChild(r);
    });
    wrap.appendChild(card);
  }
  wrap.appendChild(el("div", "text-xs t-mute px-1", T.note));
}

function openListItemSheet(kind, item) {
  const T = CATALOG_TEXT[kind];
  const sheet = openSheet(`
    <div class="title">${item ? T.title : T.add}</div>
    <label class="lbl">Название для реестров
      <input id="li-name" class="field" maxlength="120" placeholder="${T.ph}" value="${item ? escapeHtml(item.name) : ""}" />
    </label>
    <div id="li-error" class="note note-bad hidden" role="alert"></div>
    <div class="flex gap-2">
      <button type="button" id="li-save" class="btn btn-gold flex-1">Сохранить</button>
      <button type="button" id="li-cancel" class="btn btn-ghost">Отмена</button>
    </div>
    ${item ? `<button type="button" id="li-toggle" class="btn ${item.active ? "btn-danger" : "btn-line-gold"} btn-sm btn-block">${item.active ? "Скрыть из списка" : "Вернуть в список"}</button>` : ""}`);
  const c = sheet.card;
  const err = c.querySelector("#li-error");
  const fail = (t) => { err.textContent = t; err.classList.remove("hidden"); };
  c.querySelector("#li-cancel").onclick = sheet.close;

  // записываем оба списка целиком: документ один на оба справочника
  const write = async (changeItems, renamedTo) => {
    const next = { customers: listItems("customers"), contractors: listItems("contractors") };
    next[kind] = changeItems(next[kind]);
    await saveLists(next);
    // подрядчика переименовали — правим название и в документах доступа его
    // водителей, чтобы новые путевые шли уже с новым названием
    if (kind === "contractors" && item && renamedTo) {
      const mine = accessLinks.filter((a) => isContractorAccess(a) && a.contractorId === item.id && a.contractorName !== renamedTo);
      for (let i = 0; i < mine.length; i += 400) {
        const batch = db.batch();
        mine.slice(i, i + 400).forEach((a) => batch.update(db.collection("nskAccess").doc(a.id), { contractorName: renamedTo }));
        await batch.commit();
      }
    }
  };

  c.querySelector("#li-save").onclick = async () => {
    err.classList.add("hidden");
    const name = c.querySelector("#li-name").value.trim().replace(/\s+/g, " ");
    if (name.length < 2) return fail("Впиши название.");
    if (listItems(kind).some((x) => (!item || x.id !== item.id) && x.name.toLowerCase() === name.toLowerCase())) {
      return fail("Такое название уже есть в списке.");
    }
    if (offlineBlocked(fail)) return;
    const btn = c.querySelector("#li-save");
    btn.disabled = true; btn.textContent = "Сохраняю…";
    try {
      if (item) await write((arr) => arr.map((x) => (x.id === item.id ? { ...x, name } : x)), name !== item.name ? name : null);
      else await write((arr) => arr.concat([{ id: newListId(kind === "customers" ? "c" : "p"), name, active: true }]));
      sheet.close();
      toast(item ? "Сохранено." : `«${name}» в списке.`);
    } catch (e) {
      btn.disabled = false; btn.textContent = "Сохранить";
      fail("Не получилось: " + e.message);
    }
  };

  if (item) {
    c.querySelector("#li-toggle").onclick = async () => {
      if (offlineBlocked(fail)) return;
      if (item.active && !confirm(`Скрыть «${item.name}» из списка? В старых путевых и реестрах название останется.`)) return;
      try {
        await write((arr) => arr.map((x) => (x.id === item.id ? { ...x, active: !item.active } : x)));
        sheet.close();
        toast(item.active ? "Скрыто." : "Снова в списке.");
      } catch (e) {
        fail("Не получилось: " + e.message);
      }
    };
  }
}
