const match = window.location.pathname.match(/\/room\/(\d+)/);
const ROOM_ID = match ? Number(match[1]) : NaN;
if (!Number.isFinite(ROOM_ID)) {
  window.location.href = '/home';
}

const textInput = document.getElementById('text-input');
const lineNumbers = document.getElementById('line-numbers');
const commentGutter = document.getElementById('comment-gutter');
const highlightPre = document.getElementById('editor-highlight');
const tabsContainer = document.getElementById('tabs');
const tabAddButton = document.getElementById('tab-add');
const roomTitleEl = document.getElementById('room-title');
const roomDescEl = document.getElementById('room-description');
const roomDescHint = document.getElementById('room-desc-hint');
const btnAddComment = document.getElementById('btn-add-comment');
const codeTooltip = document.getElementById('code-tooltip');
const commentPopover = document.getElementById('comment-popover');
const commentSnippet = document.getElementById('comment-snippet');
const commentBodyInput = document.getElementById('comment-body-input');
const commentPopoverLabel = document.getElementById('comment-popover-label');
const commentCtxMenu = document.getElementById('comment-ctx-menu');
const btnRoomSettings = document.getElementById('btn-room-settings');
const btnRoomLeave = document.getElementById('btn-room-leave');

let files = [];
let activeFileId = null;
/** @type {{id:string,file_id:string,start:number,end:number,body:string}[]} */
let comments = [];
let roomOwnerId = null;
let currentUserId = null;

const MAX_FILES = 20;
const EDITOR_INDENT = '    ';
const FILE_PREFIX = 'Файл ';
const HINT_NEED_SELECTION =
  'Выделите фрагмент кода (без пересечения с уже прокомментированным текстом), затем нажмите «Добавить комментарий».';

let saveTimer = null;
let descSaveTimer = null;
let roomPollTimer = null;

/** @type {'add'|'edit'|null} */
let commentPopoverMode = null;
/** @type {string|null} */
let commentPopoverEditId = null;
let commentPopoverAnchorStart = 0;
let commentPopoverAnchorEnd = 0;
let commentPopoverSnippetText = '';

/** @type {string|null} */
let menuCommentId = null;

let saveSelectionRaf = null;

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

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function getLineStarts(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') starts.push(i + 1);
  }
  return starts;
}

function commentsTouchingLine(text, lineIdx, fileId) {
  const starts = getLineStarts(text);
  if (lineIdx < 0 || lineIdx >= starts.length) return [];
  const lineStart = starts[lineIdx];
  const lineEnd = lineIdx + 1 < starts.length ? starts[lineIdx + 1] : text.length;
  return comments.filter(
    (c) =>
      c.file_id === fileId &&
      !(c.end <= lineStart || c.start >= lineEnd)
  );
}

function clampCommentsForActiveFile() {
  const text = textInput.value;
  const len = text.length;
  const fid = activeFileId;
  comments = comments
    .map((c) => {
      if (c.file_id !== fid) return c;
      let s = Math.max(0, Math.min(c.start, len));
      let e = Math.max(0, Math.min(c.end, len));
      if (e < s) [s, e] = [e, s];
      if (e <= s) return null;
      return { ...c, start: s, end: e };
    })
    .filter(Boolean);
}

function isRoomOwner() {
  return currentUserId != null && roomOwnerId === currentUserId;
}

function applyRoomTitleEditable() {
  roomTitleEl.classList.remove('room-title--editable');
  roomTitleEl.title = '';
}

function autoSizeRoomDesc() {
  roomDescEl.style.height = '0px';
  roomDescEl.style.height = `${roomDescEl.scrollHeight}px`;
}

function autoSizeCommentBody() {
  commentBodyInput.style.height = 'auto';
  const maxH = 200;
  commentBodyInput.style.height = `${Math.min(maxH, Math.max(88, commentBodyInput.scrollHeight))}px`;
}

function selectionIntersectsAnyComment(selStart, selEnd) {
  const fid = activeFileId;
  const s = Math.min(selStart, selEnd);
  const e = Math.max(selStart, selEnd);
  if (s === e) return false;
  return comments.some((c) => c.file_id === fid && s < c.end && e > c.start);
}

