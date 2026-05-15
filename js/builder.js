// © 2026 Artivicolab. All rights reserved. ProxForm — proprietary software. See LICENSE.
// ProxForm — clinician form builder + session host.

const FIELD_TYPES = {
  section:   { label: 'Section header', hasOptions: false, isSection: true },
  pagebreak: { label: 'Page break',     hasOptions: false, isPagebreak: true },
  text:      { label: 'Short text',     hasOptions: false },
  textarea:  { label: 'Long text',      hasOptions: false },
  number:    { label: 'Number',         hasOptions: false },
  date:      { label: 'Date',           hasOptions: false },
  radio:     { label: 'Single choice',  hasOptions: true  },
  checkbox:  { label: 'Multi choice',   hasOptions: true  },
  yesno:     { label: 'Yes / No',       hasOptions: false },
  file:      { label: 'File / photo',   hasOptions: false },
  signature: { label: 'Signature',      hasOptions: false }
};

// Max file size accepted on a file field. Files are base64'd and chunked over
// the data channel — at 8KB per message a 5MB file is ~840 messages, which is
// fine over a healthy connection but a sane ceiling avoids accidental DoS.
const MAX_FILE_SIZE = 5 * 1024 * 1024;
const FILE_CHUNK_SIZE = 8000;

// Phase 2: forms are addressed by an id in the URL (?form=<id>).
// No id → dashboard (list of forms). With id → editor for that form.
let currentFormId = null;

let fields = [];   // [{ id, type, label, required, options?, column? }]
let nextId = 1;
const collapsedFields = new Set();   // ids whose editor body is hidden

// Test-fill mode: when on, preview inputs are interactive so the clinician
// can rehearse the form. Values are local-only — never transmitted.
let previewTestMode = false;
const testAnswers = {};

// Drag-to-reorder lock. Locked by default so a stray mousedown can never
// rearrange a long form. The state is per-browser (UI preference, no PHI).
const REORDER_LOCK_KEY = 'proxform_reorder_locked';
let reorderLocked = true;
try {
  const v = localStorage.getItem(REORDER_LOCK_KEY);
  if (v === '0') reorderLocked = false;
} catch (_) {}

function applyReorderLock() {
  document.body.classList.toggle('reorder-locked', reorderLocked);
  document.querySelectorAll('.field-drag').forEach(h => {
    h.setAttribute('draggable', reorderLocked ? 'false' : 'true');
  });
  const btn = document.getElementById('btn-lock-reorder');
  if (btn) {
    btn.classList.toggle('locked',   reorderLocked);
    btn.classList.toggle('unlocked', !reorderLocked);
    btn.setAttribute('aria-pressed', reorderLocked ? 'true' : 'false');
    btn.textContent = reorderLocked ? '🔒 Reorder locked' : '🔓 Reorder unlocked';
    btn.title = reorderLocked
      ? "Drag-to-reorder is locked so you can't move a field by accident. Click to unlock."
      : 'Drag rows by the ⋮⋮ handle to reorder. Click here to lock again when done.';
  }
}
function toggleReorderLock() {
  reorderLocked = !reorderLocked;
  try { localStorage.setItem(REORDER_LOCK_KEY, reorderLocked ? '1' : '0'); } catch (_) {}
  applyReorderLock();
}

// ── Undo / Redo ───────────────────────────────────────────────────────────
// Stack of structural snapshots (fields array + title + description). Pushed
// before every destructive op so the user can recover from accidental delete,
// drag, duplicate, etc. Text-input edits aren't tracked here — the browser's
// native Cmd+Z inside the input handles those.
const HISTORY_LIMIT = 50;
const undoStack = [];
const redoStack = [];
function snapshotForHistory() {
  return {
    title:       document.getElementById('form-title')?.value || '',
    description: document.getElementById('form-desc')?.value  || '',
    fields:      JSON.parse(JSON.stringify(fields))
  };
}
function pushHistory() {
  undoStack.push(snapshotForHistory());
  if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
  redoStack.length = 0;
  updateUndoButtons();
}
function applyHistorySnapshot(snap) {
  const t = document.getElementById('form-title');
  const d = document.getElementById('form-desc');
  if (t) t.value = snap.title || '';
  if (d) d.value = snap.description || '';
  fields = JSON.parse(JSON.stringify(snap.fields || []));
  let max = 0;
  for (const f of fields) {
    const n = parseInt(String(f.id || '').replace(/^f/, ''), 10);
    if (!isNaN(n) && n > max) max = n;
  }
  nextId = Math.max(nextId, max + 1);
  renderFields();
  saveDraft();
}
function undo() {
  if (!undoStack.length) { toast('Nothing to undo'); return; }
  redoStack.push(snapshotForHistory());
  applyHistorySnapshot(undoStack.pop());
  updateUndoButtons();
  toast('Undone');
}
function redo() {
  if (!redoStack.length) { toast('Nothing to redo'); return; }
  undoStack.push(snapshotForHistory());
  applyHistorySnapshot(redoStack.pop());
  updateUndoButtons();
  toast('Redone');
}
function updateUndoButtons() {
  const u = document.getElementById('btn-undo');
  const r = document.getElementById('btn-redo');
  if (u) u.disabled = undoStack.length === 0;
  if (r) r.disabled = redoStack.length === 0;
}
function isInTextInput(target) {
  if (!target || !target.tagName) return false;
  const tag = target.tagName.toUpperCase();
  if (tag === 'INPUT') {
    const type = (target.getAttribute('type') || 'text').toLowerCase();
    return ['text', 'number', 'date', 'email', 'tel', 'url', 'search', 'password'].indexOf(type) !== -1;
  }
  return tag === 'TEXTAREA' || target.isContentEditable;
}
document.addEventListener('keydown', (e) => {
  const mod = e.metaKey || e.ctrlKey;
  if (!mod) return;
  const key = e.key.toLowerCase();
  if (key === 'z' && !e.shiftKey) {
    if (isInTextInput(e.target)) return;
    e.preventDefault();
    undo();
  } else if ((key === 'z' && e.shiftKey) || key === 'y') {
    if (isInTextInput(e.target)) return;
    e.preventDefault();
    redo();
  }
});

// Drag state for the field-row reorder. Module-level so the document-level
// keydown / dragend listeners see the latest value across re-renders.
let draggedFieldId = null;
function clearDragVisuals() {
  document.querySelectorAll('.field-edit').forEach(el => {
    el.classList.remove('dragging', 'drop-above', 'drop-below');
  });
}
function abortDrag() {
  draggedFieldId = null;
  clearDragVisuals();
}
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && draggedFieldId) abortDrag();
});
document.addEventListener('dragend', abortDrag);

// ── Collapse-state persistence ────────────────────────────────────────────
// Per-form so opening a different form doesn't inherit another form's
// collapsed rows. UI-only state, no PHI — stored in localStorage.
function collapsedStorageKey() {
  return currentFormId ? 'proxform_collapsed_' + currentFormId : null;
}
function loadCollapsedState() {
  collapsedFields.clear();
  const key = collapsedStorageKey();
  if (!key) return;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return;
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) arr.forEach(id => collapsedFields.add(String(id)));
  } catch (_) {}
}
function persistCollapsedState() {
  const key = collapsedStorageKey();
  if (!key) return;
  try {
    if (collapsedFields.size === 0) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify([...collapsedFields]));
  } catch (_) {}
}

let pc = null;
let dc = null;
let answers = {};
let formSent = false;
const filesInProgress = {};
let myNonce = '';
let peerNonce = '';

let saveDraft = () => {};   // replaced after wireup
let storageOk = false;

// ── Form building ─────────────────────────────────────────────────────────

function addField(type) {
  pushHistory();
  const meta = FIELD_TYPES[type];
  const isSection   = !!meta.isSection;
  const isPagebreak = !!meta.isPagebreak;
  fields.push({
    id: `f${nextId++}`,
    type,
    label: '',
    required: false,
    column: 'full',
    options: meta.hasOptions ? ['Option 1', 'Option 2'] : undefined
  });
  if (isSection || isPagebreak) {
    const f = fields[fields.length - 1];
    delete f.required;
    delete f.column;
  }
  renderFields();
  saveDraft();
}

function removeField(id) {
  pushHistory();
  fields = fields.filter(f => f.id !== id);
  if (collapsedFields.delete(id)) persistCollapsedState();
  renderFields();
  saveDraft();
}

function moveField(id, delta) {
  const i = fields.findIndex(f => f.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= fields.length) return;
  pushHistory();
  [fields[i], fields[j]] = [fields[j], fields[i]];
  renderFields();
  saveDraft();
}

// Move the source field to immediately before/after the target field. Used by
// the drag-and-drop reorder handler.
function moveFieldRelative(srcId, targetId, before) {
  if (srcId === targetId) return;
  const srcIdx = fields.findIndex(f => f.id === srcId);
  if (srcIdx < 0) return;
  pushHistory();
  const [item] = fields.splice(srcIdx, 1);
  let targetIdx = fields.findIndex(f => f.id === targetId);
  if (targetIdx < 0) {
    fields.splice(srcIdx, 0, item);
    return;
  }
  if (!before) targetIdx += 1;
  fields.splice(targetIdx, 0, item);
  renderFields();
  saveDraft();
}

// Clone the field at `id` and insert the copy directly after it. The new row
// gets a fresh id and " (copy)" appended to the label so it's obvious which
// is which. Focuses the new row's label input so the user can edit immediately.
function duplicateField(id) {
  const i = fields.findIndex(f => f.id === id);
  if (i < 0) return;
  pushHistory();
  const src = fields[i];
  const copy = JSON.parse(JSON.stringify(src));
  copy.id = 'f' + (nextId++);
  if (copy.label && !/\(copy\)\s*$/i.test(copy.label)) {
    copy.label = copy.label + ' (copy)';
  }
  fields.splice(i + 1, 0, copy);
  renderFields();
  saveDraft();
  // After the new DOM is in place, scroll to and focus the clone.
  setTimeout(() => focusEditorRow(copy.id), 30);
}

