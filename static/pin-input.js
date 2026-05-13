/**
 * Панель из 6 ячеек для кода/пароля комнаты.
 * @param {HTMLElement} container
 * @param {{ onComplete?: (value: string) => void }} [opts]
 */
function mountPin6(container, opts = {}) {
  const onComplete = opts.onComplete || null;
  container.innerHTML = '';
  container.classList.add('pin6');
  const inputs = [];
  const cells = [];

  function normalizeChar(ch) {
    const c = String(ch || '').toUpperCase();
    if (/^[0-9A-Z]$/.test(c)) return c;
    return '';
  }

  function emitComplete() {
    const v = getValue();
    if (v.length === 6 && onComplete) onComplete(v);
  }

  for (let i = 0; i < 6; i += 1) {
    const cell = document.createElement('div');
    cell.className = 'pin6-cell';
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.className = 'pin6-input';
    inp.maxLength = 1;
    inp.setAttribute('inputmode', 'text');
    inp.setAttribute('autocomplete', 'one-time-code');
    inp.setAttribute('spellcheck', 'false');
    inp.dataset.index = String(i);
    cell.appendChild(inp);
    container.appendChild(cell);
    inputs.push(inp);
    cells.push(cell);
  }

  function getValue() {
    return inputs.map((el) => (el.value || '').toUpperCase()).join('');
  }

  function setValue(str) {
    const s = String(str || '').toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 6);
    for (let i = 0; i < 6; i += 1) {
      inputs[i].value = s[i] || '';
    }
  }

  function clear() {
    setValue('');
  }

  function focusIndex(idx) {
    const i = Math.max(0, Math.min(5, idx));
    inputs[i].focus();
    try {
      inputs[i].setSelectionRange(0, 1);
    } catch (_) {
      /* */
    }
  }

  inputs.forEach((inp, i) => {
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace') {
        if (inp.value) {
          inp.value = '';
          e.preventDefault();
        } else if (i > 0) {
          inputs[i - 1].value = '';
          focusIndex(i - 1);
          e.preventDefault();
        }
        return;
      }
      if (e.key === 'ArrowLeft' && i > 0) {
        e.preventDefault();
        focusIndex(i - 1);
      } else if (e.key === 'ArrowRight' && i < 5) {
        e.preventDefault();
        focusIndex(i + 1);
      }
    });

    inp.addEventListener('input', () => {
      let v = normalizeChar(inp.value);
      if (!v && inp.value) {
        inp.value = '';
        return;
      }
      inp.value = v;
      if (v && i < 5) focusIndex(i + 1);
      emitComplete();
    });

    inp.addEventListener('paste', (e) => {
      e.preventDefault();
      const t = (e.clipboardData || window.clipboardData).getData('text') || '';
      const cleaned = t.toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 6);
      if (!cleaned) return;
      for (let j = 0; j < 6; j += 1) {
        inputs[j].value = cleaned[j] || '';
      }
      focusIndex(Math.min(5, cleaned.length));
      emitComplete();
    });
  });

  return {
    getValue,
    setValue,
    clear,
    focus: () => focusIndex(0),
    destroy() {
      container.innerHTML = '';
      container.classList.remove('pin6');
    },
  };
}

window.mountPin6 = mountPin6;