function scheduleUpdateAddCommentButton() {
  if (saveSelectionRaf != null) cancelAnimationFrame(saveSelectionRaf);
  saveSelectionRaf = requestAnimationFrame(() => {
    saveSelectionRaf = null;
    updateAddCommentButtonState();
  });
}

function updateAddCommentButtonState() {
  const start = textInput.selectionStart;
  const end = textInput.selectionEnd;
  const hasRange = start !== end;
  const bad = !hasRange || selectionIntersectsAnyComment(start, end);
  btnAddComment.disabled = bad;
}

function getCommentAtOffset(off) {
  const fid = activeFileId;
  const hits = comments.filter((c) => c.file_id === fid && off >= c.start && off < c.end);
  if (!hits.length) return null;
  return hits.reduce((a, b) => (b.end - b.start < a.end - a.start ? b : a));
}

function setHotCommentSpan(commentId) {
  highlightPre.querySelectorAll('.hl-comment.hl-comment--hot').forEach((el) => {
    el.classList.remove('hl-comment--hot');
  });
  if (!commentId) return;
  const el = [...highlightPre.querySelectorAll('.hl-comment')].find((node) => node.dataset.commentId === commentId);
  if (el) el.classList.add('hl-comment--hot');
}

function measureOffsetInTextarea(textarea, index) {
  const value = textarea.value;
  const i = Math.max(0, Math.min(index, value.length));
  const div = document.createElement('div');
  const cs = getComputedStyle(textarea);
  const props = [
    'boxSizing',
    'fontFamily',
    'fontSize',
    'fontWeight',
    'fontStyle',
    'letterSpacing',
    'textTransform',
    'lineHeight',
    'paddingTop',
    'paddingRight',
    'paddingBottom',
    'paddingLeft',
    'borderTopWidth',
    'borderRightWidth',
    'borderBottomWidth',
    'borderLeftWidth',
    'whiteSpace',
    'wordWrap',
    'wordBreak',
    'tabSize',
  ];
  div.style.position = 'absolute';
  div.style.visibility = 'hidden';
  div.style.overflow = 'hidden';
  div.style.left = '-9999px';
  div.style.top = '0';
  for (const p of props) {
    div.style[p] = cs[p];
  }
  div.style.width = `${textarea.clientWidth}px`;
  const before = document.createTextNode(value.slice(0, i));
  const mark = document.createElement('span');
  mark.textContent = value[i] || '\u200b';
  div.appendChild(before);
  div.appendChild(mark);
  document.body.appendChild(div);
  const top = mark.offsetTop;
  const left = mark.offsetLeft;
  const height = mark.offsetHeight || parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.25;
  document.body.removeChild(div);
  return { top, left, height };
}

function positionCommentPopover(selStart, selEnd) {
  const ta = textInput;
  const s = Math.min(selStart, selEnd);
  const e = Math.max(selStart, selEnd);
  if (s === e) return;

  const a = measureOffsetInTextarea(ta, s);
  const lastIdx = Math.max(s, e - 1);
  const b = measureOffsetInTextarea(ta, lastIdx);
  const rect = ta.getBoundingClientRect();
  const cs = getComputedStyle(ta);
  const brdL = parseFloat(cs.borderLeftWidth) || 0;
  const brdT = parseFloat(cs.borderTopWidth) || 0;
  const padL = parseFloat(cs.paddingLeft) || 0;
  const padT = parseFloat(cs.paddingTop) || 0;
  const baseLeft = rect.left + brdL + padL;
  const baseTop = rect.top + brdT + padT;
  const boxTop = baseTop + a.top - ta.scrollTop;
  const boxBot = baseTop + b.top + b.height - ta.scrollTop;
  const boxLeft = baseLeft + Math.min(a.left, b.left) - ta.scrollLeft;
  const anchorMidY = (boxTop + boxBot) / 2;

  commentPopover.style.display = 'block';
  const w = commentPopover.offsetWidth;
  const h = commentPopover.offsetHeight;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const margin = 10;
  let left = boxLeft;
  if (left + w + margin > vw) left = vw - w - margin;
  if (left < margin) left = margin;

  let top = anchorMidY > vh / 2 ? boxTop - h - margin : boxBot + margin;
  if (top < margin) top = boxBot + margin;
  if (top + h + margin > vh) top = boxTop - h - margin;
  if (top < margin) top = margin;

  commentPopover.style.left = `${left}px`;
  commentPopover.style.top = `${top}px`;
}