function updateField(id, patch) {
  const f = fields.find(x => x.id === id);
  if (!f) return;
  Object.assign(f, patch);
  saveDraft();
  renderPreview();
}

function renderFields() {
  const root = document.getElementById('fields-list');
  if (!fields.length) {
    root.innerHTML = '<p class="empty">No questions yet. Add a section header or a question below.</p>';
    renderPreview();
    return;
  }
  root.innerHTML = fields.map((f, i) => fieldEditor(f, i)).join('');

  // Header click anywhere outside the action buttons toggles collapsed state.
  root.querySelectorAll('.field-edit-head').forEach(head => {
    head.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      const wrapper = head.closest('.field-edit');
      if (!wrapper) return;
      const id = wrapper.dataset.fieldId;
      if (!id) return;
      if (collapsedFields.has(id)) collapsedFields.delete(id);
      else collapsedFields.add(id);
      wrapper.classList.toggle('collapsed', collapsedFields.has(id));
      persistCollapsedState();
    });
  });

  root.querySelectorAll('button[data-act]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const act = btn.dataset.act;
      if (act === 'remove')         removeField(id);
      else if (act === 'up')        moveField(id, -1);
      else if (act === 'down')      moveField(id, +1);
      else if (act === 'duplicate') duplicateField(id);
    });
  });

  // Drag-and-drop reorder. The drag handle is the only draggable element;
  // wrapper rows are drop targets. Up/down buttons stay for keyboard users.
  // When the reorder-lock is on, dragstart is preventDefault'd so nothing moves.
  root.querySelectorAll('.field-drag').forEach(handle => {
    handle.addEventListener('mousedown', (e) => e.stopPropagation());
    handle.addEventListener('click',     (e) => e.stopPropagation());
    handle.addEventListener('dragstart', (e) => {
      if (reorderLocked) { e.preventDefault(); return; }
      const wrapper = handle.closest('.field-edit');
      if (!wrapper) return;
      draggedFieldId = wrapper.dataset.fieldId || handle.dataset.id;
      wrapper.classList.add('dragging');
      try {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', draggedFieldId);
      } catch (_) {}
    });
  });

  root.querySelectorAll('.field-edit').forEach(row => {
    row.addEventListener('dragover', (e) => {
      if (!draggedFieldId || row.dataset.fieldId === draggedFieldId) return;
      e.preventDefault();
      try { e.dataTransfer.dropEffect = 'move'; } catch (_) {}
      const rect = row.getBoundingClientRect();
      const before = e.clientY < rect.top + rect.height / 2;
      root.querySelectorAll('.field-edit').forEach(el => el.classList.remove('drop-above', 'drop-below'));
      row.classList.add(before ? 'drop-above' : 'drop-below');
    });
    row.addEventListener('dragleave', (e) => {
      if (e.target === row) row.classList.remove('drop-above', 'drop-below');
    });
    row.addEventListener('drop', (e) => {
      e.preventDefault();
      const src = draggedFieldId;
      if (!src) return;
      const targetId = row.dataset.fieldId;
      if (!targetId || targetId === src) return;
      const rect = row.getBoundingClientRect();
      const before = e.clientY < rect.top + rect.height / 2;
      moveFieldRelative(src, targetId, before);
    });
  });

  root.querySelectorAll('[data-field-label]').forEach(inp => {
    inp.addEventListener('input', () => updateField(inp.dataset.fieldLabel, { label: inp.value }));
  });
  root.querySelectorAll('[data-field-hint]').forEach(inp => {
    inp.addEventListener('input', () => updateField(inp.dataset.fieldHint, { hint: inp.value }));
  });
  root.querySelectorAll('[data-field-accept]').forEach(sel => {
    sel.addEventListener('change', () => updateField(sel.dataset.fieldAccept, { accept: sel.value }));
  });
  root.querySelectorAll('[data-field-desc]').forEach(ta => {
    ta.addEventListener('input', () => updateField(ta.dataset.fieldDesc, { description: ta.value }));
  });
  root.querySelectorAll('[data-field-default]').forEach(inp => {
    inp.addEventListener('input', () => {
      const f = fields.find(x => x.id === inp.dataset.fieldDefault);
      if (!f) return;
      if (f.type === 'checkbox') {
        const arr = inp.value.split('\n').map(s => s.trim()).filter(Boolean);
        updateField(f.id, { default: arr.length ? arr : '' });
      } else {
        updateField(f.id, { default: inp.value });
      }
    });
  });
  root.querySelectorAll('[data-field-accept]').forEach(sel => {
    sel.addEventListener('change', () => updateField(sel.dataset.fieldAccept, { accept: sel.value }));
  });
  root.querySelectorAll('[data-field-cond-enable]').forEach(cb => {
    cb.addEventListener('change', () => {
      const f = fields.find(x => x.id === cb.dataset.fieldCondEnable);
      if (!f) return;
      if (cb.checked) {
        f.showIf = f.showIf && f.showIf.field ? f.showIf : { field: '', op: 'equals', value: '' };
      } else {
        delete f.showIf;
      }
      saveDraft();
      renderFields();
    });
  });
  root.querySelectorAll('[data-field-cond-parent]').forEach(sel => {
    sel.addEventListener('change', () => {
      const f = fields.find(x => x.id === sel.dataset.fieldCondParent);
      if (!f) return;
      const parent = fields.find(x => x.id === sel.value);
      const defaultOp = parent && parent.type === 'checkbox' ? 'contains' : 'equals';
      f.showIf = { field: sel.value, op: defaultOp, value: '' };
      saveDraft();
      renderFields();
    });
  });
  root.querySelectorAll('[data-field-cond-op]').forEach(sel => {
    sel.addEventListener('change', () => {
      const f = fields.find(x => x.id === sel.dataset.fieldCondOp);
      if (!f || !f.showIf) return;
      f.showIf.op = sel.value;
      saveDraft();
      renderFields();
    });
  });
  root.querySelectorAll('[data-field-cond-value]').forEach(ctrl => {
    ctrl.addEventListener('input',  () => updateCondValue(ctrl));
    ctrl.addEventListener('change', () => updateCondValue(ctrl));
  });
  function updateCondValue(ctrl) {
    const f = fields.find(x => x.id === ctrl.dataset.fieldCondValue);
    if (!f || !f.showIf) return;
    f.showIf.value = ctrl.value;
    saveDraft();
    renderPreview();
  }
  root.querySelectorAll('[data-field-val]').forEach(inp => {
    inp.addEventListener('input', () => {
      const f = fields.find(x => x.id === inp.dataset.id);
      if (!f) return;
      const k = inp.dataset.fieldVal;
      const validation = Object.assign({}, f.validation || {});
      const raw = inp.value.trim();
      if (raw === '') {
        delete validation[k];
      } else if (k === 'pattern') {
        validation[k] = raw;
      } else {
        const n = Number(raw);
        if (!isNaN(n)) validation[k] = n;
      }
      updateField(f.id, { validation });
    });
  });
  root.querySelectorAll('[data-field-req]').forEach(cb => {
    cb.addEventListener('change', () => updateField(cb.dataset.fieldReq, { required: cb.checked }));
  });
  root.querySelectorAll('[data-field-col]').forEach(sel => {
    sel.addEventListener('change', () => updateField(sel.dataset.fieldCol, { column: sel.value }));
  });
  root.querySelectorAll('[data-field-opts]').forEach(ta => {
    ta.addEventListener('input', () => {
      const opts = ta.value.split('\n').map(s => s.trim()).filter(Boolean);
      updateField(ta.dataset.fieldOpts, { options: opts });
    });
  });

  applyReorderLock();
  applyFieldsFilter();
  renderPreview();
}

// Hide field-edit rows whose label or type-name doesn't match the search query.
// Empty query (or no input present) shows everything. Called on render so the
// filter sticks across structural edits.
function applyFieldsFilter(forced) {
  const inp = document.getElementById('fields-search');
  const counter = document.getElementById('fields-search-count');
  const q = String(forced != null ? forced : (inp ? inp.value : '')).trim().toLowerCase();
  const rows = document.querySelectorAll('#fields-list .field-edit');
  let shown = 0;
  rows.forEach(row => {
    if (!q) {
      row.classList.remove('filtered-out');
      shown++;
      return;
    }
    const label = (row.querySelector('[data-field-label]')?.value || '').toLowerCase();
    const type  = (row.querySelector('.field-type')?.textContent || '').toLowerCase();
    const summary = (row.querySelector('.field-summary')?.textContent || '').toLowerCase();
    const match = label.includes(q) || type.includes(q) || summary.includes(q);
    row.classList.toggle('filtered-out', !match);
    if (match) shown++;
  });
  if (counter) {
    if (!q) counter.textContent = '';
    else counter.textContent = shown + ' of ' + rows.length;
  }
}

// Clicking a preview cell jumps to (and expands) the matching editor row.
function focusEditorRow(id) {
  if (!id) return;
  if (collapsedFields.has(id)) {
    collapsedFields.delete(id);
    persistCollapsedState();
  }
  const target = document.querySelector(`.field-edit[data-field-id="${id}"]`);
  if (!target) return;
  target.classList.remove('collapsed');
  target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  target.classList.remove('flash');
  // Force a reflow so re-adding the class restarts the animation.
  void target.offsetWidth;
  target.classList.add('flash');
  setTimeout(() => target.classList.remove('flash'), 1300);
  const labelInput = target.querySelector('[data-field-label]');
  if (labelInput) labelInput.focus({ preventScroll: true });
}

