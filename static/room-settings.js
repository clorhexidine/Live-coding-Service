function tabIdHeaders() {
  if (!window.LIVE_CLIENT_TAB_ID) {
    window.LIVE_CLIENT_TAB_ID =
      window.crypto && window.crypto.randomUUID
        ? window.crypto.randomUUID()
        : `t-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
  return { 'X-Client-Tab-Id': window.LIVE_CLIENT_TAB_ID };
}

/**
 * Модальное окно настроек комнаты (только владелец). Требует: modal.js, pin-ui.js.
 * @param {number} roomId
 * @param {{ onDeleted?: () => void, onSaved?: () => void }} [hooks]
 */
async function openRoomSettingsModal(roomId, hooks) {
  const onDeleted = hooks && hooks.onDeleted;
  const onSaved = hooks && hooks.onSaved;

  const BASE_URL = window.location.origin;

  const overlay = document.createElement('div');
  overlay.className = 'room-settings-overlay';
  overlay.innerHTML = `
    <div class="room-settings-dialog rs-dialog" role="dialog" aria-modal="true" aria-labelledby="rs-title">
      <button type="button" class="room-settings-close" aria-label="Закрыть">×</button>
      <h2 id="rs-title" class="room-settings-h2">Настройки комнаты</h2>

      <!-- Название -->
      <div class="rs-section">
        <label class="rs-label" for="rs-title-input">Название</label>
        <input id="rs-title-input" type="text" maxlength="255" class="room-settings-title-input" />
      </div>

      <!-- Приглашение -->
      <div class="rs-section">
        <div class="rs-label">Приглашение</div>
        <div class="rs-invite-box">
          <a class="rs-invite-link" id="rs-invite-link" href="#" target="_blank" rel="noopener noreferrer"></a>
          <div class="rs-invite-actions">
            <button type="button" class="btn-secondary btn-compact" id="rs-copy-link">Копировать ссылку</button>
            <button type="button" class="btn-secondary btn-compact" id="rs-copy-code">
              Код: <span class="rs-code-badge" id="rs-code"></span>
            </button>
          </div>
        </div>
      </div>

      <!-- Участники -->
      <div class="rs-section">
        <div class="rs-label">Участники</div>
        <ul class="room-settings-members" id="rs-members"></ul>
      </div>

      <!-- Забаненные (скрыто если пусто) -->
      <div class="rs-section" id="rs-banned-section" style="display:none">
        <div class="rs-label rs-label--muted">Удалённые участники</div>
        <ul class="room-settings-members" id="rs-banned"></ul>
      </div>

      <!-- Пароль (скрытая панель) -->
      <div class="rs-section">
        <button type="button" class="rs-pwd-toggle" id="rs-pwd-toggle">
          <span id="rs-pwd-toggle-text">Изменить пароль комнаты</span>
          <span class="rs-pwd-toggle-arrow" id="rs-pwd-arrow">▸</span>
        </button>
        <div class="rs-pwd-panel" id="rs-pwd-panel" style="display:none">
          <div id="rs-clear-wrap" class="room-settings-check-wrap" style="display:none">
            <label class="room-settings-check">
              <input type="checkbox" id="rs-clear-pw" />
              <span>Убрать защиту паролем</span>
            </label>
          </div>
          <div id="rs-old-wrap" class="room-settings-pin-block" style="display:none">
            <span class="room-settings-hint">Текущий пароль</span>
            <div id="rs-old-pin" class="pin-row-host"></div>
          </div>
          <div id="rs-new-wrap" class="room-settings-pin-block">
            <span class="room-settings-hint" id="rs-new-hint">Новый пароль (6 символов)</span>
            <div id="rs-new-pin" class="pin-row-host"></div>
          </div>
        </div>
      </div>

      <p class="room-settings-error" id="rs-err" style="display:none"></p>

      <div class="room-settings-actions rs-actions-row">
        <button type="button" class="btn-primary rs-save-btn" id="rs-save">Сохранить</button>
        <button type="button" class="app-modal-btn app-modal-btn--danger rs-delete-btn" id="rs-delete">Удалить комнату</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const inviteLink = overlay.querySelector('#rs-invite-link');
  const codeEl = overlay.querySelector('#rs-code');
  const titleInput = overlay.querySelector('#rs-title-input');
  const clearPw = overlay.querySelector('#rs-clear-pw');
  const clearWrap = overlay.querySelector('#rs-clear-wrap');
  const oldWrap = overlay.querySelector('#rs-old-wrap');
  const newWrap = overlay.querySelector('#rs-new-wrap');
  const newHint = overlay.querySelector('#rs-new-hint');
  const errEl = overlay.querySelector('#rs-err');
  const membersUl = overlay.querySelector('#rs-members');
  const bannedUl = overlay.querySelector('#rs-banned');
  const bannedSection = overlay.querySelector('#rs-banned-section');
  const pwdToggle = overlay.querySelector('#rs-pwd-toggle');
  const pwdPanel = overlay.querySelector('#rs-pwd-panel');
  const pwdArrow = overlay.querySelector('#rs-pwd-arrow');
  const pwdToggleText = overlay.querySelector('#rs-pwd-toggle-text');

  const oldPinHost = overlay.querySelector('#rs-old-pin');
  const newPinHost = overlay.querySelector('#rs-new-pin');
  const oldPin = window.createPinRow(oldPinHost, { ariaLabel: 'Текущий пароль комнаты' });
  const newPin = window.createPinRow(newPinHost, { ariaLabel: 'Новый пароль' });

  let fullInviteUrl = '';
  let hasRoomPassword = false;
  let initialTitle = '';
  let pwdPanelOpen = false;

  function close() {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  }

  function onKey(e) {
    if (e.key === 'Escape') close();
  }
  document.addEventListener('keydown', onKey);

  overlay.querySelector('.room-settings-close').addEventListener('click', close);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });

  // Переключатель панели пароля
  pwdToggle.addEventListener('click', () => {
    pwdPanelOpen = !pwdPanelOpen;
    pwdPanel.style.display = pwdPanelOpen ? 'block' : 'none';
    pwdArrow.textContent = pwdPanelOpen ? '▾' : '▸';
    if (!pwdPanelOpen) {
      // Сбрасываем при закрытии
      clearPw.checked = false;
      oldPin.clear();
      newPin.clear();
      syncPasswordUi();
    }
  });

  function showErr(t) {
    if (!t) {
      errEl.style.display = 'none';
      errEl.textContent = '';
      return;
    }
    errEl.style.display = '';
    errEl.textContent = t;
  }

  function syncPasswordUi() {
    const clr = clearPw.checked;
    if (hasRoomPassword) {
      oldWrap.style.display = (clr || newPin.getValue()) ? 'block' : 'none';
      newHint.textContent = 'Новый пароль (6 символов)';
    } else {
      oldWrap.style.display = 'none';
      newHint.textContent = 'Пароль (6 символов, необязательно)';
    }
    newWrap.style.display = clr ? 'none' : 'block';
  }

  clearPw.addEventListener('change', syncPasswordUi);
  newPinHost.addEventListener('input', () => {
    if (hasRoomPassword && !clearPw.checked) {
      oldWrap.style.display = newPin.getValue() ? 'block' : 'none';
    }
  });

  async function load() {
    const res = await fetch(`/api/rooms/${roomId}/settings`, { credentials: 'include' });
    if (res.status === 401) {
      window.location.href = '/';
      return;
    }
    if (!res.ok) {
      await showAppAlert('Не удалось загрузить настройки', { title: 'Ошибка' });
      close();
      return;
    }
    const data = await res.json();
    applyData(data);
  }

  function applyData(data) {
    initialTitle = data.title || '';
    titleInput.value = initialTitle;

    const code = data.invite_code || '';
    fullInviteUrl = `${BASE_URL}/join/${code}`;
    inviteLink.href = fullInviteUrl;
    inviteLink.textContent = fullInviteUrl;
    codeEl.textContent = code || '—';

    hasRoomPassword = !!data.has_room_password;
    clearWrap.style.display = hasRoomPassword ? '' : 'none';
    pwdToggleText.textContent = hasRoomPassword
      ? 'Изменить / убрать пароль комнаты'
      : 'Установить пароль комнаты';

    clearPw.checked = false;
    oldPin.clear();
    newPin.clear();
    syncPasswordUi();

    renderMembers(data.members || []);
    renderBanned(data.banned_members || []);
  }

  function renderMembers(members) {
    membersUl.innerHTML = '';
    members.forEach((m) => {
      const li = document.createElement('li');
      li.className = 'room-settings-member';
      const name = document.createElement('span');
      name.className = 'room-settings-member-name';
      name.textContent = m.username + (m.is_owner ? ' (владелец)' : '');
      li.appendChild(name);
      if (!m.is_owner) {
        const kick = document.createElement('button');
        kick.type = 'button';
        kick.className = 'btn-kick-member';
        kick.setAttribute('aria-label', `Удалить ${m.username}`);
        kick.title = 'Удалить из комнаты';
        kick.textContent = '⊗';
        kick.addEventListener('click', async () => {
          const ok = await showAppConfirm({
            title: 'Удалить участника',
            message: `Удалить пользователя «${m.username}» из комнаты?\nОн не сможет зайти по текущей ссылке.`,
            confirmText: 'Удалить',
            cancelText: 'Отмена',
            danger: true,
          });
          if (!ok) return;
          const res = await fetch(`/api/rooms/${roomId}/members/${m.id}`, {
            method: 'DELETE',
            credentials: 'include',
          });
          if (res.status === 401) {
            window.location.href = '/';
            return;
          }
          if (!res.ok) {
            const j = await res.json().catch(() => ({}));
            await showAppAlert(typeof j.detail === 'string' ? j.detail : 'Не удалось удалить', {
              title: 'Ошибка',
            });
            return;
          }
          await load();
          if (onSaved) onSaved();
        });
        li.appendChild(kick);
      }
      membersUl.appendChild(li);
    });
  }

  function renderBanned(banned) {
    bannedUl.innerHTML = '';
    if (!banned.length) {
      bannedSection.style.display = 'none';
      return;
    }
    bannedSection.style.display = '';
    banned.forEach((m) => {
      const li = document.createElement('li');
      li.className = 'room-settings-member';
      const name = document.createElement('span');
      name.className = 'room-settings-member-name rs-banned-name';
      name.textContent = m.username;
      li.appendChild(name);

      const reinviteBtn = document.createElement('button');
      reinviteBtn.type = 'button';
      reinviteBtn.className = 'btn-reinvite';
      reinviteBtn.title = 'Пригласить заново (новая ссылка)';
      reinviteBtn.textContent = 'Новое приглашение';
      reinviteBtn.addEventListener('click', async () => {
        const ok = await showAppConfirm({
          title: 'Новое приглашение',
          message: `Снять блокировку для «${m.username}» и сгенерировать новую ссылку?\nСтарая ссылка перестанет работать для всех.`,
          confirmText: 'Да, создать',
          cancelText: 'Отмена',
        });
        if (!ok) return;
        const res = await fetch(`/api/rooms/${roomId}/reinvite/${m.id}`, {
          method: 'POST',
          credentials: 'include',
        });
        if (res.status === 401) {
          window.location.href = '/';
          return;
        }
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          await showAppAlert(typeof j.detail === 'string' ? j.detail : 'Не удалось', { title: 'Ошибка' });
          return;
        }
        const data = await res.json();
        applyData(data);
        if (onSaved) onSaved();
      });
      li.appendChild(reinviteBtn);
      bannedUl.appendChild(li);
    });
  }

  overlay.querySelector('#rs-copy-link').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(fullInviteUrl);
      showErr('');
    } catch (_) {
      showErr('Не удалось скопировать ссылку');
    }
  });

  overlay.querySelector('#rs-copy-code').addEventListener('click', async () => {
    const c = codeEl.textContent.trim();
    if (c === '—') return;
    try {
      await navigator.clipboard.writeText(c);
      showErr('');
    } catch (_) {
      showErr('Не удалось скопировать код');
    }
  });

  overlay.querySelector('#rs-save').addEventListener('click', async () => {
    showErr('');
    const body = {};
    const t = titleInput.value.trim();
    if (t !== (initialTitle || '').trim()) {
      if (!t) {
        showErr('Введите название или оставьте без изменений.');
        return;
      }
      body.title = t;
    }

    if (pwdPanelOpen) {
      const np = newPin.getValue();
      const oldp = oldPin.getValue();

      if (clearPw.checked) {
        if (hasRoomPassword) {
          body.clear_room_password = true;
          body.old_room_password = oldp;
        }
      } else if (np) {
        if (np.length !== 6) {
          showErr('Новый пароль: ровно 6 символов.');
          return;
        }
        body.new_room_password = np;
        body.new_room_password_confirm = np;
        if (hasRoomPassword) body.old_room_password = oldp;
      }
    }

    if (!Object.keys(body).length) {
      close();
      return;
    }

    const res = await fetch(`/api/rooms/${roomId}/settings`, {
      method: 'PATCH',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...tabIdHeaders(),
      },
      body: JSON.stringify(body),
    });
    if (res.status === 401) {
      window.location.href = '/';
      return;
    }
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      showErr(typeof j.detail === 'string' ? j.detail : 'Не удалось сохранить');
      return;
    }
    if (onSaved) onSaved();
    close();
  });

  overlay.querySelector('#rs-delete').addEventListener('click', async () => {
    const ok = await showAppConfirm({
      title: 'Удалить комнату',
      message: 'Удалить эту комнату? Все файлы будут удалены.',
      confirmText: 'Удалить',
      cancelText: 'Отмена',
      danger: true,
    });
    if (!ok) return;
    const res = await fetch(`/api/rooms/${roomId}`, { method: 'DELETE', credentials: 'include' });
    if (res.status === 401) {
      window.location.href = '/';
      return;
    }
    if (!res.ok) {
      await showAppAlert('Не удалось удалить комнату', { title: 'Ошибка' });
      return;
    }
    close();
    if (onDeleted) onDeleted();
  });

  await load();
}

window.openRoomSettingsModal = openRoomSettingsModal;
