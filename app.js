const textInput = document.getElementById('text-input');
const lineNumbers = document.getElementById('line-numbers');
const tabsContainer = document.getElementById('tabs');
const tabAddButton = document.getElementById('tab-add');

// ----- Модель файлов -----
let files = [];
let activeFileId = null;
let nextFileIndex = 2;
const MAX_FILES = 20;
const EDITOR_INDENT = '    ';

const STORAGE_KEY = 'editor-files-v1';

const FILE_PREFIX = 'Файл ';

function createFileName(index) {
  return `${FILE_PREFIX}${index}`;
}

function usedFileNames() {
  return new Set(files.map((f) => (f.name || '').trim()));
}

function nextUniqueDefaultFileName() {
  const used = usedFileNames();
  let k = files.length + 1;
  let cand = `${FILE_PREFIX}${k}`;
  while (used.has(cand)) {
    k += 1;
    cand = `${FILE_PREFIX}${k}`;
  }
  return cand;
}

function computeNextFileIndexForPayload() {
  let maxN = 0;
  for (const f of files) {
    const m = /^Файл (\d+)$/.exec((f.name || '').trim());
    if (m) {
      const n = parseInt(m[1], 10);
      if (!Number.isNaN(n)) maxN = Math.max(maxN, n);
    }
  }
  const fromPattern = maxN + 1;
  const fromCount = files.length + 1;
  return Math.max(2, fromPattern, fromCount);
}

function detectNextIndexFromFiles(list) {
  const savedFiles = files;
  files = list;
  const v = computeNextFileIndexForPayload();
  files = savedFiles;
  return v;
}

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    const initialFile = {
      id: Date.now().toString(36),
      name: 'Файл 1',
      content: ''
    };
    files = [initialFile];
    activeFileId = initialFile.id;
    nextFileIndex = 2;
    return;
  }
  try {
    const data = JSON.parse(raw);
    if (Array.isArray(data.files) && data.files.length > 0) {
      files = data.files;
      activeFileId = data.activeFileId || files[0].id;
      nextFileIndex =
        typeof data.nextFileIndex === 'number'
          ? data.nextFileIndex
          : detectNextIndexFromFiles(files);
    } else {
      const initialFile = {
        id: Date.now().toString(36),
        name: 'Файл 1',
        content: ''
      };
      files = [initialFile];
      activeFileId = initialFile.id;
      nextFileIndex = 2;
    }
  } catch {
    const initialFile = {
      id: Date.now().toString(36),
      name: 'Файл 1',
      content: ''
    };
    files = [initialFile];
    activeFileId = initialFile.id;
    nextFileIndex = 2;
  }
}

function saveState() {
  nextFileIndex = computeNextFileIndexForPayload();
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ files, activeFileId, nextFileIndex })
  );
}

function getActiveFile() {
  return files.find(f => f.id === activeFileId) || files[0];
}

function updateAddButtonState() {
  const disabled = files.length >= MAX_FILES;
  tabAddButton.disabled = disabled;
  tabAddButton.classList.toggle('tab-add--disabled', disabled);
  tabAddButton.title = disabled ? 'Максимум 20 файлов' : 'Новый файл';
}

// ----- Нумерация строк -----

function countLinesFromText(text) {
  if (!text) return 1;
  return text.split('\n').length;
}

function updateLineNumbers(text) {
  const n = countLinesFromText(text);
  const existing = lineNumbers.querySelectorAll('.line-num').length;
  if (n === existing) return;
  lineNumbers.innerHTML = '';
  for (let i = 1; i <= n; i++) {
    const span = document.createElement('span');
    span.className = 'line-num';
    span.textContent = i;
    lineNumbers.appendChild(span);
  }
}

function syncScroll() {
  lineNumbers.scrollTop = textInput.scrollTop;
}

// ----- Рендер вкладок и содержимого -----