function isCommentPopoverOpen() {
  return commentPopoverMode != null && commentPopover.style.display !== 'none';
}

function commitCommentPopover() {
  const body = commentBodyInput.value;
  const trimmed = body.trim();

  if (commentPopoverMode === 'add') {
    if (trimmed) {
      const id = Date.now().toString(36) + Math.random().toString(16).slice(2);
      const s = Math.min(commentPopoverAnchorStart, commentPopoverAnchorEnd);
      const e = Math.max(commentPopoverAnchorStart, commentPopoverAnchorEnd);
      comments.push({
        id,
        file_id: activeFileId,
        start: s,
        end: e,
        body: trimmed,
      });
      saveState();
    }
  } else if (commentPopoverMode === 'edit' && commentPopoverEditId) {
    const c = comments.find((x) => x.id === commentPopoverEditId);
    if (c) {
      c.body = body;
      saveState();
    }
  }

  commentPopoverMode = null;
  commentPopoverEditId = null;
  commentPopover.style.display = 'none';
  commentBodyInput.value = '';
  refreshEditorDecorations();
}

function cancelCommentPopoverWithoutSave() {
  commentPopoverMode = null;
  commentPopoverEditId = null;
  commentPopover.style.display = 'none';
  commentBodyInput.value = '';
}

function openCommentPopoverAdd() {
  const start = textInput.selectionStart;
  const end = textInput.selectionEnd;
  if (start === end) return;
  if (selectionIntersectsAnyComment(start, end)) return;

  commentPopoverMode = 'add';
  commentPopoverEditId = null;
  commentPopoverAnchorStart = start;
  commentPopoverAnchorEnd = end;
  const s = Math.min(start, end);
  const e = Math.max(start, end);
  commentPopoverSnippetText = textInput.value.slice(s, e);
  commentSnippet.textContent = commentPopoverSnippetText || '\u00a0';
  commentPopoverLabel.textContent = 'Комментарий к выделению';
  commentBodyInput.value = '';
  commentPopover.style.display = 'block';
  autoSizeCommentBody();
  positionCommentPopover(start, end);
  requestAnimationFrame(() => {
    positionCommentPopover(start, end);
    commentBodyInput.focus();
  });
}

function openCommentPopoverEdit(comment) {
  commentPopoverMode = 'edit';
  commentPopoverEditId = comment.id;
  commentPopoverAnchorStart = comment.start;
  commentPopoverAnchorEnd = comment.end;
  commentPopoverSnippetText = textInput.value.slice(comment.start, comment.end);
  commentSnippet.textContent = commentPopoverSnippetText || '\u00a0';
  commentPopoverLabel.textContent = 'Редактирование комментария';
  commentBodyInput.value = comment.body || '';
  commentPopover.style.display = 'block';
  autoSizeCommentBody();
  positionCommentPopover(comment.start, comment.end);
  requestAnimationFrame(() => {
    positionCommentPopover(comment.start, comment.end);
    commentBodyInput.focus();
    commentBodyInput.setSelectionRange(commentBodyInput.value.length, commentBodyInput.value.length);
  });
}

async function loadRoom() {
  const res = await fetch(`/api/rooms/${ROOM_ID}`, { credentials: 'include' });
  if (res.status === 401) {
    window.location.href = '/?next=' + encodeURIComponent(window.location.pathname);
    return;
  }
  if (res.status === 403 || res.status === 404) {
    await showAppAlert('Комната не найдена или нет доступа', { title: 'Нет доступа' });
    window.location.href = '/home';
    return;
  }
  const data = await res.json();
  roomTitleEl.textContent = data.title || `Комната #${data.id}`;
  document.title = `${roomTitleEl.textContent} — Live coding`;
  roomOwnerId = data.owner_id;
  if (btnRoomSettings) {
    const showGear = !!data.is_owner;
    btnRoomSettings.hidden = !showGear;
    btnRoomSettings.style.display = showGear ? 'inline-flex' : 'none';
  }
  if (btnRoomLeave) {
    const showLeave = !data.is_owner;
    btnRoomLeave.hidden = !showLeave;
    btnRoomLeave.style.display = showLeave ? 'inline-flex' : 'none';
  }
  roomDescEl.value = data.description || '';
  const canEditDesc = currentUserId != null && roomOwnerId === currentUserId;
  roomDescEl.disabled = !canEditDesc;
  roomDescHint.textContent = canEditDesc
    ? 'Описание сохраняется автоматически при паузе в наборе.'
    : 'Только владелец комнаты может менять описание.';
  applyRoomTitleEditable();
  requestAnimationFrame(() => autoSizeRoomDesc());

  files = (data.files || []).map((f) => ({
    id: f.id,
    name: f.name,
    content: f.content || '',
  }));
  if (files.length === 0) {
    files.push({
      id: Date.now().toString(36),
      name: 'Файл 1',
      content: '',
    });
  }
  /* При каждом открытии комнаты — всегда первый файл в списке (порядок как с сервера). */
  activeFileId = files[0].id;

  comments = (data.comments || []).map((c) => ({
    id: c.id,
    file_id: c.file_id,
    start: c.start,
    end: c.end,
    body: c.body || '',
  }));
}

