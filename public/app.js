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
  confirmBackdrop: document.getElementById('confirmBackdrop'),
  confirmTitle: document.getElementById('confirmTitle'),
  confirmMessage: document.getElementById('confirmMessage'),
  confirmOk: document.getElementById('confirmOk'),
  confirmCancel: document.getElementById('confirmCancel'),
  importFile: document.getElementById('importFile'),
  importBackdrop: document.getElementById('importBackdrop'),
  importSummary: document.getElementById('importSummary'),
  importList: document.getElementById('importList'),
  importError: document.getElementById('importError'),
  importConfirm: document.getElementById('importConfirm'),
  bulkBackdrop: document.getElementById('bulkBackdrop'),
  bulkList: document.getElementById('bulkList'),
  bulkConfirm: document.getElementById('bulkConfirm'),
  testBackdrop: document.getElementById('testBackdrop'),
  testInput: document.getElementById('testInput'),
  testPreview: document.getElementById('testPreview'),
  toolsBtn: document.getElementById('toolsBtn'),
  toolsMenu: document.getElementById('toolsMenu'),
  restoreBackdrop: document.getElementById('restoreBackdrop'),
  restoreDesc: document.getElementById('restoreDesc'),
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

// Sort key for name sorting: the title (label) if set, else the trigger, minus any
// leading punctuation like ":" so ":addr" sorts under "a".
function nameKey(s) {
  const base = s.label || triggerLabel(s);
  return base.toLowerCase().replace(/^[^a-z0-9]+/, '');
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
    const hasTitle = !!s.label;
    const heading = hasTitle ? s.label : triggerLabel(s);
    card.innerHTML = `
      <div class="card-head">
        <div class="card-title ${hasTitle ? '' : 'is-trigger'}">${escapeHtml(heading)}</div>
        ${hasTitle ? `<div class="card-trigger-sub">${escapeHtml(triggerLabel(s))}</div>` : ''}
      </div>
      <div class="card-replace">${escapeHtml(s.replace || '')}</div>
      <div class="card-badges">
        ${s.simple ? '' : '<span class="badge advanced">Advanced</span>'}
        ${s.word ? '<span class="badge">Whole word</span>' : ''}
        ${s.propagate_case ? '<span class="badge">Propagate case</span>' : ''}
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

// Themed confirmation dialog. Returns a promise<boolean>. Used instead of the browser's
// confirm(), which WebKit suppresses inside the native app window.
function confirmDialog({ title = 'Confirm', message, okLabel = 'Delete', danger = true } = {}) {
  return new Promise((resolve) => {
    el.confirmTitle.textContent = title;
    el.confirmMessage.textContent = message;
    el.confirmOk.textContent = okLabel;
    el.confirmOk.className = danger ? 'danger' : 'primary';
    el.confirmBackdrop.classList.remove('hidden');
    el.confirmOk.focus();

    const cleanup = () => {
      el.confirmBackdrop.classList.add('hidden');
      el.confirmOk.removeEventListener('click', onOk);
      el.confirmCancel.removeEventListener('click', onCancel);
      el.confirmBackdrop.removeEventListener('click', onBackdrop);
      document.removeEventListener('keydown', onKey, true);
    };
    const done = (result) => { cleanup(); resolve(result); };
    const onOk = () => done(true);
    const onCancel = () => done(false);
    const onBackdrop = (e) => { if (e.target === el.confirmBackdrop) done(false); };
    // Capture phase + stopPropagation so Escape cancels only this dialog, not the editor behind it.
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); done(false); }
      else if (e.key === 'Enter') { e.stopPropagation(); done(true); }
    };
    el.confirmOk.addEventListener('click', onOk);
    el.confirmCancel.addEventListener('click', onCancel);
    el.confirmBackdrop.addEventListener('click', onBackdrop);
    document.addEventListener('keydown', onKey, true);
  });
}

async function remove() {
  if (state.editingId === null) return;
  const ok = await confirmDialog({ message: 'Delete this snippet? This cannot be undone.', okLabel: 'Delete' });
  if (!ok) return;
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

// ---------- CSV import + bulk delete ----------

// Minimal RFC-4180-ish CSV parser: handles quoted fields, embedded newlines, and "" escapes.
function parseCSV(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // strip UTF-8 BOM
  const rows = [];
  let field = '';
  let row = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\r') {
      // ignore; handled by \n
    } else if (c === '\n') {
      row.push(field); rows.push(row); row = []; field = '';
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// TextExpander feature tokens (fill-ins, date/time strftime tokens, clipboard/cursor/key/snippet).
// These don't work as-is in Espanso, so we flag them.
const TE_CODE = /%\d*[A-Za-z]|%\{|%fill|%clipboard|%cursor|%key|%snippet/;
function hasTextExpanderCodes(s) {
  return TE_CODE.test(s || '');
}

function oneLine(s) {
  return (s || '').replace(/\s+/g, ' ').trim().slice(0, 140);
}

function existingTriggerSet() {
  const set = new Set();
  for (const s of state.snippets) {
    if (s.trigger) set.add(s.trigger);
    if (s.triggers) s.triggers.forEach((t) => set.add(t));
  }
  return set;
}

// TextExpander CSV export columns: abbreviation, content, label (no header row).
function rowsToImportItems(rows) {
  const existing = existingTriggerSet();
  const items = [];
  for (let r = 0; r < rows.length; r++) {
    const cols = rows[r];
    const trigger = (cols[0] || '').trim();
    const replace = cols[1] != null ? cols[1] : '';
    const label = (cols[2] || '').trim();
    if (!trigger && !replace.trim()) continue; // blank line
    if (items.length === 0 && /^(abbreviation|shortcut|trigger|abbr)$/i.test(trigger)) continue; // header
    items.push({
      trigger,
      replace,
      label,
      rich: hasTextExpanderCodes(replace),
      duplicate: existing.has(trigger),
      checked: true,
    });
  }
  return items;
}

// Shared multiselect click handler (Cmd/Ctrl toggles one, Shift extends a range).
function multiselectClick(ctx, rerender) {
  return (e) => {
    const rowEl = e.target.closest('[data-idx]');
    if (!rowEl) return;
    const i = Number(rowEl.dataset.idx);
    if (e.shiftKey && ctx.anchor !== null && ctx.anchor < ctx.items.length) {
      const lo = Math.min(ctx.anchor, i);
      const hi = Math.max(ctx.anchor, i);
      const target = ctx.items[ctx.anchor].checked;
      for (let k = lo; k <= hi; k++) ctx.items[k].checked = target;
    } else {
      ctx.items[i].checked = !ctx.items[i].checked;
      ctx.anchor = i;
    }
    rerender();
  };
}

function selectRowHtml(idx, checked, title, sub, badges) {
  return `
    <div class="select-row ${checked ? 'checked' : ''}" data-idx="${idx}">
      <input type="checkbox" class="select-check" ${checked ? 'checked' : ''} tabindex="-1" />
      <div class="select-row-main">
        <div class="select-row-title">${escapeHtml(title)}</div>
        <div class="select-row-sub">${escapeHtml(sub)}</div>
      </div>
      <div class="select-row-badges">${badges}</div>
    </div>`;
}

// ----- Import -----
const importCtx = { items: [], anchor: null };

function renderImportRows() {
  const scroll = el.importList.scrollTop;
  el.importList.innerHTML = importCtx.items.map((it, i) => {
    let badges = '';
    if (it.rich) badges += '<span class="badge warn" title="Uses TextExpander features (fill-ins, date tokens) that will not work as-is in Espanso">TextExpander codes</span>';
    if (it.duplicate) badges += '<span class="badge">Trigger exists</span>';
    return selectRowHtml(i, it.checked, it.trigger || '(no trigger)', oneLine(it.replace), badges);
  }).join('');
  el.importList.scrollTop = scroll;
  const n = importCtx.items.filter((it) => it.checked).length;
  el.importConfirm.textContent = n ? `Import ${n}` : 'Import';
  el.importConfirm.disabled = n === 0;
}

function openImport(items) {
  importCtx.items = items;
  importCtx.anchor = null;
  const rich = items.filter((i) => i.rich).length;
  const dup = items.filter((i) => i.duplicate).length;
  let summary = `Found ${items.length} snippet${items.length === 1 ? '' : 's'}.`;
  if (rich) summary += ` ${rich} contain TextExpander codes (won't work as-is).`;
  if (dup) summary += ` ${dup} match a trigger you already have.`;
  el.importSummary.textContent = summary;
  el.importError.classList.add('hidden');
  renderImportRows();
  el.importBackdrop.classList.remove('hidden');
}

function closeImport() { el.importBackdrop.classList.add('hidden'); }

function handleImportFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const items = rowsToImportItems(parseCSV(String(reader.result)));
      if (!items.length) { showToast('No snippets found in that file', true); return; }
      openImport(items);
    } catch (err) {
      showToast('Could not read that file: ' + err.message, true);
    }
  };
  reader.onerror = () => showToast('Could not read that file', true);
  reader.readAsText(file);
}

