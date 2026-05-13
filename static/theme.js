(function () {
  const KEY = 'app-theme';
  const root = document.documentElement;

  function getTheme() {
    return localStorage.getItem(KEY) === 'light' ? 'light' : 'dark';
  }

  function setTheme(mode) {
    if (mode === 'light') {
      root.setAttribute('data-theme', 'light');
      localStorage.setItem(KEY, 'light');
    } else {
      root.removeAttribute('data-theme');
      localStorage.setItem(KEY, 'dark');
    }
    updateToggle();
  }

  function updateToggle() {
    const btn = document.getElementById('theme-toggle');
    if (!btn) return;
    const light = getTheme() === 'light';
    btn.textContent = '☀';
    btn.title = light
      ? 'Светлая тема (нажмите, чтобы включить тёмную)'
      : 'Тёмная тема (нажмите, чтобы включить светлую)';
    btn.setAttribute('aria-label', btn.title);
  }

  function init() {
    const saved = localStorage.getItem(KEY);
    if (saved === 'light') root.setAttribute('data-theme', 'light');
    else root.removeAttribute('data-theme');

    let btn = document.getElementById('theme-toggle');
    if (!btn) {
      btn = document.createElement('button');
      btn.type = 'button';
      btn.id = 'theme-toggle';
      btn.className = 'theme-toggle';
      document.body.appendChild(btn);
    }
    btn.addEventListener('click', () => {
      setTheme(getTheme() === 'dark' ? 'light' : 'dark');
    });
    updateToggle();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
