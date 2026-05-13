(function () {
  const STORAGE_KEY = 'app-theme-palette';
  const LEGACY_KEY = 'app-theme';
  const root = document.documentElement;

  /** @type {readonly string[]} */
  const PALETTE_IDS = ['dark', 'light', 'ocean', 'violet', 'rose', 'amber', 'forest', 'crimson'];

  function normalizeStored(raw) {
    const s = (raw || '').trim().toLowerCase();
    if (PALETTE_IDS.includes(s)) return s;
    return 'dark';
  }

  function readPalette() {
    let v = localStorage.getItem(STORAGE_KEY);
    if (v) return normalizeStored(v);
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy === 'light') return 'light';
    return 'dark';
  }

  function applyPalette(id) {
    const p = normalizeStored(id);
    if (p === 'dark') {
      root.removeAttribute('data-theme');
    } else {
      root.setAttribute('data-theme', p);
    }
    localStorage.setItem(STORAGE_KEY, p);
    try {
      localStorage.removeItem(LEGACY_KEY);
    } catch (_) {
      /* ignore */
    }
    updateSwatchSelection();
    updateToggle();
  }

  function currentPalette() {
    const attr = root.getAttribute('data-theme');
    if (!attr) return 'dark';
    return normalizeStored(attr);
  }

  function updateSwatchSelection() {
    const cur = currentPalette();
    document.querySelectorAll('.theme-swatch[data-palette]').forEach((btn) => {
      const id = btn.getAttribute('data-palette');
      btn.setAttribute('aria-pressed', id === cur ? 'true' : 'false');
    });
  }

  function updateToggle() {
    const btn = document.getElementById('theme-toggle');
    if (!btn) return;
    btn.textContent = '☀';
    btn.title = 'Тема оформления';
    btn.setAttribute('aria-label', 'Выбор темы оформления');
    const open = document.getElementById('theme-picker')?.classList.contains('theme-picker--open');
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  function closePicker() {
    const picker = document.getElementById('theme-picker');
    if (!picker) return;
    picker.classList.remove('theme-picker--open');
    picker.setAttribute('aria-hidden', 'true');
    updateToggle();
  }

  function togglePicker() {
    const picker = document.getElementById('theme-picker');
    if (!picker) return;
    const open = picker.classList.toggle('theme-picker--open');
    picker.setAttribute('aria-hidden', open ? 'false' : 'true');
    updateToggle();
  }

  function buildDock() {
    let dock = document.getElementById('theme-dock');
    if (dock) return dock;

    dock = document.createElement('div');
    dock.id = 'theme-dock';
    dock.className = 'theme-dock';

    const picker = document.createElement('div');
    picker.id = 'theme-picker';
    picker.className = 'theme-picker';
    picker.setAttribute('role', 'menu');
    picker.setAttribute('aria-hidden', 'true');

    const inner = document.createElement('div');
    inner.className = 'theme-picker-inner';

    const row1 = document.createElement('div');
    row1.className = 'theme-picker-row';
    const row2 = document.createElement('div');
    row2.className = 'theme-picker-row';

    const specs = [
      { id: 'dark', label: 'Тёмная', cls: 'theme-swatch--dark' },
      { id: 'light', label: 'Светлая', cls: 'theme-swatch--light' },
      { id: 'ocean', label: 'Голубая', cls: 'theme-swatch--ocean' },
      { id: 'violet', label: 'Фиолетовая', cls: 'theme-swatch--violet' },
      { id: 'rose', label: 'Розовая', cls: 'theme-swatch--rose' },
      { id: 'amber', label: 'Тёплая жёлтая', cls: 'theme-swatch--amber' },
      { id: 'forest', label: 'Зелёная', cls: 'theme-swatch--forest' },
      { id: 'crimson', label: 'Красная', cls: 'theme-swatch--crimson' },
    ];

    specs.forEach((s, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `theme-swatch ${s.cls}`;
      b.dataset.palette = s.id;
      b.title = s.label;
      b.setAttribute('aria-label', s.label);
      b.setAttribute('role', 'menuitem');
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        applyPalette(s.id);
        closePicker();
      });
      if (i < 4) row1.appendChild(b);
      else row2.appendChild(b);
    });

    const divider = document.createElement('div');
    divider.className = 'theme-picker-divider';
    divider.setAttribute('aria-hidden', 'true');

    inner.appendChild(row1);
    inner.appendChild(divider);
    inner.appendChild(row2);
    picker.appendChild(inner);

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.id = 'theme-toggle';
    toggle.className = 'theme-toggle';
    toggle.textContent = '☀';
    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      togglePicker();
    });

    dock.appendChild(picker);
    dock.appendChild(toggle);
    document.body.appendChild(dock);

    document.addEventListener('click', () => closePicker());
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closePicker();
    });
    picker.addEventListener('click', (e) => e.stopPropagation());

    return dock;
  }

  function init() {
    const stored = readPalette();
    if (stored === 'dark') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', stored);

    buildDock();
    updateSwatchSelection();
    updateToggle();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