async function doImport() {
  const selected = importCtx.items
    .filter((it) => it.checked)
    .map((it) => ({ trigger: it.trigger, replace: it.replace, label: it.label || undefined }));
  if (!selected.length) return;
  try {
    const res = await api('/api/snippets/import', { method: 'POST', body: JSON.stringify({ snippets: selected }) });
    state.snippets = res.snippets;
    closeImport();
    render();
    showToast(savedMsg(`Imported ${res.count} snippet${res.count === 1 ? '' : 's'}`));
  } catch (err) {
    el.importError.textContent = err.message;
    el.importError.classList.remove('hidden');
  }
}

// ----- Bulk delete -----
const bulkCtx = { items: [], anchor: null };

function renderBulkRows() {
  const scroll = el.bulkList.scrollTop;
  el.bulkList.innerHTML = bulkCtx.items.map((it, i) => {
    const badge = it.simple ? '' : '<span class="badge">Advanced</span>';
    return selectRowHtml(i, it.checked, it.title, oneLine(it.replace), badge);
  }).join('');
  el.bulkList.scrollTop = scroll;
  const n = bulkCtx.items.filter((it) => it.checked).length;
  el.bulkConfirm.textContent = n ? `Delete ${n}` : 'Delete';
  el.bulkConfirm.disabled = n === 0;
}

