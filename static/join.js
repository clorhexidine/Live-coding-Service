(function () {
  const m = window.location.pathname.match(/^\/join\/([^/]+)/);
  const token = m ? m[1] : '';
  const root = document.getElementById('join-root');
  const loadingEl = document.getElementById('join-loading');

  if (!token || !root) {
    window.location.href = '/home';
    return;
  }

  function clearRoot() {
    root.innerHTML = '';
  }

  function showGate(preview) {
    clearRoot();
    const wrap = document.createElement('div');
    wrap.className = 'join-gate-card';
    const t = preview.title || `Комната #${preview.room_id}`;
    wrap.innerHTML = `
      <h1 class="join-gate-title">Приглашение в комнату</h1>
      <p class="join-gate-room-name">${escapeHtml(t)}</p>
      <div id="join-pw-block" class="pin-row-host" style="display:none"></div>
      <p class="room-settings-error" id="join-err" style="display:none"></p>
      <div class="join-gate-actions">
        <button type="button" class="app-modal-btn app-modal-btn--secondary" id="join-cancel">Отмена</button>
        <button type="button" class="btn-primary" id="join-enter">Войти в комнату</button>
      </div>`;
    root.appendChild(wrap);

    const pwBlock = wrap.querySelector('#join-pw-block');
    let pin = null;
    if (preview.has_room_password) {
      pwBlock.style.display = '';
      pin = window.createPinRow(pwBlock, { ariaLabel: 'Пароль комнаты' });
    }

    wrap.querySelector('#join-cancel').addEventListener('click', () => {
      window.location.href = '/home';
    });

    wrap.querySelector('#join-enter').addEventListener('click', async () => {
      const err = wrap.querySelector('#join-err');
      err.style.display = 'none';
      const body = { invite_token: token };
      if (preview.has_room_password) {
        const pw = pin.getValue();
        if (pw.length !== 6) {
          err.textContent = 'Введите пароль из 6 символов.';
          err.style.display = 'block';
          return;
        }
        body.password = pw;
      }
      const res = await fetch('/api/rooms/join', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.status === 401) {
        window.location.href = '/?next=' + encodeURIComponent(window.location.pathname);
        return;
      }
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        err.textContent = typeof j.detail === 'string' ? j.detail : 'Не удалось войти';
        err.style.display = 'block';
        return;
      }
      const data = await res.json();
      window.location.replace(`/room/${data.room_id}`);
    });
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  async function run() {
    const me = await getMe();
    if (!me || !me.id) {
      window.location.href = '/?next=' + encodeURIComponent(window.location.pathname);
      return;
    }

    const res = await fetch(`/api/rooms/join-preview-token/${encodeURIComponent(token)}`, {
      credentials: 'include',
    });
    if (res.status === 401) {
      window.location.href = '/?next=' + encodeURIComponent(window.location.pathname);
      return;
    }
    if (res.status === 404) {
      loadingEl.style.display = 'none';
      clearRoot();
      root.innerHTML =
        '<div class="join-gate-card"><p class="join-gate-room-name">Ссылка недействительна или комната удалена.</p>' +
        '<div class="join-gate-actions"><a class="btn-primary join-link-btn" href="/home">На главную</a></div></div>';
      return;
    }
    if (!res.ok) {
      loadingEl.textContent = 'Не удалось загрузить приглашение';
      return;
    }
    const preview = await res.json();
    loadingEl.style.display = 'none';

    if (preview.already_member) {
      window.location.replace(`/room/${preview.room_id}`);
      return;
    }

    showGate(preview);
  }

  run();
})();
