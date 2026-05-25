const roomList = document.getElementById('room-list');
const loading = document.getElementById('loading');
const joinCodeHost = document.getElementById('home-join-code-pin');
const btnJoinByCode = document.getElementById('btn-join-by-code');
const joinCodeHint = document.getElementById('join-code-hint');
const createOverlay = document.getElementById('create-room-overlay');
const joinPwOverlay = document.getElementById('home-join-pw-overlay');
const joinCodeOverlay = document.getElementById('home-join-code-overlay');
const btnOpenJoinCode = document.getElementById('btn-open-join-code');

let currentUserId = null;
/** @type {ReturnType<typeof createPinRow> | null} */
let joinCodePin = null;
/** @type {ReturnType<typeof createPinRow> | null} */
let createPwPin = null;
/** @type {ReturnType<typeof createPinRow> | null} */
let joinPwPin = null;

function showJoinHint(msg, isError) {
  if (!joinCodeHint) return;
  joinCodeHint.textContent = msg || '';
  joinCodeHint.style.display = msg ? 'block' : 'none';
  joinCodeHint.classList.toggle('field-hint--error', !!isError);
  if (joinCodeHost && isError) {
    joinCodeHost.classList.add('pin-row-host--shake');
    setTimeout(() => joinCodeHost.classList.remove('pin-row-host--shake'), 400);
  }
}

function openJoinCodeModal() {
  if (joinCodePin) joinCodePin.clear();
  if (joinCodeHint) { joinCodeHint.style.display = 'none'; joinCodeHint.textContent = ''; }
  joinCodeOverlay.style.display = '';
  if (joinCodePin) joinCodePin.focus();
}

function closeJoinCodeModal() {
  joinCodeOverlay.style.display = 'none';
}

async function requireAuth() {
  const me = await getMe();
  if (!me || !me.id) {
    window.location.href = '/';
    return null;
  }
  currentUserId = me.id;
  return me;
}

async function openCreateModal() {
  const titleInput = document.getElementById('create-title');
  let placeholder = 'Комната 1';
  try {
    const res = await fetch('/api/rooms/default-title', { credentials: 'include' });
    if (res.ok) {
      const j = await res.json();
      if (j && j.title) placeholder = j.title;
    }
  } catch (_) {
    /* сеть */
  }
  titleInput.placeholder = placeholder;
  titleInput.value = '';
  createPwPin.clear();
  document.getElementById('create-err').style.display = 'none';
  document.getElementById('create-err').textContent = '';
  createOverlay.style.display = '';
  titleInput.focus();
}

function closeCreateModal() {
  createOverlay.style.display = 'none';
}

function openJoinPwModal() {
  joinPwPin.clear();
  document.getElementById('home-join-pw-err').style.display = 'none';
  joinPwOverlay.style.display = '';
  joinPwPin.focus();
}

function closeJoinPwModal() {
  joinPwOverlay.style.display = 'none';
}

async function postJoinRoom(body) {
  const res = await fetch('/api/rooms/join', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.status === 401) {
    window.location.href = '/';
    return false;
  }
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    await showAppAlert(typeof j.detail === 'string' ? j.detail : 'Не удалось войти', { title: 'Ошибка' });
    return false;
  }
  const data = await res.json();
  window.location.href = `/room/${data.room_id}`;
  return true;
}

async function tryJoinAfterPreview(preview, codeUpper) {
  if (preview.already_member) {
    window.location.href = `/room/${preview.room_id}`;
    return;
  }
  if (preview.has_room_password) {
    window.__homeJoinCode = codeUpper;
    openJoinPwModal();
    return;
  }
  await postJoinRoom({ code: codeUpper });
}

async function onJoinByCodeClick() {
  showJoinHint('', false);
  const code = joinCodePin.getValue().trim().toUpperCase();
  if (code.length !== 6) {
    showJoinHint('Введите код из 6 символов.', true);
    return;
  }
  const res = await fetch(`/api/rooms/join-preview?code=${encodeURIComponent(code)}`, {
    credentials: 'include',
  });
  if (res.status === 401) {
    window.location.href = '/';
    return;
  }
  if (res.status === 404) {
    showJoinHint('Комната с таким кодом не найдена.', true);
    return;
  }
  if (!res.ok) {
    showJoinHint('Не удалось проверить код.', true);
    return;
  }
  const preview = await res.json();
  closeJoinCodeModal();
  await tryJoinAfterPreview(preview, code);
}