function openBulkDelete() {
  bulkCtx.items = state.snippets.map((s) => ({
    id: s.id,
    title: s.triggers && s.triggers.length ? s.triggers.join(', ') : (s.trigger || '(no trigger)'),
    replace: s.replace,
    simple: s.simple,
    checked: false,
  }));
  bulkCtx.anchor = null;
  renderBulkRows();
  el.bulkBackdrop.classList.remove('hidden');
}

function closeBulkDelete() { el.bulkBackdrop.classList.add('hidden'); }

async function doBulkDelete() {
  const ids = bulkCtx.items.filter((it) => it.checked).map((it) => it.id);
  if (!ids.length) return;
  const ok = await confirmDialog({
    message: `Delete ${ids.length} snippet${ids.length === 1 ? '' : 's'}? This cannot be undone.`,
    okLabel: `Delete ${ids.length}`,
  });
  if (!ok) return;
  try {
    const res = await api('/api/snippets/bulk-delete', { method: 'POST', body: JSON.stringify({ ids }) });
    state.snippets = res.snippets;
    closeBulkDelete();
    render();
    showToast(savedMsg(`Deleted ${res.count} snippet${res.count === 1 ? '' : 's'}`));
  } catch (err) {
    showToast(err.message, true);
  }
}

// ---------- Test snippet (Markdown-aware preview) ----------

// Inline Markdown → HTML. Input is already HTML-escaped, so we only ever inject our own tags.
function inlineMarkdown(s) {
  return s
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
}

// Minimal, safe block-level Markdown renderer (headings, lists, paragraphs, line breaks).
function renderMarkdown(src) {
  const lines = escapeHtml(src).split('\n');
  const out = [];
  let inList = false;
  const closeList = () => { if (inList) { out.push('</ul>'); inList = false; } };
  for (const line of lines) {
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    const listItem = line.match(/^\s*[-*]\s+(.*)$/);
    if (heading) {
      closeList();
      const level = heading[1].length;
      out.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
    } else if (listItem) {
      if (!inList) { out.push('<ul>'); inList = true; }
      out.push(`<li>${inlineMarkdown(listItem[1])}</li>`);
    } else if (line.trim() === '') {
      closeList();
      out.push('<br>');
    } else {
      closeList();
      out.push(`<p>${inlineMarkdown(line)}</p>`);
    }
  }
  closeList();
  return out.join('');
}

function renderTestPreview() {
  el.testPreview.innerHTML = renderMarkdown(el.testInput.value);
}

function openTest() {
  renderTestPreview();
  el.testBackdrop.classList.remove('hidden');
  el.testInput.focus();
}

function closeTest() { el.testBackdrop.classList.add('hidden'); }

// ---------- Tools menu ----------

function closeToolsMenu() {
  el.toolsMenu.classList.add('hidden');
  el.toolsBtn.setAttribute('aria-expanded', 'false');
}
function toggleToolsMenu() {
  const nowHidden = el.toolsMenu.classList.toggle('hidden');
  el.toolsBtn.setAttribute('aria-expanded', String(!nowHidden));
}

// ---------- Restore / move out of iCloud ----------

function openRestore() {
  const s = state.sync;
  if (s && s.linked) {
    el.restoreDesc.innerHTML =
      "This removes the iCloud sync link on <strong>this Mac</strong> and puts a normal " +
      "<strong>base.yml</strong> back in Espanso's folder.<br><br>Your iCloud copy is left " +
      "untouched — other Macs keep working, and you can delete the <strong>Espanso</strong> " +
      "folder in iCloud Drive later to fully remove it.<br><br>What should the local file contain?";
  } else {
    el.restoreDesc.innerHTML =
      "iCloud sync isn't on, so there's nothing to unlink. You can still reset your local " +
      "<strong>base.yml</strong> to Espanso's default file, or keep it as-is.";
  }
  el.restoreBackdrop.classList.remove('hidden');
}