function renderTabs({ renameFileId = null } = {}) {
  tabsContainer.innerHTML = '';

  files.forEach((file, index) => {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'tab';
    if (file.id === activeFileId) {
      tab.classList.add('tab--active');
    }
    tab.dataset.id = file.id;

    const label = document.createElement('span');
    label.className = 'tab-label';
    label.textContent = file.name;
    tab.appendChild(label);

    tab.addEventListener('click', () => {
      if (activeFileId === file.id) return;
      activeFileId = file.id;
      applyActiveFileContent();
      renderTabs();
      saveState();
    });

    tabsContainer.appendChild(tab);

    if (renameFileId && renameFileId === file.id) {
      startRenameOnTab(tab, file, index + 1);
    }
  });

  updateAddButtonState();
  applyTabsLayout();
}

function applyTabsLayout() {
  tabsContainer.classList.remove('tabs--compressed');
  // Нормальный режим: вкладки естественной ширины.
  // Если суммарная ширина не помещается, включаем режим сжатия.
  if (tabsContainer.scrollWidth > tabsContainer.clientWidth + 1) {
    tabsContainer.classList.add('tabs--compressed');
  }
}

function applyActiveFileContent() {
  const file = getActiveFile();
  textInput.value = file.content || '';
  updateLineNumbers(textInput.value);
  textInput.scrollTop = 0;
  syncScroll();
}

// ----- Переименование вкладки при создании и по двойному клику -----

function startRenameOnTab(tabElement, file, defaultIndex) {
  const input = document.createElement('input');
  input.className = 'tab-rename-input';
  input.type = 'text';
  const defaultName = file.name || createFileName(defaultIndex);
  input.value = defaultName;

  function finishRename(commit) {
    if (commit) {
      const newName = input.value.trim();
      file.name = newName || defaultName;
      saveState();
    }
    renderTabs();
  }

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      finishRename(true);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      finishRename(false);
    }
  });

  input.addEventListener('blur', () => {
    finishRename(true);
  });

  tabElement.appendChild(input);
  input.focus();
  input.select();
}

tabsContainer.addEventListener('dblclick', (e) => {
  const tab = e.target.closest('.tab');
  if (!tab) return;
  const fileId = tab.dataset.id;
  const file = files.find(f => f.id === fileId);
  if (!file) return;
  const index = files.indexOf(file);
  startRenameOnTab(tab, file, index + 1);
});

// ----- Создание нового файла -----

function addNewFile() {
  if (files.length >= MAX_FILES) {
    updateAddButtonState();
    return;
  }
  const newFile = {
    id: Date.now().toString(36) + Math.random().toString(16).slice(2),
    name: nextUniqueDefaultFileName(),
    content: ''
  };
  files.push(newFile);
  activeFileId = newFile.id;
  nextFileIndex = computeNextFileIndexForPayload();
  saveState();
  applyActiveFileContent();
  renderTabs({ renameFileId: newFile.id });
}

tabAddButton.addEventListener('click', () => {
  addNewFile();
});

// ----- Контекстное меню вкладок -----

const tabMenu = document.createElement('div');
tabMenu.className = 'tab-menu';
tabMenu.innerHTML = `
  <button type="button" class="tab-menu-item" data-action="rename">Переименовать</button>
  <button type="button" class="tab-menu-item" data-action="delete">Удалить</button>
`;
document.body.appendChild(tabMenu);

let menuForFileId = null;

function closeTabMenu() {
  tabMenu.style.display = 'none';
  menuForFileId = null;
}

function openTabMenu(x, y, fileId) {
  menuForFileId = fileId;
  tabMenu.style.display = 'block';

  const menuRect = tabMenu.getBoundingClientRect();
  let left = x;
  let top = y;

  if (left + menuRect.width > window.innerWidth) {
    left = window.innerWidth - menuRect.width - 4;
  }
  if (top + menuRect.height > window.innerHeight) {
    top = window.innerHeight - menuRect.height - 4;
  }

  tabMenu.style.left = `${left}px`;
  tabMenu.style.top = `${top}px`;
}