async function confirmAndLeaveRoom(roomId, displayTitle, li) {
  const ok = await showAppConfirm({
    title: 'Покинуть комнату',
    message: `Выйти из комнаты «${displayTitle}»? Вы потеряете к ней доступ, пока вас снова не пригласят.`,
    confirmText: 'Выйти',
    cancelText: 'Отмена',
    danger: true,
  });
  if (!ok) return;
  try {
    const res = await fetch(`/api/rooms/${roomId}/leave`, { method: 'POST', credentials: 'include' });
    if (res.status === 401) {
      window.location.href = '/';
      return;
    }
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      await showAppAlert(typeof j.detail === 'string' ? j.detail : 'Не удалось выйти', { title: 'Ошибка' });
      return;
    }
  } catch (_) {
    await showAppAlert('Не удалось выйти из комнаты', { title: 'Ошибка' });
    return;
  }
  li.remove();
  if (roomList.children.length === 0) {
    loading.style.display = '';
    loading.className = 'empty-hint empty-hint--rooms';
    loading.innerHTML = '<span>Нет активных комнат</span><span style="font-size:0.9rem;font-weight:400;">Нажмите «Создать комнату», чтобы начать</span>';
  }
}

async function loadRooms() {
  const res = await fetch('/api/rooms', { credentials: 'include' });
  if (res.status === 401) {
    window.location.href = '/';
    return;
  }
  if (!res.ok) {
    loading.textContent = 'Не удалось загрузить комнаты';
    return;
  }
  const rooms = await res.json();
  loading.style.display = 'none';
  roomList.style.display = '';
  roomList.innerHTML = '';
  if (rooms.length === 0) {
    loading.style.display = '';
    loading.className = 'empty-hint empty-hint--rooms';
    loading.innerHTML = '<span>Нет активных комнат</span><span style="font-size:0.9rem;font-weight:400;">Нажмите «Создать комнату», чтобы начать</span>';
    return;
  }
  rooms.forEach((r) => {
    const li = document.createElement('li');
    li.className = 'room-item';

    const displayTitle = r.title || `Комната #${r.id}`;
    const isOwner = r.owner_id === currentUserId;

    const main = document.createElement('div');
    main.className = 'room-item-main';

    const titleStack = document.createElement('div');
    titleStack.className = 'room-title-stack';

    const titleRow = document.createElement('div');
    titleRow.className = 'room-title-row';

    const titleCell = document.createElement('div');
    titleCell.className = 'room-title-cell';

    const titleLabel = document.createElement('span');
    titleLabel.className = 'room-title-label';
    titleLabel.textContent = displayTitle;

    titleCell.appendChild(titleLabel);
    titleRow.appendChild(titleCell);
    titleStack.appendChild(titleRow);

    if (r.description && r.description.trim()) {
      const desc = document.createElement('div');
      desc.className = 'room-list-desc';
      let t = r.description.trim().split('\n')[0].slice(0, 160);
      if (r.description.trim().length > 160) t += '…';
      desc.textContent = t;
      titleStack.appendChild(desc);
    }

    main.appendChild(titleStack);

    const spine = document.createElement('div');
    spine.className = 'room-item-spine';
    if (!isOwner) {
      spine.classList.add('room-item-spine--placeholder');
      spine.setAttribute('aria-hidden', 'true');
    }

    if (isOwner) {
      const btnGear = document.createElement('button');
      btnGear.type = 'button';
      btnGear.className = 'btn-room-gear';
      btnGear.title = 'Настройки';
      btnGear.setAttribute('aria-label', 'Настройки комнаты');
      btnGear.textContent = '⚙';
      btnGear.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        await openRoomSettingsModal(r.id, {
          onDeleted: () => {
            li.remove();
            if (roomList.children.length === 0) {
              loading.style.display = '';
              loading.className = 'empty-hint empty-hint--rooms';
              loading.innerHTML = '<span>Нет активных комнат</span><span style="font-size:0.9rem;font-weight:400;">Нажмите «Создать комнату», чтобы начать</span>';
            }
          },
          onSaved: () => {
            loadRooms();
          },
        });
      });
      spine.appendChild(btnGear);
    }

    const end = document.createElement('div');
    end.className = 'room-item-end';

    if (isOwner) {
      const btnDelete = document.createElement('button');
      btnDelete.type = 'button';
      btnDelete.className = 'btn-room-side btn-room-side--danger';
      btnDelete.textContent = 'Удалить';
      btnDelete.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const ok = await showAppConfirm({
          title: 'Удалить комнату',
          message: `Удалить комнату «${displayTitle}»?\n\nВсе файлы в ней будут удалены.`,
          confirmText: 'Удалить',
          cancelText: 'Отмена',
          danger: true,
        });
        if (!ok) return;
        const dres = await fetch(`/api/rooms/${r.id}`, {
          method: 'DELETE',
          credentials: 'include',
        });
        if (dres.status === 401) {
          window.location.href = '/';
          return;
        }
        if (!dres.ok) {
          await showAppAlert('Не удалось удалить комнату', { title: 'Ошибка' });
          return;
        }
        li.remove();
        if (roomList.children.length === 0) {
          loading.style.display = '';
          loading.className = 'empty-hint empty-hint--rooms';
          loading.innerHTML = '<span>Нет активных комнат</span><span style="font-size:0.9rem;font-weight:400;">Нажмите «Создать комнату», чтобы начать</span>';
        }
      });
      end.appendChild(btnDelete);
    } else {
      const btnLeave = document.createElement('button');
      btnLeave.type = 'button';
      btnLeave.className = 'btn-room-side';
      btnLeave.textContent = 'Выйти из комнаты';
      btnLeave.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        await confirmAndLeaveRoom(r.id, displayTitle, li);
      });
      end.appendChild(btnLeave);
    }

    li.appendChild(main);
    li.appendChild(spine);
    li.appendChild(end);

    li.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      window.location.href = `/room/${r.id}`;
    });

    roomList.appendChild(li);
  });
}