function saveState() {
  const file = getActiveFile();
  if (file) file.content = textInput.value;

  const payload = {
    files: files.map((f) => ({
      id: f.id,
      name: f.name,
      content: f.content || '',
    })),
    active_file_id: activeFileId,
    next_file_index: computeNextFileIndexForPayload(),
    comments: comments.map((c) => ({
      id: c.id,
      file_id: c.file_id,
      start: c.start,
      end: c.end,
      body: c.body,
    })),
  };

  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      const res = await fetch(`/api/rooms/${ROOM_ID}/state`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.status === 401) window.location.href = '/';
    } catch (_) {
      /* сеть */
    }
  }, 450);
}

function scheduleDescriptionSave() {
  if (roomOwnerId !== currentUserId) return;
  clearTimeout(descSaveTimer);
  descSaveTimer = setTimeout(async () => {
    try {
      const res = await fetch(`/api/rooms/${ROOM_ID}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: roomDescEl.value }),
      });
      if (res.status === 401) window.location.href = '/';
    } catch (_) {
      /* сеть */
    }
  }, 600);
}

function getActiveFile() {
  return files.find((f) => f.id === activeFileId) || files[0];
}

function updateAddButtonState() {
  const disabled = files.length >= MAX_FILES;
  tabAddButton.disabled = disabled;
  tabAddButton.classList.toggle('tab-add--disabled', disabled);
  tabAddButton.title = disabled ? 'Максимум 20 файлов' : 'Новый файл';
}

function countLinesFromText(text) {
  if (!text) return 1;
  return text.split('\n').length;
}

function rebuildLineNumbers(text) {
  const n = countLinesFromText(text);
  lineNumbers.innerHTML = '';
  for (let i = 1; i <= n; i++) {
    const span = document.createElement('span');
    span.className = 'line-num';
    span.textContent = i;
    lineNumbers.appendChild(span);
  }
}

function rebuildCommentGutter(text) {
  const n = countLinesFromText(text);
  const fid = activeFileId;
  commentGutter.innerHTML = '';
  for (let i = 0; i < n; i++) {
    const div = document.createElement('div');
    div.className = 'comment-gutter-line';
    const list = commentsTouchingLine(text, i, fid);
    if (list.length) {
      div.classList.add('comment-gutter-line--marked');
      div.title = list.map((c) => c.body).join('\n---\n');
    }
    commentGutter.appendChild(div);
  }
}

function updateHighlightPre(text) {
  const fid = activeFileId;
  const list = comments
    .filter((c) => c.file_id === fid)
    .map((c) => ({ ...c }))
    .sort((a, b) => a.start - b.start);
  let html = '';
  let pos = 0;
  for (const c of list) {
    if (c.start > text.length) continue;
    const s = Math.max(pos, Math.min(c.start, text.length));
    const e = Math.max(s, Math.min(c.end, text.length));
    html += escapeHtml(text.slice(pos, s));
    if (e > s) {
      html += `<span class="hl-comment" data-comment-id="${String(c.id).replace(/&/g, '&amp;').replace(/"/g, '&quot;')}" data-start="${s}" data-end="${e}">${escapeHtml(text.slice(s, e))}</span>`;
    }
    pos = Math.max(pos, e);
    if (pos >= text.length) break;
  }
  html += escapeHtml(text.slice(pos));
  highlightPre.innerHTML = html.length ? html : '\u00a0';
}

