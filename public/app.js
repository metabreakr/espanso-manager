/*
 * Espanso Manager
 * Copyright (C) 2026 Jonathan Ruzek
 * SPDX-License-Identifier: GPL-3.0-only
 *
 * This program is free software: you can redistribute it and/or modify it under
 * the terms of the GNU General Public License version 3, as published by the Free
 * Software Foundation. It is distributed WITHOUT ANY WARRANTY; see the LICENSE
 * file or <https://www.gnu.org/licenses/> for details.
 */
const state = {
  snippets: [],
  editingId: null, // null = creating new
  tab: 'simple',
  view: localStorage.getItem('espansoManagerView') || 'grid',
  sort: localStorage.getItem('espansoManagerSort') || 'file',
  sync: null,
  espansoReload: false,
};

// Append a reload note to save/delete confirmations when Espanso is available to reload.
function savedMsg(base) {
  return state.espansoReload ? `${base} · reloading Espanso…` : base;
}

const el = {
  list: document.getElementById('list'),
  emptyState: document.getElementById('emptyState'),
  search: document.getElementById('search'),
  matchFilePath: document.getElementById('matchFilePath'),
  modalBackdrop: document.getElementById('modalBackdrop'),
  modalTitle: document.getElementById('modalTitle'),
  modalError: document.getElementById('modalError'),
  fTrigger: document.getElementById('fTrigger'),
  fReplace: document.getElementById('fReplace'),
  fLabel: document.getElementById('fLabel'),
  fWord: document.getElementById('fWord'),
  fPropagateCase: document.getElementById('fPropagateCase'),
  fRaw: document.getElementById('fRaw'),
  deleteBtn: document.getElementById('deleteBtn'),
  toast: document.getElementById('toast'),
  sortSelect: document.getElementById('sortSelect'),
  viewGridBtn: document.getElementById('viewGridBtn'),
  viewListBtn: document.getElementById('viewListBtn'),
  syncBtn: document.getElementById('syncBtn'),
  syncBackdrop: document.getElementById('syncBackdrop'),
  syncDescription: document.getElementById('syncDescription'),
  syncToggleBtn: document.getElementById('syncToggleBtn'),
  syncBanner: document.getElementById('syncBanner'),
  bannerEnableBtn: document.getElementById('bannerEnableBtn'),
  bannerDismissBtn: document.getElementById('bannerDismissBtn'),
};

async function api(path, opts) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  const body = await res.json();
  if (!body.ok) throw new Error(body.error || 'Request failed');
  return body.data;
}

function showToast(msg, isError) {
  el.toast.textContent = msg;
  el.toast.classList.toggle('error', !!isError);
  el.toast.classList.remove('hidden');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => el.toast.classList.add('hidden'), 2600);
}

function triggerLabel(s) {
  if (s.triggers && s.triggers.length) return s.triggers.join(', ');
  return s.trigger || '(no trigger — advanced match)';
}

function setView(view) {
  state.view = view;
  localStorage.setItem('espansoManagerView', view);
  el.list.classList.toggle('view-list', view === 'list');
  el.viewGridBtn.classList.toggle('active', view === 'grid');
  el.viewListBtn.classList.toggle('active', view === 'list');
}

function setSort(sort) {
  state.sort = sort;
  localStorage.setItem('espansoManagerSort', sort);
  el.sortSelect.value = sort;
  render();
}

// Sort key for name sorting: the trigger (or label), minus any leading punctuation
// like ":" so ":addr" sorts under "a".
function nameKey(s) {
  return triggerLabel(s).toLowerCase().replace(/^[^a-z0-9]+/, '');
}

// Sort a copy of the list for display only. Each snippet keeps its original `id`
// (its position in base.yml), so edit/delete still target the right entry.
// Espanso stores no per-snippet timestamps, so "Recently added" uses file position
// (new snippets are appended to the end of base.yml).
function sortSnippets(list) {
  const arr = [...list];
  switch (state.sort) {
    case 'added':
      return arr.sort((a, b) => b.id - a.id);
    case 'name-asc':
      return arr.sort((a, b) => nameKey(a).localeCompare(nameKey(b)));
    case 'name-desc':
      return arr.sort((a, b) => nameKey(b).localeCompare(nameKey(a)));
    case 'file':
    default:
      return arr.sort((a, b) => a.id - b.id);
  }
}

