(function () {
  let ui = null;
  let keyHandler = null;

  function buildUi() {
    if (ui) return ui;
    const overlay = document.createElement('div');
    overlay.className = 'app-modal-overlay';
    overlay.setAttribute('aria-hidden', 'true');
    overlay.innerHTML = `
      <div class="app-modal" role="dialog" aria-modal="true" aria-labelledby="app-modal-title">
        <h2 class="app-modal__title" id="app-modal-title"></h2>
        <p class="app-modal__message" id="app-modal-message"></p>
        <div class="app-modal__actions"></div>
      </div>`;
    document.body.appendChild(overlay);
    const dialog = overlay.querySelector('.app-modal');
    ui = {
      overlay,
      dialog,
      titleEl: overlay.querySelector('.app-modal__title'),
      messageEl: overlay.querySelector('.app-modal__message'),
      actionsEl: overlay.querySelector('.app-modal__actions'),
    };
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        e.preventDefault();
        e.stopPropagation();
      }
    });
    return ui;
  }

  function setOpen(open) {
    const U = buildUi();
    U.overlay.classList.toggle('app-modal-overlay--open', open);
    U.overlay.setAttribute('aria-hidden', open ? 'false' : 'true');
    document.body.classList.toggle('app-modal-open', open);
    if (open) {
      keyHandler = (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          if (U._onEscape) U._onEscape();
        }
      };
      document.addEventListener('keydown', keyHandler);
    } else if (keyHandler) {
      document.removeEventListener('keydown', keyHandler);
      keyHandler = null;
    }
  }

  /**
   * @param {string} message
   * @param {{ title?: string, okText?: string }} [opts]
   */
  function showAppAlert(message, opts = {}) {
    return new Promise((resolve) => {
      const U = buildUi();
      U.titleEl.textContent = opts.title || 'Сообщение';
      U.messageEl.textContent = message;
      U.actionsEl.innerHTML = '';
      const ok = document.createElement('button');
      ok.type = 'button';
      ok.className = 'app-modal-btn app-modal-btn--primary';
      ok.textContent = opts.okText || 'Понятно';
      const done = () => {
        U._onEscape = null;
        setOpen(false);
        resolve();
      };
      ok.addEventListener('click', done);
      U._onEscape = done;
      U.actionsEl.appendChild(ok);
      setOpen(true);
      requestAnimationFrame(() => ok.focus());
    });
  }

  /**
   * @param {{ title?: string, message: string, confirmText?: string, cancelText?: string, danger?: boolean }} opts
   * @returns {Promise<boolean>}
   */
  function showAppConfirm(opts) {
    return new Promise((resolve) => {
      const U = buildUi();
      U.titleEl.textContent = opts.title || 'Подтверждение';
      U.messageEl.textContent = opts.message;
      U.actionsEl.innerHTML = '';
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'app-modal-btn app-modal-btn--secondary';
      cancel.textContent = opts.cancelText || 'Отмена';
      const confirm = document.createElement('button');
      confirm.type = 'button';
      confirm.className = opts.danger
        ? 'app-modal-btn app-modal-btn--danger'
        : 'app-modal-btn app-modal-btn--primary';
      confirm.textContent = opts.confirmText || 'OK';
      const finish = (v) => {
        U._onEscape = null;
        setOpen(false);
        resolve(v);
      };
      cancel.addEventListener('click', () => finish(false));
      confirm.addEventListener('click', () => finish(true));
      U._onEscape = () => finish(false);
      U.actionsEl.appendChild(cancel);
      U.actionsEl.appendChild(confirm);
      setOpen(true);
      requestAnimationFrame(() => (opts.danger ? cancel : confirm).focus());
    });
  }

  window.showAppAlert = showAppAlert;
  window.showAppConfirm = showAppConfirm;
})();