function refreshEditorDecorations() {
  const text = textInput.value;
  rebuildLineNumbers(text);
  rebuildCommentGutter(text);
  updateHighlightPre(text);
  syncScrollAll();
}

function syncScrollAll() {
  const st = textInput.scrollTop;
  const sl = textInput.scrollLeft;
  lineNumbers.scrollTop = st;
  commentGutter.scrollTop = st;
  highlightPre.scrollTop = st;
  highlightPre.scrollLeft = sl;
}

function hideCodeTooltip() {
  codeTooltip.style.display = 'none';
  codeTooltip.textContent = '';
}

function showCodeTooltip(x, y, text) {
  codeTooltip.textContent = text;
  codeTooltip.style.display = 'block';
  const pad = 8;
  let left = x + pad;
  let top = y + pad;
  const rect = codeTooltip.getBoundingClientRect();
  if (left + rect.width > window.innerWidth) left = window.innerWidth - rect.width - pad;
  if (top + rect.height > window.innerHeight) top = window.innerHeight - rect.height - pad;
  codeTooltip.style.left = `${left}px`;
  codeTooltip.style.top = `${top}px`;
}

function offsetFromPointInTextarea(clientX, clientY) {
  const rect = textInput.getBoundingClientRect();
  const style = getComputedStyle(textInput);
  const lh = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.6;
  const padT = parseFloat(style.paddingTop) || 0;
  const padL = parseFloat(style.paddingLeft) || 0;
  const text = textInput.value;
  const y = clientY - rect.top + textInput.scrollTop - padT;
  const x = clientX - rect.left + textInput.scrollLeft - padL;
  if (y < 0 || x < 0) return -1;
  const lineIdx = Math.floor(y / lh);
  const starts = getLineStarts(text);
  if (lineIdx < 0 || lineIdx >= starts.length) return -1;
  const lineStart = starts[lineIdx];
  const lineEnd = lineIdx + 1 < starts.length ? starts[lineIdx + 1] - 1 : text.length;
  const lineLen = lineEnd - lineStart + 1;
  const fs = parseFloat(style.fontSize) || 14;
  const cw = fs * 0.62;
  const col = Math.max(0, Math.floor(x / cw));
  return lineStart + Math.min(col, Math.max(0, lineLen - 1));
}

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
      const cur = getActiveFile();
      if (cur) cur.content = textInput.value;
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
}

function applyActiveFileContent() {
  const file = getActiveFile();
  textInput.value = file.content || '';
  textInput.scrollTop = 0;
  textInput.scrollLeft = 0;
  refreshEditorDecorations();
  scheduleUpdateAddCommentButton();
}

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
  const file = files.find((f) => f.id === fileId);
  if (!file) return;
  const index = files.indexOf(file);
  startRenameOnTab(tab, file, index + 1);
});

/** Горизонтальная прокрутка вкладок: колесо, тач, перетаскивание; без полосы прокрутки (CSS). */
let tabStripDrag = null;
let tabStripSuppressClick = false;

tabsContainer.addEventListener(
  'wheel',
  (e) => {
    const el = tabsContainer;
    if (el.scrollWidth <= el.clientWidth + 1) return;
    e.preventDefault();
    el.scrollLeft += e.deltaY + e.deltaX;
  },
  { passive: false }
);

tabsContainer.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  if (e.target.closest('.tab-rename-input')) return;
  tabStripDrag = {
    startX: e.clientX,
    startScroll: tabsContainer.scrollLeft,
    moved: false,
  };
  tabsContainer.classList.add('tabs--dragging');
});

document.addEventListener('mousemove', (e) => {
  if (!tabStripDrag) return;
  const dx = e.clientX - tabStripDrag.startX;
  if (Math.abs(dx) > 6) tabStripDrag.moved = true;
  tabsContainer.scrollLeft = tabStripDrag.startScroll - dx;
});

document.addEventListener('mouseup', () => {
  if (!tabStripDrag) return;
  if (tabStripDrag.moved) tabStripSuppressClick = true;
  tabStripDrag = null;
  tabsContainer.classList.remove('tabs--dragging');
});

tabsContainer.addEventListener(
  'click',
  (e) => {
    if (!tabStripSuppressClick) return;
    tabStripSuppressClick = false;
    e.preventDefault();
    e.stopPropagation();
  },
  true
);