function render() {
  const q = el.search.value.trim().toLowerCase();
  const filtered = state.snippets.filter((s) => {
    if (!q) return true;
    return (
      triggerLabel(s).toLowerCase().includes(q) ||
      (s.replace || '').toLowerCase().includes(q) ||
      (s.label || '').toLowerCase().includes(q)
    );
  });

  el.list.innerHTML = '';
  el.emptyState.classList.toggle('hidden', state.snippets.length > 0);

  for (const s of sortSnippets(filtered)) {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <div class="card-trigger">${escapeHtml(triggerLabel(s))}</div>
      <div class="card-replace">${escapeHtml(s.replace || '')}</div>
      <div class="card-badges">
        ${s.simple ? '' : '<span class="badge advanced">Advanced</span>'}
        ${s.word ? '<span class="badge">Whole word</span>' : ''}
        ${s.propagate_case ? '<span class="badge">Propagate case</span>' : ''}
        ${s.label ? `<span class="badge">${escapeHtml(s.label)}</span>` : ''}
      </div>
    `;
    card.addEventListener('click', () => openEdit(s));
    el.list.appendChild(card);
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// --- Markdown toolbar helpers (operate on the Replace textarea) ---

// Wrap the current selection with `before`/`after`; if nothing is selected, insert a
// placeholder and select it so the user can type over it.
function surroundSelection(ta, before, after, placeholder) {
  const start = ta.selectionStart;
  const end = ta.selectionEnd;
  const val = ta.value;
  const selected = val.slice(start, end) || placeholder || '';
  ta.value = val.slice(0, start) + before + selected + after + val.slice(end);
  const selStart = start + before.length;
  ta.focus();
  ta.setSelectionRange(selStart, selStart + selected.length);
}

// Prepend `linePrefix` to every line touched by the selection (for headings / lists).
function prefixLines(ta, linePrefix) {
  const start = ta.selectionStart;
  const end = ta.selectionEnd;
  const val = ta.value;
  const lineStart = val.lastIndexOf('\n', start - 1) + 1;
  const before = val.slice(0, lineStart);
  const middle = val.slice(lineStart, end) || '';
  const after = val.slice(end);
  const prefixed = middle.split('\n').map((l) => linePrefix + l).join('\n');
  ta.value = before + prefixed + after;
  ta.focus();
  ta.setSelectionRange(lineStart, lineStart + prefixed.length);
}

function applyMarkdown(kind) {
  const ta = el.fReplace;
  switch (kind) {
    case 'bold': return surroundSelection(ta, '**', '**', 'bold text');
    case 'italic': return surroundSelection(ta, '*', '*', 'italic text');
    case 'strike': return surroundSelection(ta, '~~', '~~', 'strikethrough');
    case 'code': return surroundSelection(ta, '`', '`', 'code');
    case 'link': return surroundSelection(ta, '[', '](https://)', 'link text');
    case 'heading': return prefixLines(ta, '# ');
    case 'list': return prefixLines(ta, '- ');
  }
}

function setTab(tab) {
  state.tab = tab;
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  document.getElementById('tabSimple').classList.toggle('hidden', tab !== 'simple');
  document.getElementById('tabRaw').classList.toggle('hidden', tab !== 'raw');
}

function openCreate() {
  state.editingId = null;
  el.modalTitle.textContent = 'New Snippet';
  el.fTrigger.value = '';
  el.fReplace.value = '';
  el.fLabel.value = '';
  el.fWord.checked = false;
  el.fPropagateCase.checked = false;
  el.fRaw.value = '';
  el.deleteBtn.classList.add('hidden');
  el.modalError.classList.add('hidden');
  setTab('simple');
  el.modalBackdrop.classList.remove('hidden');
}

function openEdit(s) {
  state.editingId = s.id;
  el.modalTitle.textContent = 'Edit Snippet';
  el.fTrigger.value = s.triggers && s.triggers.length ? s.triggers.join(', ') : (s.trigger || '');
  el.fReplace.value = s.replace || '';
  el.fLabel.value = s.label || '';
  el.fWord.checked = !!s.word;
  el.fPropagateCase.checked = !!s.propagate_case;
  el.fRaw.value = s.raw || '';
  el.deleteBtn.classList.remove('hidden');
  el.modalError.classList.add('hidden');
  setTab(s.simple ? 'simple' : 'raw');
  el.modalBackdrop.classList.remove('hidden');
}

function closeModal() {
  el.modalBackdrop.classList.add('hidden');
}

function currentFieldsFromSimpleTab() {
  const triggerRaw = el.fTrigger.value.trim();
  const triggers = triggerRaw.split(',').map((t) => t.trim()).filter(Boolean);
  return {
    trigger: triggers[0],
    triggers: triggers.length > 1 ? triggers : undefined,
    replace: el.fReplace.value,
    label: el.fLabel.value.trim() || undefined,
    word: el.fWord.checked || undefined,
    propagate_case: el.fPropagateCase.checked || undefined,
  };
}

async function save() {
  el.modalError.classList.add('hidden');
  try {
    let body;
    if (state.tab === 'raw') {
      if (!el.fRaw.value.trim()) throw new Error('Raw YAML cannot be empty');
      body = { raw: el.fRaw.value };
    } else {
      const fields = currentFieldsFromSimpleTab();
      if (!fields.trigger) throw new Error('At least one trigger is required');
      if (!fields.replace) throw new Error('Replace text is required');
      body = fields;
    }

    if (state.editingId === null) {
      state.snippets = await api('/api/snippets', { method: 'POST', body: JSON.stringify(body) });
      showToast(savedMsg('Snippet created'));
    } else {
      state.snippets = await api(`/api/snippets/${state.editingId}`, { method: 'PUT', body: JSON.stringify(body) });
      showToast(savedMsg('Snippet saved'));
    }
    closeModal();
    render();
  } catch (err) {
    el.modalError.textContent = err.message;
    el.modalError.classList.remove('hidden');
  }
}

async function remove() {
  if (state.editingId === null) return;
  if (!confirm('Delete this snippet? This cannot be undone.')) return;
  try {
    state.snippets = await api(`/api/snippets/${state.editingId}`, { method: 'DELETE' });
    showToast(savedMsg('Snippet deleted'));
    closeModal();
    render();
  } catch (err) {
    showToast(err.message, true);
  }
}

const BANNER_DISMISSED_KEY = 'espansoManagerSyncBannerDismissed';

function updateSyncUi() {
  const s = state.sync;
  if (!s) return;
  el.syncBtn.classList.toggle('synced', s.linked);
  el.syncBtn.textContent = s.linked ? 'iCloud Synced' : 'iCloud Sync';

  // Show the first-run nudge only when sync is available, currently off, and not dismissed.
  const dismissed = localStorage.getItem(BANNER_DISMISSED_KEY) === '1';
  const showBanner = s.icloudAvailable && !s.linked && !dismissed;
  el.syncBanner.classList.toggle('hidden', !showBanner);
}

async function setSync(enable) {
  state.sync = enable
    ? await api('/api/sync/enable', { method: 'POST' })
    : await api('/api/sync/disable', { method: 'POST' });
  updateSyncUi();
}

function openSyncModal() {
  const s = state.sync;
  if (!s) return;
  if (s.linked) {
    el.syncDescription.innerHTML = `This Mac is syncing snippets via iCloud Drive.<br><br>Real file: <strong>${escapeHtml(s.icloudPath)}</strong><br>Espanso reads it via a symlink at <strong>${escapeHtml(s.localPath)}</strong>.`;
    el.syncToggleBtn.textContent = 'Disable Sync';
  } else if (!s.icloudAvailable) {
    el.syncDescription.innerHTML = `iCloud Drive doesn't seem to be available on this Mac (no <strong>Mobile Documents</strong> folder found). Enable iCloud Drive in System Settings first.`;
    el.syncToggleBtn.classList.add('hidden');
  } else {
    const detail = s.icloudFileExists
      ? `An iCloud copy already exists from another Mac. Enabling sync here will link to it — if this Mac has different local snippets, they'll be backed up first, not lost.`
      : `This will move your snippets file into iCloud Drive and leave a symlink in Espanso's expected location, so it syncs to your other Macs automatically.`;
    el.syncDescription.innerHTML = detail;
    el.syncToggleBtn.textContent = 'Enable Sync';
  }
  el.syncToggleBtn.classList.remove('hidden');
  el.syncBackdrop.classList.remove('hidden');
}