tabsContainer.addEventListener('contextmenu', (e) => {
  const tab = e.target.closest('.tab');
  if (!tab) return;
  e.preventDefault();
  const fileId = tab.dataset.id;
  if (!fileId) return;

  const rect = tab.getBoundingClientRect();
  openTabMenu(e.clientX, rect.bottom + 2, fileId);
});

tabMenu.addEventListener('click', (e) => {
  const btn = e.target.closest('.tab-menu-item');
  if (!btn || !menuForFileId) return;
  const action = btn.dataset.action;
  const file = files.find(f => f.id === menuForFileId);
  if (!file) {
    closeTabMenu();
    return;
  }

  if (action === 'rename') {
    const tab = tabsContainer.querySelector(`.tab[data-id="${file.id}"]`);
    if (tab) {
      const index = files.indexOf(file);
      startRenameOnTab(tab, file, index + 1);
    }
  } else if (action === 'delete') {
    if (files.length > 1) {
      const idx = files.findIndex(f => f.id === file.id);
      if (idx !== -1) {
        files.splice(idx, 1);
        if (activeFileId === file.id) {
          const newIndex = Math.max(0, idx - 1);
          activeFileId = files[newIndex].id;
        }
        saveState();
        applyActiveFileContent();
        renderTabs();
      }
    }
  }

  closeTabMenu();
});

document.addEventListener('click', (e) => {
  if (tabMenu.style.display === 'none') return;
  if (tabMenu.contains(e.target)) return;
  if (e.target.closest('.tab')) return;
  closeTabMenu();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeTabMenu();
  }
});

window.addEventListener('resize', () => {
  applyTabsLayout();
});

// ----- Инициализация -----

loadState();
renderTabs();
applyActiveFileContent();

textInput.addEventListener('input', () => {
  const file = getActiveFile();
  file.content = textInput.value;
  updateLineNumbers(textInput.value);
  saveState();
});

textInput.addEventListener('scroll', syncScroll);

textInput.addEventListener('paste', () => {
  setTimeout(() => {
    const file = getActiveFile();
    file.content = textInput.value;
    updateLineNumbers(textInput.value);
    saveState();
  }, 0);
});

textInput.addEventListener('keydown', (e) => {
  if (e.key === 'Tab') {
    e.preventDefault();
    const value = textInput.value;
    const start = textInput.selectionStart;
    const end = textInput.selectionEnd;
    const newValue = value.slice(0, start) + EDITOR_INDENT + value.slice(end);
    textInput.value = newValue;
    const newPos = start + EDITOR_INDENT.length;
    textInput.setSelectionRange(newPos, newPos);
    const file = getActiveFile();
    file.content = newValue;
    updateLineNumbers(newValue);
    saveState();
    return;
  }

  if (e.key !== 'Enter' || e.shiftKey) return;
  const value = textInput.value;
  const start = textInput.selectionStart;
  const end = textInput.selectionEnd;
  if (start !== end) return;

  const lineStart = value.lastIndexOf('\n', start - 1) + 1;
  const lineBeforeCursor = value.substring(lineStart, start);
  if (!/\{[\t ]*$/.test(lineBeforeCursor)) return;

  const leadingMatch = lineBeforeCursor.match(/^[\t ]*/);
  const leadingIndent = leadingMatch ? leadingMatch[0] : '';

  e.preventDefault();
  const insertion = `\n${leadingIndent}${EDITOR_INDENT}`;
  const newValue = value.slice(0, start) + insertion + value.slice(end);
  textInput.value = newValue;
  const newPos = start + insertion.length;
  textInput.setSelectionRange(newPos, newPos);

  const file = getActiveFile();
  file.content = newValue;
  updateLineNumbers(newValue);
  saveState();
});