function addNewFile() {
  if (files.length >= MAX_FILES) {
    updateAddButtonState();
    return;
  }
  const prev = getActiveFile();
  if (prev) prev.content = textInput.value;

  const newFile = {
    id: Date.now().toString(36) + Math.random().toString(16).slice(2),
    name: nextUniqueDefaultFileName(),
    content: '',
  };
  files.push(newFile);
  activeFileId = newFile.id;
  applyActiveFileContent();
  saveState();
  renderTabs({ renameFileId: newFile.id });
}

tabAddButton.addEventListener('click', () => {
  addNewFile();
});

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

function closeCommentCtxMenu() {
  commentCtxMenu.style.display = 'none';
  menuCommentId = null;
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

function openCommentCtxMenu(x, y, commentId) {
  menuCommentId = commentId;
  commentCtxMenu.style.display = 'block';
  const menuRect = commentCtxMenu.getBoundingClientRect();
  let left = x;
  let top = y;
  if (left + menuRect.width > window.innerWidth) {
    left = window.innerWidth - menuRect.width - 4;
  }
  if (top + menuRect.height > window.innerHeight) {
    top = window.innerHeight - menuRect.height - 4;
  }
  commentCtxMenu.style.left = `${left}px`;
  commentCtxMenu.style.top = `${top}px`;
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
  const file = files.find((f) => f.id === menuForFileId);
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
      const idx = files.findIndex((f) => f.id === file.id);
      if (idx !== -1) {
        comments = comments.filter((c) => c.file_id !== file.id);
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

commentCtxMenu.addEventListener('click', (e) => {
  const btn = e.target.closest('.tab-menu-item');
  if (!btn || !menuCommentId) return;
  const action = btn.dataset.action;
  const c = comments.find((x) => x.id === menuCommentId);
  closeCommentCtxMenu();
  if (!c) return;
  if (action === 'edit-comment') {
    openCommentPopoverEdit(c);
  } else if (action === 'delete-comment') {
    comments = comments.filter((x) => x.id !== c.id);
    saveState();
    refreshEditorDecorations();
  }
});

document.addEventListener('click', (e) => {
  if (tabMenu.style.display !== 'none' && !tabMenu.contains(e.target) && !e.target.closest('.tab')) {
    closeTabMenu();
  }
  if (commentCtxMenu.style.display !== 'none' && !commentCtxMenu.contains(e.target)) {
    closeCommentCtxMenu();
  }
});

document.addEventListener(
  'mousedown',
  (e) => {
    if (!isCommentPopoverOpen()) return;
    if (commentPopover.contains(e.target)) return;
    if (e.target === btnAddComment || btnAddComment.contains(e.target)) return;
    commitCommentPopover();
  },
  true
);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (isCommentPopoverOpen()) {
      e.preventDefault();
      commitCommentPopover();
      return;
    }
    closeTabMenu();
    closeCommentCtxMenu();
    hideCodeTooltip();
  }
});

window.addEventListener('resize', () => {
  if (isCommentPopoverOpen()) {
    positionCommentPopover(commentPopoverAnchorStart, commentPopoverAnchorEnd);
  }
});

textInput.addEventListener('input', () => {
  const file = getActiveFile();
  file.content = textInput.value;
  clampCommentsForActiveFile();
  refreshEditorDecorations();
  saveState();
});

textInput.addEventListener('scroll', syncScrollAll);

textInput.addEventListener('paste', () => {
  setTimeout(() => {
    const file = getActiveFile();
    file.content = textInput.value;
    clampCommentsForActiveFile();
    refreshEditorDecorations();
    saveState();
  }, 0);
});

textInput.addEventListener('mousemove', (e) => {
  const off = offsetFromPointInTextarea(e.clientX, e.clientY);
  if (off < 0) {
    hideCodeTooltip();
    setHotCommentSpan(null);
    return;
  }
  const hit = getCommentAtOffset(off);
  if (hit) {
    showCodeTooltip(e.clientX, e.clientY, hit.body || '');
    setHotCommentSpan(hit.id);
  } else {
    hideCodeTooltip();
    setHotCommentSpan(null);
  }
});