async function submitCreateRoom() {
  const err = document.getElementById('create-err');
  err.style.display = 'none';
  const titleRaw = document.getElementById('create-title').value.trim();
  const p = createPwPin.getValue();
  if (p && p.length !== 6) {
    err.textContent = 'Пароль: ровно 6 символов или оставьте ячейки пустыми.';
    err.style.display = 'block';
    return;
  }
  const body = {
    title: titleRaw || null,
    password: p || null,
    password_confirm: p || null,
  };
  const res = await fetch('/api/rooms', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.status === 401) {
    window.location.href = '/';
    return;
  }
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    err.textContent = typeof j.detail === 'string' ? j.detail : 'Не удалось создать комнату';
    err.style.display = 'block';
    return;
  }
  const room = await res.json();
  closeCreateModal();
  window.location.href = `/room/${room.id}`;
}

function bootKickedNotice() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('kicked') === '1') {
    showAppAlert('Комната была удалена или у вас больше нет к ней доступа.', {
      title: 'Доступ закрыт',
      okText: 'Ок',
    }).then(() => {
      const u = new URL(window.location.href);
      u.searchParams.delete('kicked');
      window.history.replaceState({}, '', u.pathname + u.search);
    });
  }
}

(async () => {
  joinCodePin = window.createPinRow(joinCodeHost, { ariaLabel: 'Код комнаты' });
  createPwPin = window.createPinRow(document.getElementById('create-pw-pin'), { ariaLabel: 'Пароль комнаты' });
  joinPwPin = window.createPinRow(document.getElementById('home-join-pw-pin'), { ariaLabel: 'Пароль комнаты' });

  await requireAuth();
  bootKickedNotice();
  await loadRooms();

  // Кнопка "Войти по коду" — открывает модальное окно
  if (btnOpenJoinCode) {
    btnOpenJoinCode.addEventListener('click', () => openJoinCodeModal());
  }

  // Кнопка "Войти в комнату" внутри модального окна кода
  btnJoinByCode.addEventListener('click', () => {
    onJoinByCodeClick();
  });

  // Закрытие модального окна кода
  document.getElementById('btn-join-code-cancel').addEventListener('click', () => closeJoinCodeModal());
  joinCodeOverlay.addEventListener('click', (e) => {
    if (e.target === joinCodeOverlay) closeJoinCodeModal();
  });

  document.getElementById('btn-create').addEventListener('click', () => {
    openCreateModal();
  });

  document.getElementById('create-cancel').addEventListener('click', () => closeCreateModal());
  createOverlay.addEventListener('click', (e) => {
    if (e.target === createOverlay) closeCreateModal();
  });
  document.getElementById('create-submit').addEventListener('click', () => submitCreateRoom());

  document.getElementById('home-join-pw-cancel').addEventListener('click', () => closeJoinPwModal());
  joinPwOverlay.addEventListener('click', (e) => {
    if (e.target === joinPwOverlay) closeJoinPwModal();
  });
  document.getElementById('home-join-pw-submit').addEventListener('click', async () => {
    const pw = joinPwPin.getValue();
    if (pw.length !== 6) {
      const eEl = document.getElementById('home-join-pw-err');
      eEl.textContent = 'Введите пароль из 6 символов.';
      eEl.style.display = 'block';
      return;
    }
    const code = window.__homeJoinCode;
    await postJoinRoom({ code, password: pw });
  });

  document.getElementById('btn-logout').addEventListener('click', async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    window.location.href = '/';
  });
})();
