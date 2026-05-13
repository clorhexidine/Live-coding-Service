(function () {
  /**
   * Шесть отдельных ячеек для кода/пароля комнаты.
   * @param {HTMLElement} mount
   * @param {{ ariaLabel?: string }} [opts]
   */
  function createPinRow(mount, opts) {
    const aria = (opts && opts.ariaLabel) || 'Символ кода';
    mount.textContent = '';
    mount.classList.add('pin-row');
    /** @type {HTMLInputElement[]} */
    const inputs = [];
    for (let i = 0; i < 6; i++) {
      const inp = document.createElement('input');
      inp.type = 'text';
      inp.className = 'pin-cell';
      inp.maxLength = 1;
      inp.setAttribute('autocomplete', 'off');
      inp.setAttribute('spellcheck', 'false');
      inp.setAttribute('inputmode', 'text');
      inp.setAttribute('aria-label', `${aria}, позиция ${i + 1}`);
      inputs.push(inp);
      mount.appendChild(inp);
    }

    function gather() {
      return inputs.map((x) => x.value).join('');
    }

    function setAll(s) {
      const t = String(s || '').slice(0, 6);
      for (let i = 0; i < 6; i++) inputs[i].value = t[i] || '';
    }

    function clear() {
      inputs.forEach((el) => {
        el.value = '';
      });
      inputs[0].focus();
    }

    inputs.forEach((inp, idx) => {
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace') {
          if (!inp.value && idx > 0) {
            e.preventDefault();
            inputs[idx - 1].focus();
            inputs[idx - 1].value = '';
          }
        } else if (e.key === 'ArrowLeft' && idx > 0) {
          e.preventDefault();
          inputs[idx - 1].focus();
        } else if (e.key === 'ArrowRight' && idx < 5) {
          e.preventDefault();
          inputs[idx + 1].focus();
        }
      });

      inp.addEventListener('input', () => {
        let v = inp.value.replace(/\s/g, '');
        if (v.length > 1) {
          let rest = v.slice(1);
          inp.value = v[0] || '';
          let j = idx;
          while (rest && j < 5) {
            j += 1;
            inputs[j].value = rest[0];
            rest = rest.slice(1);
          }
        } else {
          inp.value = v.slice(-1) || '';
        }
        if (inp.value && idx < 5) inputs[idx + 1].focus();
      });

      inp.addEventListener('paste', (e) => {
        e.preventDefault();
        const text = (e.clipboardData.getData('text') || '').replace(/\s/g, '').slice(0, 6);
        for (let k = 0; k < 6; k++) inputs[k].value = text[k] || '';
        const nextPos = Math.min(Math.max(text.length - 1, 0), 5);
        inputs[nextPos].focus();
      });
    });

    return {
      getValue: () => gather(),
      setValue: (s) => setAll(s),
      clear,
      focus: () => inputs[0].focus(),
      mount,
    };
  }

  window.createPinRow = createPinRow;
})();