textInput.addEventListener('mouseleave', () => {
  hideCodeTooltip();
  setHotCommentSpan(null);
});

textInput.addEventListener('contextmenu', (e) => {
  const off = offsetFromPointInTextarea(e.clientX, e.clientY);
  if (off < 0) return;
  const c = getCommentAtOffset(off);
  if (!c) return;
  e.preventDefault();
  closeTabMenu();
  openCommentCtxMenu(e.clientX, e.clientY, c.id);
});

textInput.addEventListener('select', scheduleUpdateAddCommentButton);
textInput.addEventListener('keyup', scheduleUpdateAddCommentButton);
textInput.addEventListener('mouseup', scheduleUpdateAddCommentButton);

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
    clampCommentsForActiveFile();
    refreshEditorDecorations();
    saveState();
    scheduleUpdateAddCommentButton();
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
  clampCommentsForActiveFile();
  refreshEditorDecorations();
  saveState();
  scheduleUpdateAddCommentButton();
});

btnAddComment.addEventListener('click', () => {
  if (btnAddComment.disabled) return;
  openCommentPopoverAdd();
});

btnAddComment.addEventListener('mouseenter', (e) => {
  if (!btnAddComment.disabled) return;
  showCodeTooltip(e.clientX, e.clientY, HINT_NEED_SELECTION);
});

btnAddComment.addEventListener('mousemove', (e) => {
  if (!btnAddComment.disabled) return;
  showCodeTooltip(e.clientX, e.clientY, HINT_NEED_SELECTION);
});

btnAddComment.addEventListener('mouseleave', hideCodeTooltip);

commentBodyInput.addEventListener('input', () => {
  autoSizeCommentBody();
  if (isCommentPopoverOpen()) {
    positionCommentPopover(commentPopoverAnchorStart, commentPopoverAnchorEnd);
  }
});

roomDescEl.addEventListener('input', () => {
  autoSizeRoomDesc();
  scheduleDescriptionSave();
});

document.addEventListener('selectionchange', () => {
  if (document.activeElement === textInput) scheduleUpdateAddCommentButton();
});

async function boot() {
  const me = await getMe();
  if (!me || !me.id) {
    window.location.href = '/?next=' + encodeURIComponent(window.location.pathname);
    return;
  }
  currentUserId = me.id;
  await loadRoom();
  renderTabs();
  applyActiveFileContent();
  updateAddCommentButtonState();

  if (btnRoomSettings) {
    btnRoomSettings.addEventListener('click', () => {
      openRoomSettingsModal(ROOM_ID, {
        onDeleted: () => {
          window.location.href = '/home';
        },
        onSaved: async () => {
          await loadRoom();
          renderTabs();
          applyActiveFileContent();
        },
      });
    });
  }

  if (btnRoomLeave) {
    btnRoomLeave.addEventListener('click', async () => {
      const ok = await showAppConfirm({
        title: 'Покинуть комнату',
        message: 'Вы выйдете из комнаты и потеряете к ней доступ, пока вас снова не пригласят.',
        confirmText: 'Выйти',
        cancelText: 'Отмена',
        danger: true,
      });
      if (!ok) return;
      try {
        const res = await fetch(`/api/rooms/${ROOM_ID}/leave`, { method: 'POST', credentials: 'include' });
        if (res.status === 401) {
          window.location.href = '/?next=' + encodeURIComponent(window.location.pathname);
          return;
        }
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          await showAppAlert(typeof j.detail === 'string' ? j.detail : 'Не удалось выйти', { title: 'Ошибка' });
          return;
        }
      } catch (_) {
        await showAppAlert('Не удалось выйти из комнаты', { title: 'Ошибка' });
        return;
      }
      window.location.href = '/home';
    });
  }

  roomPollTimer = setInterval(async () => {
    const res = await fetch(`/api/rooms/${ROOM_ID}`, { credentials: 'include' });
    if (res.status === 404 || res.status === 403) {
      if (roomPollTimer) clearInterval(roomPollTimer);
      window.location.href = '/home?kicked=1';
      return;
    }
    if (!res.ok) return;
    const d = await res.json();
    const nt = d.title || `Комната #${d.id}`;
    if (roomTitleEl.textContent !== nt) {
      roomTitleEl.textContent = nt;
      document.title = `${nt} — Live coding`;
    }
  }, 4000);
}

boot();
