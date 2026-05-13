const roomList = document.getElementById('room-list');
const loading = document.getElementById('loading');
const joinCodeHost = document.getElementById('home-join-code-pin');
const btnJoinByCode = document.getElementById('btn-join-by-code');
const joinCodeHint = document.getElementById('join-code-hint');
const createOverlay = document.getElementById('create-room-overlay');
const joinPwOverlay = document.getElementById('home-join-pw-overlay');

let currentUserId = null;
/** @type {ReturnType<typeof createPinRow> | null} */
let joinCodePin = null;
/** @type {ReturnType<typeof createPinRow> | null} */
let createPwPin = null;
/** @type {ReturnType<typeof createPinRow> | null} */
let createPw2Pin = null;
/** @type {ReturnType<typeof createPinRow> | null} */
let joinPwPin = null;
let pendingJoinRoomId = null;

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

async function requireAuth() {
  const me = await getMe();
  if (!me || !me.id) {
    window.location.href = '/';
    return null;
  }
  currentUserId = me.id;
  return me;
}

function openCreateModal() {
  document.getElementById('create-title').value = '';
  createPwPin.clear();
  createPw2Pin.clear();
  document.getElementById('create-err').style.display = 'none';
  document.getElementById('create-err').textContent = '';
  createOverlay.style.display = '';
  createPwPin.focus();
}

function closeCreateModal() {
  createOverlay.style.display = 'none';
}

function openJoinPwModal(roomId) {
  pendingJoinRoomId = roomId;
  joinPwPin.clear();
  document.getElementById('home-join-pw-err').style.display = 'none';
  joinPwOverlay.style.display = '';
  joinPwPin.focus();
}

function closeJoinPwModal() {
  joinPwOverlay.style.display = 'none';
  pendingJoinRoomId = null;
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
    openJoinPwModal(preview.room_id);
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
  await tryJoinAfterPreview(preview, code);
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
    loading.textContent = 'Пока нет комнат. Нажмите «Создать комнату».';
    return;
  }
  rooms.forEach((r) => {
    const li = document.createElement('li');
    li.className = 'room-item';

    const displayTitle = r.title || `Комната #${r.id}`;
    const isOwner = r.owner_id === currentUserId;

    const titleHost = document.createElement('div');
    titleHost.className = 'room-title-host';

    const leftBlock = document.createElement('div');
    leftBlock.className = 'room-left-block';

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

    const colDivider = document.createElement('div');
    colDivider.className = 'room-col-divider';
    colDivider.setAttribute('aria-hidden', 'true');

    const openLink = document.createElement('a');
    openLink.className = 'room-open-link';
    openLink.href = `/room/${r.id}`;
    openLink.textContent = 'Открыть';

    leftBlock.appendChild(titleStack);
    leftBlock.appendChild(colDivider);
    leftBlock.appendChild(openLink);
    titleHost.appendChild(leftBlock);

    const actions = document.createElement('div');
    actions.className = 'room-actions';

    if (isOwner) {
      const btnGear = document.createElement('button');
      btnGear.type = 'button';
      btnGear.className = 'btn-room-action btn-room-gear';
      btnGear.title = 'Настройки комнаты';
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
              loading.textContent = 'Пока нет комнат. Нажмите «Создать комнату».';
            }
          },
          onSaved: () => {
            loadRooms();
          },
        });
      });
      actions.appendChild(btnGear);
    }

    li.appendChild(titleHost);
    li.appendChild(actions);
    roomList.appendChild(li);
  });
}

async function submitCreateRoom() {
  const err = document.getElementById('create-err');
  err.style.display = 'none';
  const titleRaw = document.getElementById('create-title').value.trim();
  const p = createPwPin.getValue();
  const pc = createPw2Pin.getValue();
  if ((p || pc) && (p.length !== 6 || p !== pc)) {
    err.textContent = 'Пароль: 6 символов и совпадение с подтверждением.';
    err.style.display = 'block';
    return;
  }
  const body = {
    title: titleRaw || null,
    password: p || null,
    password_confirm: pc || null,
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
  createPw2Pin = window.createPinRow(document.getElementById('create-pw2-pin'), { ariaLabel: 'Подтверждение пароля' });
  joinPwPin = window.createPinRow(document.getElementById('home-join-pw-pin'), { ariaLabel: 'Пароль комнаты' });

  await requireAuth();
  bootKickedNotice();
  await loadRooms();

  btnJoinByCode.addEventListener('click', () => {
    onJoinByCodeClick();
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
      const e = document.getElementById('home-join-pw-err');
      e.textContent = 'Введите пароль из 6 символов.';
      e.style.display = 'block';
      return;
    }
    const code = window.__homeJoinCode;
    const ok = await postJoinRoom({ code, password: pw });
    if (ok) closeJoinPwModal();
  });

  document.getElementById('btn-logout').addEventListener('click', async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    window.location.href = '/';
  });
})();
