// ============================================================
// ЧАТ — общий чат бригады Новосибирска (водители + руководители).
// Своя коллекция nskChat: с чатом Досатуя не смешивается, у бригад
// разные люди и разные разговоры.
// ============================================================

let chatCache = []; // сообщения по возрастанию времени
let chatSubscribed = false;
let chatScrollPinned = true;
let chatPendingImage = null; // фото, прикреплённое к следующему сообщению
const CHAT_LASTREAD_KEY = "smena-chat-lastread";

function resetChatState() {
  chatCache = []; chatSubscribed = false; chatPendingImage = null;
}

function subscribeChat() {
  if (chatSubscribed) return;
  chatSubscribed = true;
  unsubs.push(db.collection("nskChat")
    .orderBy("createdAt", "desc")
    .limit(200)
    .onSnapshot((snap) => {
      chatCache = snap.docs.map((d) => ({ id: d.id, ...d.data() })).reverse();
      if (currentTab === "chat") { renderChatMessages(); markChatAsRead(); }
      updateChatNavBadge();
    }, (err) => console.error("Чат не загрузился", err)));
}

// ---------- значок непрочитанных на вкладке «Чат» ----------
function getLastReadTime() {
  return parseInt(localStorage.getItem(CHAT_LASTREAD_KEY) || "0", 10);
}
function unreadChatCount() {
  const lastRead = getLastReadTime();
  return chatCache.filter((m) => {
    if (!m.createdAt || !m.createdAt.toDate) return false; // ещё не подтверждено сервером
    if (currentUser && m.senderUid === currentUser.uid) return false; // свои не считаем
    return m.createdAt.toDate().getTime() > lastRead;
  }).length;
}
function markChatAsRead() {
  const last = chatCache[chatCache.length - 1];
  const t = last && last.createdAt && last.createdAt.toDate ? last.createdAt.toDate().getTime() : Date.now();
  localStorage.setItem(CHAT_LASTREAD_KEY, String(t));
  updateChatNavBadge();
}
function updateChatNavBadge() {
  const btn = document.querySelector('.tabbtn[data-tab="chat"]');
  if (!btn) return;
  let dot = btn.querySelector(".chat-unread-dot");
  const count = currentTab === "chat" ? 0 : unreadChatCount();
  if (count > 0) {
    if (!dot) {
      dot = el("span", "chat-unread-dot navdot");
      btn.appendChild(dot);
    }
    dot.textContent = count > 9 ? "9+" : String(count);
  } else if (dot) {
    dot.remove();
  }
}

