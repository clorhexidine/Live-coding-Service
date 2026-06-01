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
 * Модальное окно настроек комнаты (только владелец).
 * @param {number} roomId
 * @param {{ onDeleted?: () => void, onSaved?: () => void }} [hooks]
 */
async function openRoomSettingsModal(roomId, hooks) {
  const onDeleted = hooks && hooks.onDeleted;
  const onSaved   = hooks && hooks.onSaved;
  const BASE_URL  = window.location.origin;

  const overlay = document.createElement('div');
  overlay.className = 'rs-overlay';
  overlay.innerHTML = `
    <div class="rs-dialog" role="dialog" aria-modal="true" aria-labelledby="rs-heading">
      <div class="rs-header">
        <h2 id="rs-heading" class="rs-heading">Настройки комнаты</h2>
        <button type="button" class="rs-close" aria-label="Закрыть">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
            <path d="M2 2l14 14M16 2L2 16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          </svg>
        </button>
      </div>

      <div class="rs-body">

        <!-- Название -->
        <div class="rs-field">
          <label class="rs-field-label" for="rs-title-input">Название комнаты</label>
          <input id="rs-title-input" type="text" maxlength="255" class="rs-input" autocomplete="off" />
        </div>

        <!-- Приглашение -->
        <div class="rs-invite-card">
          <div class="rs-invite-bottom">
            <div class="rs-code-pill">
              <span class="rs-code-label">Код</span>
              <span class="rs-code-value" id="rs-code"></span>
            </div>
            <div class="rs-invite-btns">
              <button type="button" class="rs-rotate-btn" id="rs-rotate" title="Обновить код приглашения">
                <svg width="14" height="14" viewBox="0 0 15 15" fill="none" aria-hidden="true">
                  <path d="M13 7.5A5.5 5.5 0 1 1 7.5 2a5.48 5.48 0 0 1 3.89 1.61L13 2v4H9l1.47-1.47A3.5 3.5 0 1 0 11 7.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
                Обновить
              </button>
              <button type="button" class="rs-copy-btn" id="rs-copy-link" title="Копировать ссылку">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                  <rect x="4" y="4" width="8" height="8" rx="1.5" stroke="currentColor" stroke-width="1.4"/>
                  <path d="M2 10V2h8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
                Ссылка
              </button>
              <button type="button" class="rs-copy-btn" id="rs-copy-code" title="Копировать код">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                  <rect x="4" y="4" width="8" height="8" rx="1.5" stroke="currentColor" stroke-width="1.4"/>
                  <path d="M2 10V2h8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
                Код
              </button>
            </div>
          </div>
        </div>

        <!-- Участники -->
        <div class="rs-field">
          <div class="rs-field-label">Участники</div>
          <ul class="rs-member-list" id="rs-members"></ul>
        </div>

        <!-- Пароль -->
        <div class="rs-field">
          <button type="button" class="rs-accordion-btn" id="rs-pwd-toggle">
            <span id="rs-pwd-toggle-text">Установить пароль</span>
            <svg class="rs-accordion-icon" id="rs-pwd-arrow" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
          <div class="rs-accordion-body" id="rs-pwd-panel" style="display:none">
            <div id="rs-clear-wrap" style="display:none; margin-bottom:12px">
              <label class="rs-checkbox-label">
                <input type="checkbox" id="rs-clear-pw" />
                <span>Убрать пароль</span>
              </label>
            </div>
            <div id="rs-old-wrap" style="display:none">
              <p class="rs-pin-label">Текущий пароль</p>
              <div id="rs-old-pin" class="pin-row-host"></div>
            </div>
            <div id="rs-new-wrap">
              <p class="rs-pin-label" id="rs-new-hint">Новый пароль (6 символов, необязательно)</p>
              <div id="rs-new-pin" class="pin-row-host"></div>
            </div>
          </div>
        </div>

      </div><!-- /rs-body -->

      <p class="rs-error" id="rs-err" style="display:none"></p>

      <div class="rs-footer">
        <button type="button" class="rs-btn-save" id="rs-save">Сохранить</button>
        <button type="button" class="rs-btn-danger" id="rs-delete">Удалить комнату</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  // ── Ссылки на элементы ────────────────────────────────────────────────────
  const codeEl       = overlay.querySelector('#rs-code');
  const titleInput   = overlay.querySelector('#rs-title-input');
  const clearPw      = overlay.querySelector('#rs-clear-pw');
  const clearWrap    = overlay.querySelector('#rs-clear-wrap');
  const oldWrap      = overlay.querySelector('#rs-old-wrap');
  const newWrap      = overlay.querySelector('#rs-new-wrap');
  const newHint      = overlay.querySelector('#rs-new-hint');
  const errEl        = overlay.querySelector('#rs-err');
  const membersUl    = overlay.querySelector('#rs-members');
  const pwdToggle    = overlay.querySelector('#rs-pwd-toggle');
  const pwdPanel     = overlay.querySelector('#rs-pwd-panel');
  const pwdArrow     = overlay.querySelector('#rs-pwd-arrow');
  const pwdToggleText= overlay.querySelector('#rs-pwd-toggle-text');
  const rotateBtn    = overlay.querySelector('#rs-rotate');

  const oldPinHost = overlay.querySelector('#rs-old-pin');
  const newPinHost = overlay.querySelector('#rs-new-pin');
  const oldPin = window.createPinRow(oldPinHost, { ariaLabel: 'Текущий пароль комнаты' });
  const newPin = window.createPinRow(newPinHost, { ariaLabel: 'Новый пароль' });

  let fullInviteUrl  = '';
  let hasRoomPassword= false;
  let initialTitle   = '';
  let pwdPanelOpen   = false;

  // ── Закрытие ──────────────────────────────────────────────────────────────
  function close() {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  }
  function onKey(e) { if (e.key === 'Escape') close(); }
  document.addEventListener('keydown', onKey);
  overlay.querySelector('.rs-close').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  // ── Аккордеон пароля ──────────────────────────────────────────────────────
  pwdToggle.addEventListener('click', () => {
    pwdPanelOpen = !pwdPanelOpen;
    pwdPanel.style.display = pwdPanelOpen ? 'block' : 'none';
    pwdArrow.style.transform = pwdPanelOpen ? 'rotate(180deg)' : '';
    if (!pwdPanelOpen) {
      clearPw.checked = false;
      oldPin.clear();
      newPin.clear();
      syncPasswordUi();
    }
  });

  // ── Ошибки ────────────────────────────────────────────────────────────────
  function showErr(t) {
    errEl.style.display = t ? '' : 'none';
    errEl.textContent   = t || '';
  }

  // ── Синхронизация UI пароля ───────────────────────────────────────────────
  function syncPasswordUi() {
    const clr = clearPw.checked;
    if (hasRoomPassword) {
      oldWrap.style.display = (clr || newPin.getValue()) ? 'block' : 'none';
      newHint.textContent = 'Новый пароль (6 символов)';
    } else {
      oldWrap.style.display = 'none';
      newHint.textContent = 'Новый пароль (6 символов, необязательно)';
    }
    newWrap.style.display = clr ? 'none' : 'block';
  }
  clearPw.addEventListener('change', syncPasswordUi);
  newPinHost.addEventListener('input', () => {
    if (hasRoomPassword && !clearPw.checked)
      oldWrap.style.display = newPin.getValue() ? 'block' : 'none';
  });

  // ── Загрузка данных ───────────────────────────────────────────────────────
  async function load() {
    const res = await fetch(`/api/rooms/${roomId}/settings`, { credentials: 'include' });
    if (res.status === 401) { window.location.href = '/'; return; }
    if (!res.ok) {
      await showAppAlert('Не удалось загрузить настройки', { title: 'Ошибка' });
      close(); return;
    }
    applyData(await res.json());
  }

  function applyData(data) {
    initialTitle = data.title || '';
    titleInput.value = initialTitle;

    const code = data.invite_code || '';
    fullInviteUrl = `${BASE_URL}/join/${code}`;
    codeEl.textContent = code || '—';

    hasRoomPassword = !!data.has_room_password;
    clearWrap.style.display = hasRoomPassword ? '' : 'none';
    pwdToggleText.textContent = hasRoomPassword
      ? 'Изменить или убрать пароль'
      : 'Установить пароль';

    clearPw.checked = false;
    oldPin.clear();
    newPin.clear();
    syncPasswordUi();

    renderMembers(data.members || []);
  }

  // ── Участники ─────────────────────────────────────────────────────────────
  function renderMembers(members) {
    membersUl.innerHTML = '';
    members.forEach((m) => {
      const li = document.createElement('li');
      li.className = 'rs-member';
      const nameEl = document.createElement('span');
      nameEl.className = 'rs-member-name';
      nameEl.textContent = m.username;
      if (m.is_owner) {
        const badge = document.createElement('span');
        badge.className = 'rs-member-badge';
        badge.textContent = 'владелец';
        nameEl.appendChild(badge);
      }
      li.appendChild(nameEl);
      if (!m.is_owner) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'rs-member-kick';
        btn.setAttribute('aria-label', `Удалить ${m.username}`);
        btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M2 2l10 10M12 2L2 12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;
        btn.addEventListener('click', async () => {
          const ok = await showAppConfirm({
            title: 'Удалить участника',
            message: `Удалить «${m.username}» из комнаты? Он не сможет войти по текущей ссылке.`,
            confirmText: 'Удалить', cancelText: 'Отмена', danger: true,
          });
          if (!ok) return;
          const r = await fetch(`/api/rooms/${roomId}/members/${m.id}`, {
            method: 'DELETE', credentials: 'include',
          });
          if (r.status === 401) { window.location.href = '/'; return; }
          if (!r.ok) {
            const j = await r.json().catch(() => ({}));
            await showAppAlert(typeof j.detail === 'string' ? j.detail : 'Не удалось удалить', { title: 'Ошибка' });
            return;
          }
          await load();
          if (onSaved) onSaved();
        });
        li.appendChild(btn);
      }
      membersUl.appendChild(li);
    });
  }

  // ── Копирование ───────────────────────────────────────────────────────────
  async function copyText(text, btn) {
    try {
      await navigator.clipboard.writeText(text);
      const orig = btn.innerHTML;
      btn.textContent = '✓ Скопировано';
      btn.classList.add('rs-copy-btn--ok');
      setTimeout(() => { btn.innerHTML = orig; btn.classList.remove('rs-copy-btn--ok'); }, 1800);
    } catch (_) {
      showErr('Не удалось скопировать');
    }
  }

  overlay.querySelector('#rs-copy-link').addEventListener('click', function () {
    copyText(fullInviteUrl, this);
  });
  overlay.querySelector('#rs-copy-code').addEventListener('click', function () {
    const c = codeEl.textContent.trim();
    if (c !== '—') copyText(c, this);
  });

  // ── Новая ссылка ──────────────────────────────────────────────────────────
  rotateBtn.addEventListener('click', async () => {
    const ok = await showAppConfirm({
      title: 'Новая ссылка',
      message: 'Создать новую ссылку-приглашение? Старая перестанет работать для всех.',
      confirmText: 'Создать', cancelText: 'Отмена',
    });
    if (!ok) return;
    rotateBtn.disabled = true;
    const r = await fetch(`/api/rooms/${roomId}/rotate-invite`, {
      method: 'POST', credentials: 'include',
    });
    rotateBtn.disabled = false;
    if (r.status === 401) { window.location.href = '/'; return; }
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      showErr(typeof j.detail === 'string' ? j.detail : 'Не удалось обновить ссылку');
      return;
    }
    applyData(await r.json());
    if (onSaved) onSaved();
  });

  // ── Сохранить ─────────────────────────────────────────────────────────────
  overlay.querySelector('#rs-save').addEventListener('click', async () => {
    showErr('');
    const body = {};
    const t = titleInput.value.trim();
    if (t !== (initialTitle || '').trim()) {
      if (!t) { showErr('Введите название комнаты.'); return; }
      body.title = t;
    }
    if (pwdPanelOpen) {
      const np   = newPin.getValue();
      const oldp = oldPin.getValue();
      if (clearPw.checked) {
        if (hasRoomPassword) { body.clear_room_password = true; body.old_room_password = oldp; }
      } else if (np) {
        if (np.length !== 6) { showErr('Новый пароль должен состоять ровно из 6 символов.'); return; }
        body.new_room_password = np;
        body.new_room_password_confirm = np;
        if (hasRoomPassword) body.old_room_password = oldp;
      }
    }
    if (!Object.keys(body).length) { close(); return; }
    const res = await fetch(`/api/rooms/${roomId}/settings`, {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...tabIdHeaders() },
      body: JSON.stringify(body),
    });
    if (res.status === 401) { window.location.href = '/'; return; }
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      showErr(typeof j.detail === 'string' ? j.detail : 'Не удалось сохранить');
      return;
    }
    if (onSaved) onSaved();
    close();
  });

  // ── Удалить комнату ───────────────────────────────────────────────────────
  overlay.querySelector('#rs-delete').addEventListener('click', async () => {
    const ok = await showAppConfirm({
      title: 'Удалить комнату',
      message: 'Удалить комнату? Все файлы будут безвозвратно удалены.',
      confirmText: 'Удалить', cancelText: 'Отмена', danger: true,
    });
    if (!ok) return;
    const res = await fetch(`/api/rooms/${roomId}`, { method: 'DELETE', credentials: 'include' });
    if (res.status === 401) { window.location.href = '/'; return; }
    if (!res.ok) { await showAppAlert('Не удалось удалить комнату', { title: 'Ошибка' }); return; }
    close();
    if (onDeleted) onDeleted();
  });

  await load();
}

window.openRoomSettingsModal = openRoomSettingsModal;
