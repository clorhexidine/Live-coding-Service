/**
 * Модальное окно настроек комнаты (только владелец). Требует: modal.js, pin-ui.js.
 * @param {number} roomId
 * @param {{ onDeleted?: () => void, onSaved?: () => void }} [hooks]
 */
async function openRoomSettingsModal(roomId, hooks) {
  const onDeleted = hooks && hooks.onDeleted;
  const onSaved = hooks && hooks.onSaved;

  const overlay = document.createElement('div');
  overlay.className = 'room-settings-overlay';
  overlay.innerHTML = `
    <div class="room-settings-dialog" role="dialog" aria-modal="true" aria-labelledby="rs-title">
      <button type="button" class="room-settings-close" aria-label="Закрыть">×</button>
      <h2 id="rs-title" class="room-settings-h2">Настройки комнаты</h2>
      <div class="room-settings-section">
        <div class="room-settings-label">Приглашение</div>
        <div class="room-settings-invite-row">
          <a class="room-settings-invite-link" id="rs-invite-link" href="#" target="_blank" rel="noopener noreferrer"></a>
          <button type="button" class="btn-secondary btn-compact" id="rs-copy-link">Копировать ссылку</button>
        </div>
        <div class="room-settings-code-row">
          <span class="room-settings-code" id="rs-code"></span>
          <button type="button" class="btn-secondary btn-compact" id="rs-copy-code">Копировать код</button>
        </div>
      </div>
      <div class="form-group room-settings-field">
        <label for="rs-title-input">Название</label>
        <input id="rs-title-input" type="text" maxlength="255" />
      </div>
      <div class="room-settings-section" id="rs-pwd-section">
        <div class="room-settings-label">Пароль комнаты</div>
        <div id="rs-clear-wrap" class="room-settings-check-wrap">
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
          <span class="room-settings-hint">Новый пароль (6 символов, необязательно)</span>
          <div id="rs-new-pin" class="pin-row-host"></div>
          <span class="room-settings-hint">Подтверждение</span>
          <div id="rs-new-pin2" class="pin-row-host"></div>
        </div>
      </div>
      <div class="room-settings-section">
        <div class="room-settings-label">Участники</div>
        <ul class="room-settings-members" id="rs-members"></ul>
      </div>
      <p class="room-settings-error" id="rs-err" style="display:none"></p>
      <div class="room-settings-actions">
        <button type="button" class="btn-primary" id="rs-save">Сохранить</button>
        <button type="button" class="app-modal-btn app-modal-btn--danger" id="rs-delete">Удалить комнату</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const inviteLink = overlay.querySelector('#rs-invite-link');
  const codeEl = overlay.querySelector('#rs-code');
  const titleInput = overlay.querySelector('#rs-title-input');
  const clearPw = overlay.querySelector('#rs-clear-pw');
  const oldWrap = overlay.querySelector('#rs-old-wrap');
  const newWrap = overlay.querySelector('#rs-new-wrap');
  const errEl = overlay.querySelector('#rs-err');
  const membersUl = overlay.querySelector('#rs-members');

  const oldPinHost = overlay.querySelector('#rs-old-pin');
  const newPinHost = overlay.querySelector('#rs-new-pin');
  const newPin2Host = overlay.querySelector('#rs-new-pin2');
  const oldPin = window.createPinRow(oldPinHost, { ariaLabel: 'Текущий пароль комнаты' });
  const newPin = window.createPinRow(newPinHost, { ariaLabel: 'Новый пароль' });
  const newPin2 = window.createPinRow(newPin2Host, { ariaLabel: 'Подтверждение пароля' });

  let fullInviteUrl = '';
  let hasRoomPassword = false;
  let initialTitle = '';

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
      oldWrap.style.display = clr || newPin.getValue() || newPin2.getValue() ? 'block' : 'none';
    } else {
      oldWrap.style.display = 'none';
    }
    newWrap.style.display = clr ? 'none' : 'block';
  }

  clearPw.addEventListener('change', syncPasswordUi);
  [newPinHost, newPin2Host].forEach((h) =>
    h.addEventListener('input', () => {
      if (hasRoomPassword && !clearPw.checked) {
        oldWrap.style.display = newPin.getValue() || newPin2.getValue() ? 'block' : 'none';
      }
    })
  );

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
    initialTitle = data.title || '';
    titleInput.value = initialTitle;
    const invitePath = data.invite_path || '';
    fullInviteUrl = `${window.location.origin}${invitePath}`;
    inviteLink.href = fullInviteUrl;
    inviteLink.textContent = fullInviteUrl;
    codeEl.textContent = data.invite_code || '—';
    hasRoomPassword = !!data.has_room_password;
    const clearWrap = overlay.querySelector('#rs-clear-wrap');
    if (clearWrap) clearWrap.style.display = hasRoomPassword ? '' : 'none';
    clearPw.checked = false;
    oldPin.clear();
    newPin.clear();
    newPin2.clear();
    syncPasswordUi();
    renderMembers(data.members || []);
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
            message: `Удалить пользователя «${m.username}» из комнаты?`,
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

    const np = newPin.getValue();
    const nc = newPin2.getValue();
    const oldp = oldPin.getValue();

    if (clearPw.checked) {
      if (hasRoomPassword) {
        body.clear_room_password = true;
        body.old_room_password = oldp;
      }
    } else if (np || nc) {
      if (np.length !== 6 || np !== nc) {
        showErr('Новый пароль: ровно 6 символов и совпадение в обоих рядах.');
        return;
      }
      body.new_room_password = np;
      body.new_room_password_confirm = nc;
      if (hasRoomPassword) body.old_room_password = oldp;
    }

    if (!Object.keys(body).length) {
      close();
      return;
    }

    const res = await fetch(`/api/rooms/${roomId}/settings`, {
      method: 'PATCH',
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