function fmtChatTime(ts) {
  if (!ts || !ts.toDate) return "";
  return ts.toDate().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

function renderChat() {
  app.innerHTML = "";
  subscribeChat();
  chatScrollPinned = true;

  const wrap = el("div", "pb-24");

  const header = el("div", "card px-4 py-3 mb-3 flex items-center gap-2 flex-wrap");
  header.innerHTML = `<span class="t-gold">${ICONS.chat}</span><span class="title">Чат бригады</span>`;

  // кнопка уведомлений — только когда push настроен (см. settings.js)
  if (PUSH_ENABLED && typeof pushPermissionStatus === "function") {
    const pushStatus = pushPermissionStatus();
    if (pushStatus === "default") {
      const bellBtn = el("button", "btn btn-line-gold btn-sm ml-auto", `${ICONS.bell}<span>Включить уведомления</span>`);
      bellBtn.onclick = async () => {
        bellBtn.textContent = "…";
        const ok = await enablePushNotifications();
        bellBtn.innerHTML = ICONS.bell + `<span>${ok ? "Уведомления включены" : "Включить уведомления"}</span>`;
        if (ok) bellBtn.disabled = true;
      };
      header.appendChild(bellBtn);
    } else if (pushStatus === "granted") {
      header.appendChild(el("span", "tag tag-ok ml-auto", `${ICONS.bell}уведомления включены`));
      enablePushNotifications(true); // тихо обновляем подписку, если она «отвалилась»
    } else if (pushStatus === "denied") {
      header.appendChild(el("span", "ml-auto text-xs t-mute", "Уведомления запрещены в браузере"));
    }
  }
  if (currentRole === "manager") {
    const clearBtn = el("button", "btn btn-danger btn-sm ml-auto -mr-2", `${ICONS.trash}<span>Очистить чат</span>`);
    clearBtn.type = "button";
    clearBtn.onclick = clearAllChat;
    header.appendChild(clearBtn);
  }
  wrap.appendChild(header);

  const list = el("div", "space-y-2");
  list.id = "chat-list";
  wrap.appendChild(list);

  app.appendChild(wrap);
  renderChatMessages();
  renderChatInputBar();
  markChatAsRead();
}

async function clearAllChat() {
  if (!confirm("Удалить ВСЕ сообщения чата? Это действие нельзя отменить.")) return;
  try {
    const snap = await db.collection("nskChat").get();
    let batch = db.batch();
    let count = 0;
    const commits = [];
    snap.docs.forEach((doc) => {
      batch.delete(doc.ref);
      count++;
      if (count === 450) { commits.push(batch.commit()); batch = db.batch(); count = 0; }
    });
    if (count > 0) commits.push(batch.commit());
    await Promise.all(commits);
  } catch (e) {
    alert("Не удалось очистить чат: " + e.message);
  }
}

function renderChatMessages() {
  const list = document.getElementById("chat-list");
  if (!list) return;
  const wasNearBottom = chatScrollPinned;

  list.innerHTML = "";
  if (!chatCache.length) {
    list.appendChild(el("div", "empty", "Сообщений пока нет. Напиши первым."));
  }
  let lastDay = "";
  chatCache.forEach((m) => {
    const d = m.createdAt && m.createdAt.toDate ? m.createdAt.toDate() : null;
    const dayLabel = d ? d.toLocaleDateString("ru-RU", { day: "2-digit", month: "long" }) : "";
    if (d && dayLabel !== lastDay) {
      lastDay = dayLabel;
      list.appendChild(el("div", "text-center text-[11px] t-mute uppercase tracking-wider py-1", dayLabel));
    }
    const isMine = currentUser && m.senderUid === currentUser.uid;
    const canDelete = isMine || currentRole === "manager";
    const row = el("div", `flex items-end gap-1.5 ${isMine ? "justify-end" : "justify-start"}`);

    if (canDelete) {
      const delBtn = el("button", `t-mute shrink-0 p-1 ${isMine ? "order-1" : "order-2"}`, ICONS.close);
      delBtn.type = "button";
      delBtn.setAttribute("aria-label", "Удалить сообщение");
      delBtn.onclick = () => {
        if (confirm("Удалить это сообщение?")) {
          db.collection("nskChat").doc(m.id).delete().catch((e) => toast("Не удалось удалить: " + e.message, true));
        }
      };
      row.appendChild(delBtn);
    }

    const bubble = el("div", `bubble ${isMine ? "bubble-mine order-none" : "bubble-other order-1"}`);
    const roleTag = m.senderRole === "manager" ? ", руководитель" : "";
    let bodyHtml = "";
    if (!isMine) bodyHtml += `<div class="text-[11px] font-semibold ${m.senderRole === "manager" ? "t-gold" : "t-soft"} mb-0.5">${escapeHtml(m.senderName || "")}${roleTag}</div>`;
    if (m.imageUrl) bodyHtml += `<img src="${escapeHtml(m.imageUrl)}" alt="" class="rounded-lg max-h-56 w-full object-cover cursor-pointer mb-1" />`;
    if (m.text) bodyHtml += `<div class="whitespace-pre-wrap break-words">${escapeHtml(m.text)}</div>`;
    bodyHtml += `<div class="text-[10px] num ${isMine ? "text-chalk/60" : "t-mute"} text-right mt-0.5">${fmtChatTime(m.createdAt)}</div>`;
    bubble.innerHTML = bodyHtml;
    if (m.imageUrl) bubble.querySelector("img").onclick = () => openLightbox(m.imageUrl);
    row.appendChild(bubble);
    list.appendChild(row);
  });

  if (wasNearBottom) window.scrollTo({ top: document.body.scrollHeight });
}

function renderChatInputBar() {
  removeChatInputBar();

  const bar = el("div", "fixed left-0 right-0 px-3 pb-2 z-10");
  bar.id = "chat-input-bar";
  // ровно над нижними вкладками: их высота зависит от телефона («полоска» внизу)
  const navEl = document.getElementById("nav");
  bar.style.bottom = ((navEl && navEl.offsetHeight) || 62) + "px";
  const inner = el("div", "max-w-md mx-auto bg-hull rounded-xl shadow-lg p-2 border border-rivet-hi");
  inner.innerHTML = `
    <div id="chat-img-preview" class="hidden relative w-16 h-16 mb-2">
      <img alt="" class="w-16 h-16 object-cover rounded-lg" />
      <button id="chat-img-remove" type="button" aria-label="Убрать фото" class="absolute -top-1.5 -right-1.5 bg-flare text-white rounded-full w-6 h-6 flex items-center justify-center">${ICONS.close}</button>
    </div>
    <div class="flex items-end gap-2">
      <button id="chat-attach" type="button" aria-label="Прикрепить фото" class="shrink-0 t-soft w-10 h-10 flex items-center justify-center">${ICONS.clip}</button>
      <input id="chat-photo-input" type="file" accept="image/*" class="hidden" />
      <textarea id="chat-text" rows="1" placeholder="Написать сообщение…" maxlength="2000"
        class="flex-1 resize-none max-h-24 border-0 bg-transparent text-chalk placeholder:text-mute focus:ring-0 outline-none text-[16px] px-2 py-2"></textarea>
      <button id="chat-send" type="button" aria-label="Отправить" class="shrink-0 rounded-full w-10 h-10 flex items-center justify-center text-night" style="background:linear-gradient(180deg,#EBC46F,#BE8B2B)">${ICONS.send}</button>
    </div>`;
  bar.appendChild(inner);
  document.body.appendChild(bar);

  const textarea = document.getElementById("chat-text");
  const sendBtn = document.getElementById("chat-send");
  const photoInput = document.getElementById("chat-photo-input");
  const preview = document.getElementById("chat-img-preview");

  document.getElementById("chat-attach").onclick = () => photoInput.click();
  photoInput.onchange = (e) => {
    const file = e.target.files[0];
    photoInput.value = "";
    if (!file) return;
    chatPendingImage = file;
    preview.querySelector("img").src = URL.createObjectURL(file);
    preview.classList.remove("hidden");
  };
  document.getElementById("chat-img-remove").onclick = () => {
    chatPendingImage = null;
    preview.classList.add("hidden");
  };

  textarea.addEventListener("input", () => {
    textarea.style.height = "auto";
    textarea.style.height = Math.min(textarea.scrollHeight, 96) + "px";
  });

  let isSending = false; // защита от двойной отправки (Android иногда шлёт Enter дважды)

  async function send() {
    if (isSending) return;
    const text = textarea.value.trim();
    if (!text && !chatPendingImage) return;
    if (!navigator.onLine) { toast("Нет сети. Сообщение останется в поле — отправь, когда появится связь.", true); return; }
    isSending = true;
    sendBtn.disabled = true;
    sendBtn.classList.add("opacity-60");
    try {
      let imageUrl = null;
      if (chatPendingImage) imageUrl = await uploadToCloudinary(await resizeImage(chatPendingImage));
      textarea.value = "";
      textarea.style.height = "auto";
      chatPendingImage = null;
      preview.classList.add("hidden");
      chatScrollPinned = true;
      // Подтверждения сервера не ждём: на слабой связи ожидание тянулось бы
      // минутами и блокировало кнопку. Сообщение сразу видно в ленте, база
      // дошлёт его сама; если сервер откажет — покажем ошибку.
      db.collection("nskChat").add({
        text,
        imageUrl: imageUrl || null,
        senderUid: currentUser.uid,
        senderName: currentName,
        senderRole: currentRole,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      }).catch((e) => toast("Сообщение не принято: " + e.message, true));
    } catch (e) {
      // сюда попадаем, только если не загрузилось фото — текст остался в поле
      toast("Не удалось отправить фото: " + e.message, true);
    }
    isSending = false;
    sendBtn.disabled = false;
    sendBtn.classList.remove("opacity-60");
  }

  sendBtn.onclick = send;
  textarea.onkeydown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  };
}

function removeChatInputBar() {
  const existing = document.getElementById("chat-input-bar");
  if (existing) existing.remove();
}