// Mirror the patient's exact view as the clinician edits.
function renderPreview() {
  const titleEl = document.getElementById('preview-title');
  const descEl  = document.getElementById('preview-desc');
  const root    = document.getElementById('form-preview');
  if (!root) return;

  const title = (document.getElementById('form-title')?.value || '').trim();
  const desc  = (document.getElementById('form-desc')?.value  || '').trim();

  if (titleEl) {
    titleEl.textContent = title || 'Untitled form';
    titleEl.classList.toggle('muted', !title);
  }
  if (descEl) {
    descEl.textContent = desc;
    descEl.classList.toggle('hidden', !desc);
  }

  if (!fields.length) {
    root.classList.add('preview-empty');
    root.innerHTML = '<p class="empty">Add a section or question on the left to see a preview here.</p>';
    return;
  }
  root.classList.remove('preview-empty');

  // Test-fill mode flips the preview from a static mirror to an interactive
  // form. Cells stop being click-to-jump-to-editor; inputs accept typing,
  // and values are stored in `testAnswers` so structural edits don't wipe
  // the rehearsal state.
  const frame = root.closest('.preview-frame');
  if (frame) frame.classList.toggle('test-mode', previewTestMode);

  // Inline the row-pairing loop here so each cell/section can carry its
  // own data-field-id and a clickable class. The patient view (fill.html)
  // uses ProxRender directly and stays plain.
  const snap = buildFormSnapshot();
  let html = '';
  let row = [];
  const flushRow = () => {
    if (row.length) html += `<div class="intake-row">${row.join('')}</div>`;
    row = [];
  };
  const extraClass = previewTestMode ? '' : 'preview-clickable';
  const extraAttrs = previewTestMode ? '' : ' tabindex="0"';
  const renderKey = previewTestMode ? 'preview-test' : 'preview';
  const capacity = (c) => c === 'half' ? 2 : c === 'third' ? 3 : c === 'quarter' ? 4 : 1;
  let qNum = 0;
  let rowCap = 0;
  const flushRowReset = () => { flushRow(); rowCap = 0; };
  for (const f of snap.fields) {
    if (f.type === 'section') {
      flushRowReset();
      const desc = f.description ? `<div class="intake-section-desc">${escapeHtml(f.description)}</div>` : '';
      html += `<div class="intake-section ${extraClass}" data-field-id="${f.id}">${escapeHtml(f.label || '(untitled section)')}${desc}</div>`;
      continue;
    }
    if (f.type === 'pagebreak') {
      flushRowReset();
      const lbl = f.label ? `<span class="intake-pagebreak-label">${escapeHtml(f.label)}</span>` : '';
      html += `<div class="intake-pagebreak ${extraClass}" data-field-id="${f.id}">⤵ Page break${lbl}</div>`;
      continue;
    }
    qNum += 1;
    const cellHtml = ProxRender.fieldCell(f, {
      disabled: !previewTestMode,
      key: renderKey,
      qNum: snap.numbered ? qNum : null
    }).replace('<div class="intake-cell ', `<div class="intake-cell ${extraClass}" data-field-id="${f.id}"${extraAttrs} `);
    const cap = capacity(f.column);
    if (cap === 1) {
      flushRowReset();
      html += `<div class="intake-row">${cellHtml}</div>`;
    } else {
      if (rowCap && rowCap !== cap) flushRowReset();
      row.push(cellHtml);
      rowCap = cap;
      if (row.length === cap) flushRowReset();
    }
  }
  flushRowReset();
  root.innerHTML = html;

  if (previewTestMode) {
    root.querySelectorAll('[data-field]').forEach(input => {
      input.addEventListener('input', () => collectTestField(input));
      input.addEventListener('change', () => collectTestField(input));
    });
    // Wire signature pads to the shared ProxSig widget so they draw the same
    // way the patient's view does. Strokes update testAnswers and re-run the
    // conditional visibility pass.
    if (typeof ProxSig !== 'undefined') {
      root.querySelectorAll('.signature-pad').forEach(pad => {
        ProxSig.attach(pad, {
          getExistingData: (id) => testAnswers[id],
          onStroke: (id, answer) => {
            testAnswers[id] = answer;
            if (typeof ProxCond !== 'undefined') {
              ProxCond.applyVisibility(root, buildFormSnapshot().fields, testAnswers);
            }
          }
        });
      });
      root.querySelectorAll('[data-signature-clear]').forEach(btn => {
        btn.addEventListener('click', () => {
          const id = btn.dataset.signatureClear;
          const pad = root.querySelector(`.signature-pad[data-signature="${id}"]`);
          ProxSig.clear(pad);
          delete testAnswers[id];
          if (typeof ProxCond !== 'undefined') {
            ProxCond.applyVisibility(root, buildFormSnapshot().fields, testAnswers);
          }
        });
      });
    }
    applyTestAnswers();
    if (typeof ProxCond !== 'undefined') {
      ProxCond.applyVisibility(root, snap.fields, testAnswers);
    }
  }
}

// Collect a single input's value into the testAnswers map. Mirrors the
// patient-side logic in fill.js so the values stored match exactly what
// would be sent over the wire in a real session.
function collectTestField(input) {
  const id = input.dataset.field;
  const type = input.dataset.type;
  if (type === 'checkbox') {
    const boxes = document.querySelectorAll(`#form-preview [data-field="${id}"][data-type="checkbox"]`);
    testAnswers[id] = Array.from(boxes).filter(b => b.checked).map(b => b.value);
  } else if (type === 'yesno') {
    const picked = document.querySelector(`#form-preview [data-field="${id}"][data-type="yesno"]:checked`);
    testAnswers[id] = picked ? (picked.value === 'yes') : null;
  } else if (type === 'radio') {
    const picked = document.querySelector(`#form-preview [data-field="${id}"][data-type="radio"]:checked`);
    testAnswers[id] = picked ? picked.value : '';
  } else if (type === 'number') {
    testAnswers[id] = input.value === '' ? null : Number(input.value);
  } else if (type === 'file') {
    const file = input.files && input.files[0];
    if (!file) { delete testAnswers[id]; }
    else { testAnswers[id] = { name: file.name, mime: file.type || '', size: file.size, data: '' }; }
  } else if (type === 'signature') {
    // Canvas has no .value; in test-fill we just record that the pad has
    // been touched so conditional logic can see "notEmpty" fire.
    testAnswers[id] = { name: 'signature.png', mime: 'image/png', size: 0, data: '' };
  } else {
    testAnswers[id] = input.value;
  }
  if (typeof ProxCond !== 'undefined') {
    const root = document.getElementById('form-preview');
    ProxCond.applyVisibility(root, buildFormSnapshot().fields, testAnswers);
  }
}

// Re-apply test answers to the freshly-rendered preview inputs so structural
// edits (adding a field, fixing a typo) don't wipe the rehearsal in progress.
function applyTestAnswers() {
  for (const [id, v] of Object.entries(testAnswers)) {
    if (v == null) continue;
    const inputs = document.querySelectorAll(`#form-preview [data-field="${id}"]`);
    if (!inputs.length) continue;
    const type = inputs[0].dataset.type;
    if (type === 'checkbox') {
      const set = new Set(Array.isArray(v) ? v : []);
      inputs.forEach(b => { b.checked = set.has(b.value); });
    } else if (type === 'yesno') {
      const want = v === true ? 'yes' : v === false ? 'no' : null;
      inputs.forEach(r => { r.checked = r.value === want; });
    } else if (type === 'radio') {
      inputs.forEach(r => { r.checked = r.value === String(v); });
    } else {
      inputs.forEach(i => { i.value = String(v); });
    }
  }
}

function setTestFillMode(on) {
  previewTestMode = !!on;
  if (!previewTestMode) {
    // Leaving test mode wipes any state on the inputs at render time, but
    // we keep testAnswers in memory so toggling back picks up where you
    // left off. The explicit Reset button is the way to wipe.
  }
  const btn = document.getElementById('btn-test-fill');
  if (btn) {
    btn.textContent = previewTestMode ? 'Stop testing' : 'Test fill';
    btn.classList.toggle('active', previewTestMode);
  }
  const reset = document.getElementById('btn-test-reset');
  if (reset) reset.classList.toggle('hidden', !previewTestMode);
  renderPreview();
}

function resetTestAnswers() {
  for (const k of Object.keys(testAnswers)) delete testAnswers[k];
  renderPreview();
  toast('Test answers cleared');
}