function closeRestore() { el.restoreBackdrop.classList.add('hidden'); }

async function doRestore(useDefault) {
  if (useDefault) {
    const ok = await confirmDialog({
      message: "Replace your local base.yml with Espanso's default file? Your current snippets stay safe in iCloud Drive.",
      okLabel: 'Use default',
    });
    if (!ok) return;
  }
  try {
    state.sync = await api('/api/restore', { method: 'POST', body: JSON.stringify({ useDefault }) });
    state.snippets = await api('/api/snippets');
    updateSyncUi();
    render();
    closeRestore();
    showToast(useDefault ? 'Restored Espanso default (no longer synced)' : 'Snippets moved out of iCloud (no longer synced)');
  } catch (err) {
    showToast(err.message, true);
  }
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
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeModal(); closeSyncModal(); closeImport(); closeBulkDelete(); closeTest(); closeRestore(); closeToolsMenu(); }
  });
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

  // Import (opened from the Tools menu)
  el.importFile.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) handleImportFile(file);
    e.target.value = ''; // allow re-selecting the same file
  });
  el.importList.addEventListener('click', multiselectClick(importCtx, renderImportRows));
  document.getElementById('importClose').addEventListener('click', closeImport);
  document.getElementById('importCancel').addEventListener('click', closeImport);
  el.importConfirm.addEventListener('click', doImport);
  document.getElementById('importAll').addEventListener('click', () => { importCtx.items.forEach((i) => (i.checked = true)); renderImportRows(); });
  document.getElementById('importNone').addEventListener('click', () => { importCtx.items.forEach((i) => (i.checked = false)); renderImportRows(); });
  el.importBackdrop.addEventListener('click', (e) => { if (e.target === el.importBackdrop) closeImport(); });

  // Bulk delete (opened from the Tools menu)
  el.bulkList.addEventListener('click', multiselectClick(bulkCtx, renderBulkRows));
  document.getElementById('bulkClose').addEventListener('click', closeBulkDelete);
  document.getElementById('bulkCancel').addEventListener('click', closeBulkDelete);
  el.bulkConfirm.addEventListener('click', doBulkDelete);
  document.getElementById('bulkAll').addEventListener('click', () => { bulkCtx.items.forEach((i) => (i.checked = true)); renderBulkRows(); });
  document.getElementById('bulkNone').addEventListener('click', () => { bulkCtx.items.forEach((i) => (i.checked = false)); renderBulkRows(); });
  el.bulkBackdrop.addEventListener('click', (e) => { if (e.target === el.bulkBackdrop) closeBulkDelete(); });

  // Test / preview (opened from the Tools menu)
  el.testInput.addEventListener('input', renderTestPreview);
  document.getElementById('testClose').addEventListener('click', closeTest);
  document.getElementById('testDone').addEventListener('click', closeTest);
  document.getElementById('testClear').addEventListener('click', () => { el.testInput.value = ''; renderTestPreview(); el.testInput.focus(); });
  el.testBackdrop.addEventListener('click', (e) => { if (e.target === el.testBackdrop) closeTest(); });

  // Tools menu
  el.toolsBtn.addEventListener('click', toggleToolsMenu);
  el.toolsMenu.addEventListener('click', (e) => {
    const item = e.target.closest('.menu-item');
    if (!item) return;
    closeToolsMenu();
    const action = item.dataset.action;
    if (action === 'test') openTest();
    else if (action === 'import') el.importFile.click();
    else if (action === 'bulk') openBulkDelete();
    else if (action === 'restore') openRestore();
  });
  // Close the menu when clicking anywhere outside it.
  document.addEventListener('click', (e) => { if (!e.target.closest('.menu-wrap')) closeToolsMenu(); });

  // Restore / move out of iCloud
  document.getElementById('restoreClose').addEventListener('click', closeRestore);
  document.getElementById('restoreCancel').addEventListener('click', closeRestore);
  document.getElementById('restoreKeep').addEventListener('click', () => doRestore(false));
  document.getElementById('restoreDefault').addEventListener('click', () => doRestore(true));
  el.restoreBackdrop.addEventListener('click', (e) => { if (e.target === el.restoreBackdrop) closeRestore(); });

  // Cmd+Enter (or Ctrl+Enter) saves while the edit modal is open.
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && !el.modalBackdrop.classList.contains('hidden')) {
      e.preventDefault();
      save();
    }
  });

  try {
    const meta = await api('/api/meta');
    const parts = meta.matchFile.split('/');
    el.matchFilePath.textContent = (parts.length > 3 ? '…/' : '') + parts.slice(-3).join('/');
    el.matchFilePath.title = meta.matchFile;
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