function closeSyncModal() {
  el.syncBackdrop.classList.add('hidden');
}

async function toggleSync() {
  const wasLinked = state.sync.linked;
  try {
    await setSync(!wasLinked);
    showToast(state.sync.linked ? 'iCloud sync enabled' : 'iCloud sync disabled');
    closeSyncModal();
  } catch (err) {
    showToast(err.message, true);
  }
}

async function enableSyncFromBanner() {
  try {
    await setSync(true);
    showToast('iCloud sync enabled');
  } catch (err) {
    showToast(err.message, true);
  }
}

function dismissBanner() {
  localStorage.setItem(BANNER_DISMISSED_KEY, '1');
  el.syncBanner.classList.add('hidden');
}

async function init() {
  document.getElementById('newSnippetBtn').addEventListener('click', openCreate);
  document.getElementById('emptyNewBtn').addEventListener('click', openCreate);
  document.getElementById('modalClose').addEventListener('click', closeModal);
  document.getElementById('cancelBtn').addEventListener('click', closeModal);
  document.getElementById('saveBtn').addEventListener('click', save);
  document.getElementById('deleteBtn').addEventListener('click', remove);
  document.querySelectorAll('.tab-btn').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));
  el.modalBackdrop.addEventListener('click', (e) => { if (e.target === el.modalBackdrop) closeModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeModal(); closeSyncModal(); } });
  el.search.addEventListener('input', render);

  el.viewGridBtn.addEventListener('click', () => setView('grid'));
  el.viewListBtn.addEventListener('click', () => setView('list'));
  setView(state.view);

  el.sortSelect.value = state.sort;
  el.sortSelect.addEventListener('change', (e) => setSort(e.target.value));

  document.getElementById('mdToolbar').addEventListener('mousedown', (e) => {
    const btn = e.target.closest('.md-btn');
    if (!btn) return;
    e.preventDefault(); // keep the textarea's focus + selection
    applyMarkdown(btn.dataset.md);
  });

  el.syncBtn.addEventListener('click', openSyncModal);
  document.getElementById('syncClose').addEventListener('click', closeSyncModal);
  el.syncToggleBtn.addEventListener('click', toggleSync);
  el.syncBackdrop.addEventListener('click', (e) => { if (e.target === el.syncBackdrop) closeSyncModal(); });
  el.bannerEnableBtn.addEventListener('click', enableSyncFromBanner);
  el.bannerDismissBtn.addEventListener('click', dismissBanner);

  // Cmd+Enter (or Ctrl+Enter) saves while the edit modal is open.
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && !el.modalBackdrop.classList.contains('hidden')) {
      e.preventDefault();
      save();
    }
  });

  try {
    const meta = await api('/api/meta');
    el.matchFilePath.textContent = meta.matchFile;
    state.espansoReload = !!meta.espansoReload;
    state.snippets = await api('/api/snippets');
    render();
  } catch (err) {
    showToast('Failed to load snippets: ' + err.message, true);
  }

  try {
    state.sync = await api('/api/sync');
    updateSyncUi();
  } catch (err) {
    showToast('Failed to load sync status: ' + err.message, true);
  }
}

init();