function fieldEditor(f, i) {
  const meta = FIELD_TYPES[f.type];
  const isSection   = !!meta.isSection;
  const isPagebreak = !!meta.isPagebreak;
  const isStructural = isSection || isPagebreak;
  const typeLabel = meta.label;

  const optsHtml = meta.hasOptions ? `
    <label class="sub">
      <span>Options (one per line)</span>
      <textarea data-field-opts="${f.id}" rows="3">${escapeHtml((f.options || []).join('\n'))}</textarea>
    </label>
  ` : '';

  const hintHtml = isStructural ? '' : `
    <label class="sub">
      <span>Help text <span class="muted">(optional)</span></span>
      <input type="text" data-field-hint="${f.id}" value="${escapeHtml(f.hint || '')}" placeholder="Shown under the question — e.g. &quot;No spaces or dashes&quot;">
    </label>
  `;

  const acceptVal = f.accept || (f.type === 'file' ? 'image/*' : '');
  const acceptHtml = f.type !== 'file' ? '' : `
    <label class="sub inline">
      <span>Accept</span>
      <select data-field-accept="${f.id}">
        <option value="image/*"${acceptVal === 'image/*' ? ' selected' : ''}>Images only (camera-friendly)</option>
        <option value=".pdf,application/pdf"${acceptVal === '.pdf,application/pdf' ? ' selected' : ''}>PDFs only</option>
        <option value="image/*,.pdf,application/pdf"${acceptVal === 'image/*,.pdf,application/pdf' ? ' selected' : ''}>Images or PDFs</option>
        <option value="*/*"${acceptVal === '*/*' ? ' selected' : ''}>Any file</option>
      </select>
    </label>
    <p class="muted small">Max 5 MB per file. The patient's browser can pick from disk or snap a photo on phone.</p>
  `;

  // Default-value editor. Checkbox stores an array; everything else a string.
  // The editor input shows the array joined by newlines so the user can edit it.
  const defaultDisplay = Array.isArray(f.default) ? f.default.join('\n') : (f.default || '');
  const defaultPlaceholder = {
    text:     'Pre-filled answer',
    textarea: 'Pre-filled answer',
    number:   'e.g. 0',
    date:     'YYYY-MM-DD',
    radio:    'Must exactly match one of the options above',
    yesno:    'yes or no',
    checkbox: 'One pre-selected value per line'
  }[f.type] || 'Pre-filled answer';
  const defaultHtml = isStructural || f.type === 'file' ? '' : (f.type === 'checkbox'
    ? `
      <label class="sub">
        <span>Default value <span class="muted">(optional)</span></span>
        <textarea data-field-default="${f.id}" rows="2" placeholder="${defaultPlaceholder}">${escapeHtml(defaultDisplay)}</textarea>
      </label>
    `
    : `
      <label class="sub">
        <span>Default value <span class="muted">(optional)</span></span>
        <input type="text" data-field-default="${f.id}" value="${escapeHtml(defaultDisplay)}" placeholder="${defaultPlaceholder}">
      </label>
    `);

  const sectionDescHtml = !isSection ? '' : `
    <label class="sub">
      <span>Description <span class="muted">(optional)</span></span>
      <textarea data-field-desc="${f.id}" rows="2" placeholder="Shown under the section title — e.g. &quot;Please answer to the best of your knowledge.&quot;">${escapeHtml(f.description || '')}</textarea>
    </label>
  `;

  // Validation row — only the rules relevant to the field type are surfaced.
  const v = f.validation || {};
  let validationFields = '';
  if (f.type === 'number') {
    validationFields = `
      <label class="sub inline">
        <span>Min</span>
        <input type="number" data-field-val="min" data-id="${f.id}" value="${v.min != null ? escapeHtml(v.min) : ''}" placeholder="any">
      </label>
      <label class="sub inline">
        <span>Max</span>
        <input type="number" data-field-val="max" data-id="${f.id}" value="${v.max != null ? escapeHtml(v.max) : ''}" placeholder="any">
      </label>
    `;
  } else if (f.type === 'text' || f.type === 'textarea') {
    validationFields = `
      <label class="sub inline">
        <span>Min length</span>
        <input type="number" min="0" data-field-val="minlen" data-id="${f.id}" value="${v.minlen != null ? escapeHtml(v.minlen) : ''}" placeholder="0">
      </label>
      <label class="sub inline">
        <span>Max length</span>
        <input type="number" min="0" data-field-val="maxlen" data-id="${f.id}" value="${v.maxlen != null ? escapeHtml(v.maxlen) : ''}" placeholder="∞">
      </label>
      ${f.type === 'text' ? `
        <label class="sub inline grow">
          <span>Pattern <span class="muted">(regex, no slashes)</span></span>
          <input type="text" data-field-val="pattern" data-id="${f.id}" value="${escapeHtml(v.pattern || '')}" placeholder="e.g. ^BE\\d{10}$">
        </label>
      ` : ''}
    `;
  } else if (f.type === 'file' || f.type === 'signature') {
    const isFile = f.type === 'file';
    const wantsImage = isFile && (!f.accept || f.accept === 'image/*' || (f.accept || '').startsWith('image/'));
    validationFields = `
      <label class="sub inline">
        <span>Max size <span class="muted">(MB)</span></span>
        <input type="number" min="0" step="0.5" data-field-val="maxsize" data-id="${f.id}" value="${v.maxsize != null ? escapeHtml(v.maxsize) : ''}" placeholder="5">
      </label>
      ${wantsImage ? `
        <label class="sub inline">
          <span>Min width <span class="muted">(px)</span></span>
          <input type="number" min="0" step="1" data-field-val="minwidth" data-id="${f.id}" value="${v.minwidth != null ? escapeHtml(v.minwidth) : ''}" placeholder="any">
        </label>
        <label class="sub inline">
          <span>Max width <span class="muted">(px)</span></span>
          <input type="number" min="0" step="1" data-field-val="maxwidth" data-id="${f.id}" value="${v.maxwidth != null ? escapeHtml(v.maxwidth) : ''}" placeholder="any">
        </label>
        <label class="sub inline">
          <span>Min height <span class="muted">(px)</span></span>
          <input type="number" min="0" step="1" data-field-val="minheight" data-id="${f.id}" value="${v.minheight != null ? escapeHtml(v.minheight) : ''}" placeholder="any">
        </label>
        <label class="sub inline">
          <span>Max height <span class="muted">(px)</span></span>
          <input type="number" min="0" step="1" data-field-val="maxheight" data-id="${f.id}" value="${v.maxheight != null ? escapeHtml(v.maxheight) : ''}" placeholder="any">
        </label>
      ` : ''}
    `;
  }
  const validationHtml = (isStructural || !validationFields) ? '' : `
    <div class="field-validation">
      <span class="sub-label">Validation <span class="muted">(optional)</span></span>
      <div class="field-validation-row">${validationFields}</div>
    </div>
  `;

  // Conditional logic editor — show/hide this field based on another's answer.
  // The parent dropdown lists every other non-section field; the operator and
  // value controls change shape based on the parent's type.
  const showIf = f.showIf || {};
  const candidates = fields.filter(x => x.type !== 'section' && x.id !== f.id);
  const parent = candidates.find(x => x.id === showIf.field);
  const parentOps = (() => {
    if (!parent) return [];
    if (parent.type === 'yesno' || parent.type === 'radio') return ['equals', 'notEquals'];
    if (parent.type === 'checkbox') return ['contains', 'notContains'];
    return ['equals', 'notEquals', 'notEmpty', 'empty'];
  })();
  const opLabel = { equals: 'equals', notEquals: 'does not equal', contains: 'contains', notContains: 'does not contain', notEmpty: 'is filled in', empty: 'is empty' };
  const showValueCtrl = !!parent && showIf.op !== 'notEmpty' && showIf.op !== 'empty';
  let valueCtrl = '';
  if (showValueCtrl) {
    if (parent.type === 'yesno') {
      valueCtrl = `
        <select data-field-cond-value="${f.id}">
          <option value="yes"${showIf.value === 'yes' ? ' selected' : ''}>Yes</option>
          <option value="no"${showIf.value === 'no' ? ' selected' : ''}>No</option>
        </select>`;
    } else if (parent.type === 'radio' || parent.type === 'checkbox') {
      const opts = Array.isArray(parent.options) ? parent.options : [];
      valueCtrl = `
        <select data-field-cond-value="${f.id}">
          ${opts.map(o => `<option value="${escapeHtml(o)}"${showIf.value === String(o) ? ' selected' : ''}>${escapeHtml(o)}</option>`).join('')}
        </select>`;
    } else {
      valueCtrl = `<input type="text" data-field-cond-value="${f.id}" value="${escapeHtml(showIf.value || '')}" placeholder="answer text">`;
    }
  }
  const conditionalHtml = isStructural ? '' : `
    <div class="field-conditional">
      <label class="sub inline">
        <input type="checkbox" data-field-cond-enable="${f.id}" ${showIf.field ? 'checked' : ''}>
        <span>Show this field <em>only if</em> another field has a specific answer</span>
      </label>
      ${showIf.field ? `
        <div class="field-conditional-row">
          <label class="sub inline">
            <span>If</span>
            <select data-field-cond-parent="${f.id}">
              <option value="">— pick a field —</option>
              ${candidates.map(c => `<option value="${escapeHtml(c.id)}"${c.id === showIf.field ? ' selected' : ''}>${escapeHtml((c.label || '').trim() || '(untitled)')}</option>`).join('')}
            </select>
          </label>
          ${parent ? `
            <label class="sub inline">
              <span>&nbsp;</span>
              <select data-field-cond-op="${f.id}">
                ${parentOps.map(o => `<option value="${o}"${o === showIf.op ? ' selected' : ''}>${opLabel[o]}</option>`).join('')}
              </select>
            </label>
            ${valueCtrl ? `<label class="sub inline grow"><span>&nbsp;</span>${valueCtrl}</label>` : ''}
          ` : ''}
        </div>
      ` : ''}
    </div>
  `;

  const col = ['half', 'third', 'quarter'].includes(f.column) ? f.column : 'full';
  const flagsHtml = isStructural ? '' : `
    <div class="field-flags">
      <label class="sub inline">
        <input type="checkbox" data-field-req="${f.id}" ${f.required ? 'checked' : ''}>
        <span>Required</span>
      </label>
      <label class="sub inline" title="How wide this field is. Consecutive same-width fields share a row.">
        <span>Width</span>
        <select data-field-col="${f.id}">
          <option value="full"${col === 'full' ? ' selected' : ''}>Full row</option>
          <option value="half"${col === 'half' ? ' selected' : ''}>Half (2 per row)</option>
          <option value="third"${col === 'third' ? ' selected' : ''}>Third (3 per row)</option>
          <option value="quarter"${col === 'quarter' ? ' selected' : ''}>Quarter (4 per row)</option>
        </select>
      </label>
    </div>
  `;

  const labelPlaceholder = isPagebreak
    ? 'Optional page name (e.g. "Step 2: Medical history")'
    : (isSection ? 'Section title (e.g. Patient Information)' : 'Type the question…');

  const isCollapsed = collapsedFields.has(f.id);
  const summaryText = (f.label && f.label.trim())
    ? f.label.trim()
    : (isPagebreak ? '(page break)' : (isSection ? '(untitled section)' : '(untitled question)'));
  const reqStar = f.required ? ' *' : '';

  return `
    <div class="field-edit ${isSection ? 'is-section' : ''}${isPagebreak ? ' is-pagebreak' : ''}${isCollapsed ? ' collapsed' : ''}" data-field-id="${f.id}">
      <div class="field-edit-head" title="Click to expand/collapse">
        <button class="field-drag" type="button" draggable="true" data-id="${f.id}" aria-label="Drag to reorder" title="Drag to reorder. Press Esc — or drop outside the list — to cancel.">⋮⋮</button>
        <span class="field-toggle" aria-hidden="true">▾</span>
        <span class="field-type">${typeLabel}</span>
        <span class="field-summary">${escapeHtml(summaryText)}${reqStar}</span>
        <div class="field-edit-actions">
          <button class="icon-btn" data-act="up"        data-id="${f.id}" ${i === 0 ? 'disabled' : ''}                 aria-label="Move up"   title="Move up">↑</button>
          <button class="icon-btn" data-act="down"      data-id="${f.id}" ${i === fields.length - 1 ? 'disabled' : ''} aria-label="Move down" title="Move down">↓</button>
          <button class="icon-btn" data-act="duplicate" data-id="${f.id}"                                              aria-label="Duplicate" title="Duplicate this field">⧉</button>
          <button class="icon-btn" data-act="remove"    data-id="${f.id}"                                              aria-label="Remove"    title="Remove">✕</button>
        </div>
      </div>
      <div class="field-edit-body">
        <label class="sub">
          <span>${isPagebreak ? 'Page name (optional)' : (isSection ? 'Section title' : 'Question')}</span>
          <input type="text" data-field-label="${f.id}" value="${escapeHtml(f.label)}" placeholder="${labelPlaceholder}">
        </label>
        ${sectionDescHtml}
        ${hintHtml}
        ${acceptHtml}
        ${optsHtml}
        ${defaultHtml}
        ${validationHtml}
        ${conditionalHtml}
        ${flagsHtml}
      </div>
    </div>
  `;
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ── Draft persistence ─────────────────────────────────────────────────────

async function initStorage() {
  const status = await ProxStore.checkStorage();
  if (!status.ok) {
    toast('Drafts disabled: this browser has no IndexedDB. Refreshing will lose your work.');
    storageOk = false;
    return;
  }
  storageOk = true;
  await ProxStore.requestPersistence();
  if (status.lowSpace) {
    toast('Low disk space — drafts may be evicted. Free up space if you can.');
  }
}

// Loads a form by id from the dashboard library and applies it to the editor.
// Returns false if the id can't be found (so the caller can redirect).
async function loadForm(id) {
  if (!storageOk) return false;
  let record;
  try { record = await ProxStore.getForm(id); } catch (_) { return false; }
  if (!record) return false;
  document.getElementById('form-title').value = record.title || '';
  document.getElementById('form-desc').value  = record.description || '';
  const numEl = document.getElementById('form-numbered');
  if (numEl) numEl.checked = !!record.numbered;
  fields = Array.isArray(record.fields) ? record.fields : [];
  let max = 0;
  for (const f of fields) {
    const n = parseInt(String(f.id || '').replace(/^f/, ''), 10);
    if (!isNaN(n) && n > max) max = n;
  }
  nextId = max + 1;
  renderFields();
  return true;
}

function snapshotDraft() {
  return {
    title:       document.getElementById('form-title').value,
    description: document.getElementById('form-desc').value,
    fields
  };
}

// Save indicator: shows whether a pending or in-flight persist is happening.
// State lives on the document so re-renders don't reset it.
const saveState = { dirty: false, inFlight: false, error: false };
function markDirty() {
  saveState.dirty = true;
  saveState.error = false;
  updateSaveIndicator();
}
function updateSaveIndicator() {
  const el = document.getElementById('save-indicator');
  if (!el) return;
  if (!storageOk) {
    el.innerHTML = '⚠ Drafts off';
    el.className = 'save-indicator save-error';
    el.title = 'IndexedDB is unavailable in this browser — changes will be lost on refresh.';
    return;
  }
  if (saveState.error) {
    el.innerHTML = '⚠ Save failed';
    el.className = 'save-indicator save-error';
    el.title = 'Could not write the draft. Free up disk space and try editing again.';
    return;
  }
  if (saveState.dirty || saveState.inFlight) {
    el.innerHTML = 'Saving<span class="save-dots" aria-hidden="true"><span></span><span></span><span></span></span>';
    el.className = 'save-indicator save-pending';
    el.title = 'Draft is being written to this browser. Never sent to a server.';
    return;
  }
  el.innerHTML = '✓ Saved';
  el.className = 'save-indicator save-clean';
  el.title = 'Drafts are saved in this browser only — never on a server.';
}

async function persistDraft() {
  if (!storageOk || !currentFormId) return;
  saveState.dirty = false;
  saveState.inFlight = true;
  updateSaveIndicator();
  try {
    await ProxStore.saveForm(currentFormId, snapshotDraft());
    saveState.error = false;
  } catch (_) {
    saveState.error = true;
  } finally {
    saveState.inFlight = false;
    updateSaveIndicator();
  }
}

// "Clear draft" wipes the editor *contents* of the active form (title, desc,
// fields) without deleting the form itself. To remove a form entirely, use the
// Delete button on the dashboard.
async function clearDraft() {
  pushHistory();
  fields = [];
  nextId = 1;
  collapsedFields.clear();
  persistCollapsedState();
  document.getElementById('form-title').value = '';
  document.getElementById('form-desc').value = '';
  renderFields();
  await persistDraft();
  toast('Form cleared');
}

// ── Session host ──────────────────────────────────────────────────────────

async function generateLink() {
  const title = document.getElementById('form-title').value.trim();
  if (!title) { toast('Give the form a title first'); return; }
  const inputFields = fields.filter(f => f.type !== 'section');
  if (!inputFields.length) { toast('Add at least one question'); return; }
  for (const f of fields) {
    if (!f.label.trim()) { toast(f.type === 'section' ? 'Every section needs a title' : 'Every question needs a label'); return; }
  }

  setStatus('Setting up…');
  const fillUrlBase = location.origin + '/fill.html';
  const session = await createSession({ fillUrlBase });

  pc = session.pc;
  dc = session.channel;
  setupChannel(dc);

  document.getElementById('invite-url').value  = session.url;
  document.getElementById('invite-pass').value = session.passphrase;
  go('step-share');
  setStatus('Waiting for patient');

  navigator.clipboard?.writeText(session.url).then(
    () => toast('Link copied — send it, then the passphrase separately'),
    () => {}
  );
}

async function connect() {
  const raw = document.getElementById('reply-paste').value.trim();
  if (!raw) { toast('Paste the reply link from your patient first'); return; }
  let encoded = raw;
  if (raw.includes('#answer=')) encoded = raw.split('#answer=')[1];
  else if (raw.includes('answer=')) encoded = raw.split('answer=')[1];
  encoded = encoded.split('&')[0];

  setStatus('Connecting…');
  try {
    const passphrase = document.getElementById('invite-pass').value;
    await completeSession({ pc, encryptedAnswer: encoded, passphrase });
  } catch (_) {
    toast('Could not decrypt the reply — passphrase mismatch or wrong link');
    setStatus('Waiting for patient');
  }
}

function setupChannel(channel) {
  myNonce = genNonce();

  channel.addEventListener('open', () => {
    setStatus('Connected');
    channel.send(JSON.stringify({
      type: 'form',
      nonce: myNonce,
      form: buildFormSnapshot()
    }));
    formSent = true;
    go('step-live');
    document.getElementById('live-title').textContent =
      'Live: ' + (document.getElementById('form-title').value || 'Form');
    renderAnswers();
  });

  channel.addEventListener('message', async (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch (_) { return; }
    if (msg.type === 'hello' && msg.nonce) {
      peerNonce = msg.nonce;
      const code = await computeSessionCode(myNonce, peerNonce);
      const el = document.getElementById('session-code');
      if (el) el.textContent = '🔐 ' + code;
    } else if (msg.type === 'answer-update') {
      answers[msg.fieldId] = msg.value;
      renderAnswers();
    } else if (msg.type === 'file-start') {
      filesInProgress[msg.fieldId] = {
        name: msg.name, mime: msg.mime, size: msg.size,
        chunks: new Array(msg.totalChunks)
      };
    } else if (msg.type === 'file-chunk') {
      const fip = filesInProgress[msg.fieldId];
      if (fip) fip.chunks[msg.index] = msg.data;
    } else if (msg.type === 'file-end') {
      const fip = filesInProgress[msg.fieldId];
      if (fip) {
        answers[msg.fieldId] = {
          name: fip.name, mime: fip.mime, size: fip.size,
          data: fip.chunks.join('')
        };
        delete filesInProgress[msg.fieldId];
        renderAnswers();
      }
    } else if (msg.type === 'submit') {
      // Merge non-file answers without clobbering files that arrived in the
      // file-start/chunk/end stream just before this submit message.
      const incoming = msg.answers || {};
      for (const k of Object.keys(incoming)) answers[k] = incoming[k];
      renderAnswers();
      document.getElementById('btn-download').disabled = false;
      document.getElementById('btn-print').disabled = false;
      toast('Patient submitted the form');
      // Persist on the clinician's own device so the submission survives a tab
      // refresh and shows up in the dashboard. No network involvement.
      if (storageOk) {
        const snap = buildFormSnapshot();
        ProxStore.saveSubmission({
          formId:       currentFormId,
          formTitle:    snap.title || 'Untitled form',
          formSnapshot: snap,
          answers
        }).catch(() => { /* swallow — we still have the in-memory copy */ });
      }
    }
  });

  channel.addEventListener('close', () => setStatus('Disconnected'));
}

// ── Paper-print rendering ─────────────────────────────────────────────────
// Generates a static, printer-friendly HTML version of the form. No real
// <input> elements — fields are rendered as labels + underline lines or
// checkbox marks so the output is consistent across browsers and easy to
// fill in by hand.
function paperFieldHtml(f) {
  const def = f.default;
  const defStr = def != null && !Array.isArray(def) ? String(def) : '';
  const defSet = Array.isArray(def) ? new Set(def.map(String)) : null;
  const yesno  = defStr.toLowerCase() === 'yes' ? 'yes'
              :  defStr.toLowerCase() === 'no'  ? 'no'
              :  null;

  if (f.type === 'text' || f.type === 'number') {
    return defStr
      ? `<div class="paper-line filled">${escapeHtml(defStr)}</div>`
      : `<div class="paper-line"></div>`;
  }
  if (f.type === 'date') {
    return defStr
      ? `<div class="paper-line filled">${escapeHtml(defStr)}</div>`
      : `<div class="paper-line paper-date"><span>D D</span> / <span>M M</span> / <span>Y Y Y Y</span></div>`;
  }
  if (f.type === 'textarea') {
    if (defStr) return `<div class="paper-block filled">${escapeHtml(defStr)}</div>`;
    return `<div class="paper-line"></div><div class="paper-line"></div><div class="paper-line"></div>`;
  }
  if (f.type === 'file') {
    return `<div class="paper-block" style="min-height:2.4em;display:flex;align-items:center;color:#777;font-style:italic;">[ attach file / photo ]</div>`;
  }
  if (f.type === 'yesno') {
    const yChecked = yesno === 'yes' ? 'checked' : '';
    const nChecked = yesno === 'no'  ? 'checked' : '';
    return `<div class="paper-choices">
      <span class="paper-choice"><span class="paper-box ${yChecked}"></span>Yes</span>
      <span class="paper-choice"><span class="paper-box ${nChecked}"></span>No</span>
    </div>`;
  }
  if (f.type === 'radio' || f.type === 'checkbox') {
    const opts = Array.isArray(f.options) ? f.options : [];
    const checkedFor = (opt) => {
      if (f.type === 'radio')    return defStr === String(opt) ? 'checked' : '';
      if (f.type === 'checkbox') return defSet && defSet.has(String(opt)) ? 'checked' : '';
      return '';
    };
    return `<div class="paper-choices">
      ${opts.map(o => `<span class="paper-choice"><span class="paper-box ${checkedFor(o)}"></span>${escapeHtml(o)}</span>`).join('')}
    </div>`;
  }
  return '';
}

function buildPaperForm(snap) {
  const title = (snap.title || 'Untitled form').trim();
  const desc  = (snap.description || '').trim();
  const fields = Array.isArray(snap.fields) ? snap.fields : [];

  let body = '';
  let row = [];
  const flushRow = () => {
    if (row.length) body += `<div class="paper-row">${row.join('')}</div>`;
    row = [];
  };

  const numbered = !!snap.numbered;
  const capacity = (c) => c === 'half' ? 2 : c === 'third' ? 3 : c === 'quarter' ? 4 : 1;
  const colClass = (c) => ['half', 'third', 'quarter'].includes(c) ? c : 'full';
  let qNum = 0;
  let rowCap = 0;
  for (const f of fields) {
    if (f.type === 'pagebreak') {
      // Force a page break in the printed output so each "form page" lands on
      // its own piece of paper. CSS handles the actual break.
      flushRow();
      rowCap = 0;
      body += '<div class="paper-pagebreak"></div>';
      continue;
    }
    if (f.type === 'section') {
      flushRow();
      rowCap = 0;
      const sd = f.description ? `<div class="paper-section-desc">${escapeHtml(f.description)}</div>` : '';
      body += `<div class="paper-section">${escapeHtml(f.label || '(untitled section)')}${sd}</div>`;
      continue;
    }
    qNum += 1;
    const reqStar = f.required ? ' <span class="req">*</span>' : '';
    const hint    = f.hint     ? `<div class="paper-hint">${escapeHtml(f.hint)}</div>` : '';
    const numPrefix = numbered ? `<span class="intake-num">${qNum}.</span> ` : '';
    const cell = `
      <div class="paper-cell ${colClass(f.column)}">
        <div class="paper-label">${numPrefix}${escapeHtml(f.label || '(untitled question)')}${reqStar}</div>
        ${hint}
        ${paperFieldHtml(f)}
      </div>
    `;
    const cap = capacity(f.column);
    if (cap === 1) {
      flushRow();
      rowCap = 0;
      body += `<div class="paper-row">${cell}</div>`;
    } else {
      if (rowCap && rowCap !== cap) { flushRow(); rowCap = 0; }
      row.push(cell);
      rowCap = cap;
      if (row.length === cap) { flushRow(); rowCap = 0; }
    }
  }
  flushRow();

  return `
    <h1 class="paper-title">${escapeHtml(title)}</h1>
    ${desc ? `<p class="paper-desc">${escapeHtml(desc)}</p>` : ''}
    <div class="paper-form">${body}</div>
  `;
}

function buildFormSnapshot() {
  return {
    title: document.getElementById('form-title').value.trim(),
    description: document.getElementById('form-desc').value.trim(),
    numbered: !!document.getElementById('form-numbered')?.checked,
    fields: fields.map(f => {
      const out = { id: f.id, type: f.type, label: f.label.trim() };
      if (f.type === 'section') {
        if (f.description && String(f.description).trim()) out.description = String(f.description).trim();
      } else if (f.type === 'pagebreak') {
        // No extra metadata. The optional label survives via the base copy above.
      } else {
        out.required = !!f.required;
        out.column = ['half', 'third', 'quarter'].includes(f.column) ? f.column : 'full';
        if (f.hint && String(f.hint).trim()) out.hint = String(f.hint).trim();
        if (f.type === 'file' && f.accept) out.accept = String(f.accept);
        const d = f.default;
        const hasDefault = Array.isArray(d) ? d.length > 0 : (d != null && String(d).trim() !== '');
        if (hasDefault) out.default = Array.isArray(d) ? d.slice() : String(d).trim();
        // Validation rules: only the keys relevant to the field's type are kept.
        const v = f.validation || {};
        const vOut = {};
        if ((f.type === 'number') && Number.isFinite(Number(v.min)))    vOut.min    = Number(v.min);
        if ((f.type === 'number') && Number.isFinite(Number(v.max)))    vOut.max    = Number(v.max);
        if ((f.type === 'text' || f.type === 'textarea') && Number.isInteger(Number(v.minlen)) && Number(v.minlen) > 0) vOut.minlen = Number(v.minlen);
        if ((f.type === 'text' || f.type === 'textarea') && Number.isInteger(Number(v.maxlen)) && Number(v.maxlen) > 0) vOut.maxlen = Number(v.maxlen);
        if ((f.type === 'text') && v.pattern && String(v.pattern).trim()) vOut.pattern = String(v.pattern).trim();
        if ((f.type === 'file' || f.type === 'signature') && Number.isFinite(Number(v.maxsize)) && Number(v.maxsize) > 0) vOut.maxsize = Number(v.maxsize);
        if (f.type === 'file') {
          for (const k of ['minwidth', 'maxwidth', 'minheight', 'maxheight']) {
            if (Number.isInteger(Number(v[k])) && Number(v[k]) > 0) vOut[k] = Number(v[k]);
          }
        }
        if (Object.keys(vOut).length) out.validation = vOut;
        if (f.showIf && f.showIf.field && f.showIf.op) {
          out.showIf = {
            field: String(f.showIf.field),
            op:    String(f.showIf.op),
            value: f.showIf.value != null ? String(f.showIf.value) : ''
          };
        }
      }
      if (f.options) out.options = f.options.filter(Boolean);
      return out;
    })
  };
}

function renderAnswers() {
  const root = document.getElementById('answers-live');
  const snap = buildFormSnapshot();
  root.innerHTML = ProxRender.renderIntakeRows(snap.fields, (f, qNum) => {
    const v = answers[f.id];
    const numPrefix = qNum != null ? `<span class="intake-num">${qNum}.</span> ` : '';
    const colCls = ['half', 'third', 'quarter'].includes(f.column) ? f.column : 'full';
    return `
      <div class="intake-cell ${colCls}">
        <div class="intake-label">${numPrefix}${escapeHtml(f.label)}${f.required ? ' <span class="req">*</span>' : ''}</div>
        <div class="intake-answer">${formatAnswer(f, v)}</div>
      </div>
    `;
  }, { numbered: !!snap.numbered });
}

function formatAnswer(f, v) {
  if (v == null || v === '' || (Array.isArray(v) && !v.length)) return '<span class="muted">—</span>';
  if (v && typeof v === 'object' && v._pendingFile) {
    const kb = v.size ? ' · ' + Math.ceil(v.size / 1024) + ' KB' : '';
    return `<span class="muted">📎 ${escapeHtml(v.name || (f.type === 'signature' ? 'signature' : 'file'))}${kb} — uploading on submit</span>`;
  }
  if ((f.type === 'file' || f.type === 'signature') && v && typeof v === 'object' && v.data) return renderFileAnswer(v);
  if (Array.isArray(v)) return v.map(escapeHtml).join(', ');
  if (f.type === 'yesno') return v ? 'Yes' : 'No';
  return escapeHtml(String(v));
}

function renderFileAnswer(v) {
  const safeName = escapeHtml(v.name || 'file');
  const dataUrl = 'data:' + (v.mime || 'application/octet-stream') + ';base64,' + v.data;
  const sizeKB = v.size ? Math.ceil(v.size / 1024) + ' KB' : '';
  if ((v.mime || '').startsWith('image/')) {
    return `<a class="file-link" href="${dataUrl}" download="${safeName}" title="Download ${safeName}">
              <img src="${dataUrl}" alt="${safeName}" class="file-thumb">
              <span class="file-meta">${safeName}${sizeKB ? ' · ' + sizeKB : ''}</span>
            </a>`;
  }
  return `<a class="file-link" href="${dataUrl}" download="${safeName}">📎 ${safeName}${sizeKB ? ' · ' + sizeKB : ''}</a>`;
}

// ── Download / Print ──────────────────────────────────────────────────────

function downloadJson() {
  const snap = buildFormSnapshot();
  const payload = {
    form: snap,
    answers,
    submittedAt: new Date().toISOString()
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${slug(snap.title)}-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function slug(s) {
  return (s || 'form').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

// ── UI helpers ────────────────────────────────────────────────────────────

function go(stepId) {
  ['step-dashboard', 'step-build', 'step-share', 'step-live', 'step-submission'].forEach(id => {
    document.getElementById(id)?.classList.toggle('hidden', id !== stepId);
  });
}

// ── View a saved submission ──────────────────────────────────────────────

function fmtAnswerDisplay(f, v) {
  if (v == null || v === '' || (Array.isArray(v) && !v.length)) {
    return '<span class="muted">—</span>';
  }
  if ((f.type === 'file' || f.type === 'signature') && v && typeof v === 'object' && v.data) return renderFileAnswer(v);
  if (Array.isArray(v)) return v.map(escapeHtml).join(', ');
  if (f.type === 'yesno') return v === true || v === 'yes' ? 'Yes' : 'No';
  return escapeHtml(String(v));
}

async function loadSubmissionView(id) {
  if (!storageOk) return false;
  const sub = await ProxStore.getSubmission(id);
  if (!sub) return false;

  document.getElementById('sub-title').textContent     = sub.formTitle || 'Submission';
  document.getElementById('sub-id-badge').textContent  = '#' + shortId(sub.id);
  document.getElementById('sub-received').textContent  = fmtDateTime(sub.receivedAt);

  const root = document.getElementById('sub-view');
  const fieldsArr = (sub.formSnapshot && sub.formSnapshot.fields) || [];
  if (!fieldsArr.length) {
    root.innerHTML = '<p class="empty">This submission has no form snapshot.</p>';
  } else {
    root.innerHTML = ProxRender.renderIntakeRows(fieldsArr, (f, qNum) => {
      const colCls = ['half', 'third', 'quarter'].includes(f.column) ? f.column : 'full';
      const reqStar = f.required ? ' <span class="req">*</span>' : '';
      const numPrefix = qNum != null ? `<span class="intake-num">${qNum}.</span> ` : '';
      return `
        <div class="intake-cell ${colCls}">
          <div class="intake-label">${numPrefix}${escapeHtml(f.label)}${reqStar}</div>
          <div class="intake-answer">${fmtAnswerDisplay(f, (sub.answers || {})[f.id])}</div>
        </div>
      `;
    }, { numbered: !!(sub.formSnapshot && sub.formSnapshot.numbered) });
  }

  document.getElementById('btn-sub-export').onclick = () => {
    const blob = new Blob([JSON.stringify(sub, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (slug(sub.formTitle) || 'submission') + '-' + shortId(sub.id) + '.json';
    a.click();
    URL.revokeObjectURL(a.href);
  };
  document.getElementById('btn-sub-print').onclick = () => {
    document.body.classList.add('printing-preview');
    const restore = () => document.body.classList.remove('printing-preview');
    window.addEventListener('afterprint', restore, { once: true });
    window.print();
    setTimeout(restore, 1500);
  };
  document.getElementById('btn-sub-delete').onclick = async () => {
    if (!confirm('Delete this submission permanently?')) return;
    try { await ProxStore.deleteSubmission(sub.id); } catch (_) {}
    location.replace('/received.html');
  };

  return true;
}

// ── Dashboard ─────────────────────────────────────────────────────────────

function fmtDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function fieldCountSummary(fields) {
  if (!Array.isArray(fields) || !fields.length) return 'Empty';
  const inputs   = fields.filter(f => f.type !== 'section').length;
  const sections = fields.length - inputs;
  return `${inputs} question${inputs === 1 ? '' : 's'}` + (sections ? ` · ${sections} section${sections === 1 ? '' : 's'}` : '');
}

function fmtDateTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function shortId(id) {
  if (!id) return '';
  return id.replace(/^sub_/, '').replace(/-/g, '').slice(0, 8);
}

async function renderSubmissions() {
  const root = document.getElementById('submissions-list');
  if (!root) return;
  let subs = [];
  try { subs = await ProxStore.listSubmissions(); } catch (_) {}
  if (!subs.length) {
    root.innerHTML = `
      <div class="empty-state">
        <p>No submissions yet. When a patient submits a form to you, it will appear here.</p>
      </div>`;
    return;
  }
  root.innerHTML = subs.map(s => {
    const fields = (s.formSnapshot && s.formSnapshot.fields) || [];
    const answered = fields.filter(f => f.type !== 'section' && s.answers &&
      s.answers[f.id] !== undefined && s.answers[f.id] !== '' &&
      !(Array.isArray(s.answers[f.id]) && !s.answers[f.id].length)).length;
    const total = fields.filter(f => f.type !== 'section').length;
    return `
      <div class="form-card submission-card" data-id="${escapeHtml(s.id)}">
        <h3>${escapeHtml(s.formTitle || 'Untitled form')}</h3>
        <div class="meta">${answered}/${total} answered · received ${fmtDateTime(s.receivedAt)}</div>
        <div class="meta sub-id" title="Submission ID">#${escapeHtml(shortId(s.id))}</div>
        <div class="row">
          <a class="primary" href="/builder.html?submission=${encodeURIComponent(s.id)}">View</a>
          <button class="secondary" data-sub-act="export" data-id="${escapeHtml(s.id)}" type="button">Export JSON</button>
          <button class="secondary" data-sub-act="delete" data-id="${escapeHtml(s.id)}" type="button">Delete</button>
        </div>
      </div>
    `;
  }).join('');

  root.querySelectorAll('button[data-sub-act]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id  = btn.dataset.id;
      const act = btn.dataset.subAct;
      if (act === 'delete') {
        if (!confirm('Delete this submission permanently? The patient cannot resend it.')) return;
        try { await ProxStore.deleteSubmission(id); } catch (_) {}
        renderSubmissions();
      } else if (act === 'export') {
        const sub = await ProxStore.getSubmission(id);
        if (!sub) return;
        const blob = new Blob([JSON.stringify(sub, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = (slug(sub.formTitle) || 'submission') + '-' + shortId(sub.id) + '.json';
        a.click();
        URL.revokeObjectURL(a.href);
      }
    });
  });
}

async function renderFormsList() {
  const root = document.getElementById('forms-list');
  if (!root) return;
  let forms = [];
  try { forms = await ProxStore.listForms(); } catch (_) {}
  if (!forms.length) {
    root.innerHTML = `
      <div class="empty-state">
        <p>No forms yet. Click <strong>＋ New form</strong> to create your first one.</p>
      </div>`;
    return;
  }
  root.innerHTML = forms.map(f => `
    <div class="form-card" data-id="${escapeHtml(f.id)}">
      <h3>${escapeHtml(f.title || 'Untitled form')}</h3>
      <div class="meta">${fieldCountSummary(f.fields)} · updated ${fmtDate(f.updatedAt)}</div>
      <div class="row">
        <a class="primary" href="/builder.html?form=${encodeURIComponent(f.id)}">Open</a>
        <button class="secondary" data-act="duplicate" data-id="${escapeHtml(f.id)}" type="button">Duplicate</button>
        <button class="secondary" data-act="export"    data-id="${escapeHtml(f.id)}" type="button">Export</button>
        <button class="secondary" data-act="delete"    data-id="${escapeHtml(f.id)}" type="button">Delete</button>
      </div>
    </div>
  `).join('');

  root.querySelectorAll('button[data-act]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id  = btn.dataset.id;
      const act = btn.dataset.act;
      if (act === 'delete') {
        if (!confirm('Delete this form? This cannot be undone.')) return;
        try { await ProxStore.deleteForm(id); } catch (_) {}
        renderFormsList();
      } else if (act === 'duplicate') {
        const src = await ProxStore.getForm(id);
        if (!src) return;
        const copy = await ProxStore.createForm({
          title:       (src.title || 'Untitled') + ' (copy)',
          description: src.description || '',
          fields:      JSON.parse(JSON.stringify(src.fields || []))
        });
        location.href = '/builder.html?form=' + encodeURIComponent(copy.id);
      } else if (act === 'export') {
        const src = await ProxStore.getForm(id);
        if (!src) return;
        const yaml = ProxImport.toIndented({
          title:       src.title || '',
          description: src.description || '',
          fields:      src.fields || []
        });
        const blob = new Blob([yaml], { type: 'text/plain' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = (slug(src.title) || 'form') + '.yaml';
        a.click();
        URL.revokeObjectURL(a.href);
      }
    });
  });
}

async function newFormAndOpen() {
  const created = await ProxStore.createForm({ title: '', description: '', fields: [] });
  location.href = '/builder.html?form=' + encodeURIComponent(created.id);
}

// ── Import ────────────────────────────────────────────────────────────────

function openImportDialog() {
  const dlg = document.getElementById('import-dialog');
  document.getElementById('import-text').value = '';
  document.getElementById('import-file').value = '';
  document.getElementById('import-error').classList.add('hidden');
  if (dlg.showModal) dlg.showModal();
  else dlg.setAttribute('open', '');
}

function closeImportDialog() {
  const dlg = document.getElementById('import-dialog');
  if (dlg.close) dlg.close();
  else dlg.removeAttribute('open');
}

function showImportError(msg) {
  const el = document.getElementById('import-error');
  el.textContent = msg;
  el.classList.remove('hidden');
}

async function readPickedFile() {
  const input = document.getElementById('import-file');
  const file = input.files && input.files[0];
  if (!file) return null;
  return await file.text();
}

async function doImport() {
  const errEl = document.getElementById('import-error');
  errEl.classList.add('hidden');
  let text = document.getElementById('import-text').value;
  if (!text || !text.trim()) {
    try { text = await readPickedFile() || ''; } catch (_) {}
  }
  if (!text || !text.trim()) {
    showImportError('Paste a definition or pick a file first.');
    return;
  }
  let parsed;
  try { parsed = ProxImport.parseAuto(text); }
  catch (e) { showImportError(e.message || String(e)); return; }
  if (!storageOk) { showImportError('Storage unavailable — cannot save the imported form.'); return; }
  try {
    const created = await ProxStore.createForm({
      title:       parsed.title || 'Imported form',
      description: parsed.description || '',
      fields:      parsed.fields || []
    });
    closeImportDialog();
    location.href = '/builder.html?form=' + encodeURIComponent(created.id);
  } catch (e) {
    showImportError('Could not save the imported form: ' + (e.message || e));
  }
}

function setStatus(text) {
  document.getElementById('conn-status').textContent = text;
}

function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add('hidden'), 3000);
}

// ── Wire up ───────────────────────────────────────────────────────────────

window.addEventListener('DOMContentLoaded', async () => {
  const page = document.body.dataset.page || 'builder';

  ProxNet.checkAndDisplay('net-status');

  await initStorage();
  if (storageOk) {
    try { await ProxStore.migrateLegacyDraftIfNeeded(); } catch (_) {}
  }

  if (page === 'forms') {
    wireImportDialog();
    wireTemplatesDialog();
    document.getElementById('btn-new-form')?.addEventListener('click', newFormAndOpen);
    await renderFormsList();
    return;
  }

  if (page === 'received') {
    await renderSubmissions();
    return;
  }

  // page === 'builder' (builder.html)
  document.querySelectorAll('[data-add]').forEach(btn => {
    btn.addEventListener('click', () => addField(btn.dataset.add));
  });
  document.getElementById('btn-generate')?.addEventListener('click', generateLink);
  document.getElementById('btn-connect')?.addEventListener('click', connect);
  document.getElementById('btn-download')?.addEventListener('click', downloadJson);
  document.getElementById('btn-print')?.addEventListener('click', () => window.print());
  document.getElementById('copy-url')?.addEventListener('click', () => copyFrom('invite-url'));
  document.getElementById('copy-pass')?.addEventListener('click', () => copyFrom('invite-pass'));
  document.getElementById('btn-clear-draft')?.addEventListener('click', () => {
    if (confirm('Clear the current draft? This cannot be undone.')) clearDraft();
  });
  document.getElementById('btn-lock-reorder')?.addEventListener('click', toggleReorderLock);
  applyReorderLock();
  document.getElementById('btn-undo')?.addEventListener('click', undo);
  document.getElementById('btn-redo')?.addEventListener('click', redo);
  updateUndoButtons();
  const searchInp = document.getElementById('fields-search');
  if (searchInp) {
    searchInp.addEventListener('input', () => applyFieldsFilter(searchInp.value));
    searchInp.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        searchInp.value = '';
        applyFieldsFilter('');
        searchInp.blur();
      }
    });
  }
  document.getElementById('btn-test-fill')?.addEventListener('click', () => setTestFillMode(!previewTestMode));
  document.getElementById('btn-test-reset')?.addEventListener('click', resetTestAnswers);
  document.getElementById('btn-print-preview')?.addEventListener('click', () => {
    // Print whatever's there. Live HTML5 validation already paints invalid
    // fields red while the user types — no need for a blocking dialog here.
    // Generate a paper-ready static HTML version of the form. Avoiding real
    // <input> elements means browsers can't disagree on how to render them,
    // which is how the printed PDF was coming out with tiny boxed inputs.
    const originalTitle = document.title;
    const snap = buildFormSnapshot();
    if (snap.title) document.title = snap.title;

    document.getElementById('print-container')?.remove();
    const printRoot = document.createElement('div');
    printRoot.id = 'print-container';
    printRoot.innerHTML = buildPaperForm(snap);
    document.body.appendChild(printRoot);
    document.body.classList.add('printing-preview');

    const restore = () => {
      document.body.classList.remove('printing-preview');
      document.getElementById('print-container')?.remove();
      document.title = originalTitle;
    };
    window.addEventListener('afterprint', restore, { once: true });
    window.print();
    setTimeout(restore, 1500);
  });

  const debouncedPersist = ProxStore.debounce(persistDraft, 400);
  saveDraft = () => { markDirty(); debouncedPersist(); };
  updateSaveIndicator();

  document.getElementById('form-title')?.addEventListener('input',    () => { saveDraft(); renderPreview(); });
  document.getElementById('form-desc')?.addEventListener('input',     () => { saveDraft(); renderPreview(); });
  document.getElementById('form-numbered')?.addEventListener('change', () => { saveDraft(); renderPreview(); });
  document.getElementById('form-numbered')?.addEventListener('change', () => { saveDraft(); renderPreview(); });

  // Click a preview cell → expand and jump to its editor row.
  document.getElementById('form-preview')?.addEventListener('click', (e) => {
    const el = e.target.closest('.preview-clickable');
    if (!el) return;
    focusEditorRow(el.dataset.fieldId);
  });

  // Collapsible explainer jumbotron above the editor. State persisted so
  // power users only see the full panel once.
  initBuilderJumbo();

  // Route based on the URL:
  //   ?form=<id>       → editor
  //   ?submission=<id> → submission detail view
  //   neither          → bounce to the dashboard pages
  const params = new URLSearchParams(location.search);
  currentFormId = params.get('form');
  const submissionId = params.get('submission');

  if (submissionId) {
    const ok = await loadSubmissionView(submissionId);
    if (!ok) {
      toast('That submission no longer exists');
      location.replace('/received.html');
      return;
    }
    go('step-submission');
    return;
  }

  if (currentFormId) {
    loadCollapsedState();
    const ok = await loadForm(currentFormId);
    if (!ok) {
      toast('That form no longer exists');
      location.replace('/forms.html');
      return;
    }
    go('step-build');
    if (!fields.length) renderFields();
    renderPreview();
    updateSaveIndicator();
  } else {
    location.replace('/forms.html');
  }
});

const JUMBO_KEY = 'proxform_builder_jumbo_collapsed';
function initBuilderJumbo() {
  const el = document.getElementById('builder-jumbo');
  if (!el) return;
  const setCollapsed = (v) => {
    el.classList.toggle('collapsed', v);
    try { localStorage.setItem(JUMBO_KEY, v ? '1' : '0'); } catch (_) {}
  };
  let initial = false;
  try { initial = localStorage.getItem(JUMBO_KEY) === '1'; } catch (_) {}
  el.classList.toggle('collapsed', initial);

  document.getElementById('btn-jumbo-toggle')?.addEventListener('click', (e) => {
    e.stopPropagation();
    setCollapsed(!el.classList.contains('collapsed'));
  });
  el.querySelector('.builder-jumbo-head')?.addEventListener('click', (e) => {
    if (e.target.closest('button')) return;
    if (!el.classList.contains('collapsed')) return;
    setCollapsed(false);
  });
}

function wireTemplatesDialog() {
  const dlg = document.getElementById('templates-dialog');
  const list = document.getElementById('templates-list');
  if (!dlg || !list || typeof ProxTemplates === 'undefined') return;

  // Render the picker cards once.
  list.innerHTML = ProxTemplates.list().map(t => {
    const fieldCount = (t.form.fields || []).filter(f => f.type !== 'section').length;
    const sectionCount = (t.form.fields || []).filter(f => f.type === 'section').length;
    const meta = fieldCount + ' question' + (fieldCount === 1 ? '' : 's')
               + (sectionCount ? ' · ' + sectionCount + ' section' + (sectionCount === 1 ? '' : 's') : '');
    return `
      <div class="template-card" data-template-id="${escapeHtml(t.id)}">
        <div class="template-tag">${escapeHtml(t.industry)}</div>
        <h3 class="template-name">${escapeHtml(t.name)}</h3>
        <p class="template-summary">${escapeHtml(t.summary)}</p>
        <p class="template-meta">${escapeHtml(meta)}</p>
        <button class="primary" type="button" data-template-id="${escapeHtml(t.id)}">Use this template <span class="arrow">→</span></button>
      </div>
    `;
  }).join('');

  const open = () => {
    if (dlg.showModal) dlg.showModal();
    else dlg.setAttribute('open', '');
  };
  const close = () => {
    if (dlg.close) dlg.close();
    else dlg.removeAttribute('open');
  };

  document.getElementById('btn-templates')?.addEventListener('click', open);
  document.getElementById('btn-templates-cancel')?.addEventListener('click', close);

  list.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-template-id]');
    if (!btn) return;
    const id = btn.dataset.templateId;
    const t = ProxTemplates.get(id);
    if (!t) return;
    if (!storageOk) { toast('Storage unavailable — cannot save the template.'); return; }
    try {
      const created = await ProxStore.createForm({
        title:       t.form.title || t.name || '',
        description: t.form.description || '',
        fields:      JSON.parse(JSON.stringify(t.form.fields || []))
      });
      close();
      location.href = '/builder.html?form=' + encodeURIComponent(created.id);
    } catch (err) {
      toast('Could not create form: ' + (err.message || err));
    }
  });
}

function wireImportDialog() {
  document.getElementById('btn-import-form')?.addEventListener('click', openImportDialog);
  document.getElementById('btn-import-do')?.addEventListener('click', doImport);
  document.getElementById('btn-import-cancel')?.addEventListener('click', closeImportDialog);
  document.getElementById('import-file')?.addEventListener('change', async () => {
    try {
      const text = await readPickedFile();
      if (text) document.getElementById('import-text').value = text;
    } catch (_) {}
  });
}

function copyFrom(id) {
  const el = document.getElementById(id);
  el.select();
  navigator.clipboard?.writeText(el.value).then(
    () => toast('Copied'),
    () => document.execCommand('copy')
  );
}
