// © 2026 Artivicolab. All rights reserved. ProxForm — proprietary software. See LICENSE.
// ProxForm — clinician form builder + session host.

const FIELD_TYPES = {
  section:  { label: 'Section header', hasOptions: false, isSection: true },
  text:     { label: 'Short text',     hasOptions: false },
  textarea: { label: 'Long text',      hasOptions: false },
  number:   { label: 'Number',         hasOptions: false },
  date:     { label: 'Date',           hasOptions: false },
  radio:    { label: 'Single choice',  hasOptions: true  },
  checkbox: { label: 'Multi choice',   hasOptions: true  },
  yesno:    { label: 'Yes / No',       hasOptions: false }
};

// Phase 2: forms are addressed by an id in the URL (?form=<id>).
// No id → dashboard (list of forms). With id → editor for that form.
let currentFormId = null;

let fields = [];   // [{ id, type, label, required, options?, column? }]
let nextId = 1;
const collapsedFields = new Set();   // ids whose editor body is hidden

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
let myNonce = '';
let peerNonce = '';

let saveDraft = () => {};   // replaced after wireup
let storageOk = false;

// ── Form building ─────────────────────────────────────────────────────────

function addField(type) {
  const isSection = FIELD_TYPES[type].isSection;
  fields.push({
    id: `f${nextId++}`,
    type,
    label: '',
    required: false,
    column: 'full',
    options: FIELD_TYPES[type].hasOptions ? ['Option 1', 'Option 2'] : undefined
  });
  if (isSection) {
    const f = fields[fields.length - 1];
    delete f.required;
    delete f.column;
  }
  renderFields();
  saveDraft();
}

function removeField(id) {
  fields = fields.filter(f => f.id !== id);
  if (collapsedFields.delete(id)) persistCollapsedState();
  renderFields();
  saveDraft();
}

function moveField(id, delta) {
  const i = fields.findIndex(f => f.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= fields.length) return;
  [fields[i], fields[j]] = [fields[j], fields[i]];
  renderFields();
  saveDraft();
}

// Clone the field at `id` and insert the copy directly after it. The new row
// gets a fresh id and " (copy)" appended to the label so it's obvious which
// is which. Focuses the new row's label input so the user can edit immediately.
function duplicateField(id) {
  const i = fields.findIndex(f => f.id === id);
  if (i < 0) return;
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

  root.querySelectorAll('[data-field-label]').forEach(inp => {
    inp.addEventListener('input', () => updateField(inp.dataset.fieldLabel, { label: inp.value }));
  });
  root.querySelectorAll('[data-field-hint]').forEach(inp => {
    inp.addEventListener('input', () => updateField(inp.dataset.fieldHint, { hint: inp.value }));
  });
  root.querySelectorAll('[data-field-desc]').forEach(ta => {
    ta.addEventListener('input', () => updateField(ta.dataset.fieldDesc, { description: ta.value }));
  });
  root.querySelectorAll('[data-field-req]').forEach(cb => {
    cb.addEventListener('change', () => updateField(cb.dataset.fieldReq, { required: cb.checked }));
  });
  root.querySelectorAll('[data-field-half]').forEach(cb => {
    cb.addEventListener('change', () => updateField(cb.dataset.fieldHalf, { column: cb.checked ? 'half' : 'full' }));
  });
  root.querySelectorAll('[data-field-opts]').forEach(ta => {
    ta.addEventListener('input', () => {
      const opts = ta.value.split('\n').map(s => s.trim()).filter(Boolean);
      updateField(ta.dataset.fieldOpts, { options: opts });
    });
  });

  renderPreview();
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
  for (const f of snap.fields) {
    if (f.type === 'section') {
      flushRow();
      const desc = f.description ? `<div class="intake-section-desc">${escapeHtml(f.description)}</div>` : '';
      html += `<div class="intake-section preview-clickable" data-field-id="${f.id}">${escapeHtml(f.label || '(untitled section)')}${desc}</div>`;
      continue;
    }
    const cellHtml = ProxRender.fieldCell(f, { disabled: true, key: 'preview' })
      .replace('<div class="intake-cell ', `<div class="intake-cell preview-clickable" data-field-id="${f.id}" tabindex="0" `);
    if (f.column === 'half') {
      row.push(cellHtml);
      if (row.length === 2) flushRow();
    } else {
      flushRow();
      html += `<div class="intake-row">${cellHtml}</div>`;
    }
  }
  flushRow();
  root.innerHTML = html;
}

function fieldEditor(f, i) {
  const meta = FIELD_TYPES[f.type];
  const isSection = !!meta.isSection;
  const typeLabel = meta.label;

  const optsHtml = meta.hasOptions ? `
    <label class="sub">
      <span>Options (one per line)</span>
      <textarea data-field-opts="${f.id}" rows="3">${escapeHtml((f.options || []).join('\n'))}</textarea>
    </label>
  ` : '';

  const hintHtml = isSection ? '' : `
    <label class="sub">
      <span>Help text <span class="muted">(optional)</span></span>
      <input type="text" data-field-hint="${f.id}" value="${escapeHtml(f.hint || '')}" placeholder="Shown under the question — e.g. &quot;No spaces or dashes&quot;">
    </label>
  `;

  const sectionDescHtml = !isSection ? '' : `
    <label class="sub">
      <span>Description <span class="muted">(optional)</span></span>
      <textarea data-field-desc="${f.id}" rows="2" placeholder="Shown under the section title — e.g. &quot;Please answer to the best of your knowledge.&quot;">${escapeHtml(f.description || '')}</textarea>
    </label>
  `;

  const flagsHtml = isSection ? '' : `
    <div class="field-flags">
      <label class="sub inline">
        <input type="checkbox" data-field-req="${f.id}" ${f.required ? 'checked' : ''}>
        <span>Required</span>
      </label>
      <label class="sub inline">
        <input type="checkbox" data-field-half="${f.id}" ${f.column === 'half' ? 'checked' : ''}>
        <span>Half-width (pairs with next half-width field on the same row)</span>
      </label>
    </div>
  `;

  const labelPlaceholder = isSection ? 'Section title (e.g. Patient Information)' : 'Type the question…';

  const isCollapsed = collapsedFields.has(f.id);
  const summaryText = (f.label && f.label.trim())
    ? f.label.trim()
    : (isSection ? '(untitled section)' : '(untitled question)');
  const reqStar = f.required ? ' *' : '';

  return `
    <div class="field-edit ${isSection ? 'is-section' : ''}${isCollapsed ? ' collapsed' : ''}" data-field-id="${f.id}">
      <div class="field-edit-head" title="Click to expand/collapse">
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
          <span>${isSection ? 'Section title' : 'Question'}</span>
          <input type="text" data-field-label="${f.id}" value="${escapeHtml(f.label)}" placeholder="${labelPlaceholder}">
        </label>
        ${sectionDescHtml}
        ${hintHtml}
        ${optsHtml}
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

async function persistDraft() {
  if (!storageOk || !currentFormId) return;
  try { await ProxStore.saveForm(currentFormId, snapshotDraft()); } catch (_) {}
}

// "Clear draft" wipes the editor *contents* of the active form (title, desc,
// fields) without deleting the form itself. To remove a form entirely, use the
// Delete button on the dashboard.
async function clearDraft() {
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
    } else if (msg.type === 'submit') {
      answers = msg.answers || answers;
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

function buildFormSnapshot() {
  return {
    title: document.getElementById('form-title').value.trim(),
    description: document.getElementById('form-desc').value.trim(),
    fields: fields.map(f => {
      const out = { id: f.id, type: f.type, label: f.label.trim() };
      if (f.type === 'section') {
        if (f.description && String(f.description).trim()) out.description = String(f.description).trim();
      } else {
        out.required = !!f.required;
        out.column = f.column === 'half' ? 'half' : 'full';
        if (f.hint && String(f.hint).trim()) out.hint = String(f.hint).trim();
      }
      if (f.options) out.options = f.options.filter(Boolean);
      return out;
    })
  };
}

function renderAnswers() {
  const root = document.getElementById('answers-live');
  const snap = buildFormSnapshot();
  root.innerHTML = ProxRender.renderIntakeRows(snap.fields, f => {
    const v = answers[f.id];
    return `
      <div class="intake-cell ${f.column === 'half' ? 'half' : 'full'}">
        <div class="intake-label">${escapeHtml(f.label)}${f.required ? ' <span class="req">*</span>' : ''}</div>
        <div class="intake-answer">${formatAnswer(f, v)}</div>
      </div>
    `;
  });
}

function formatAnswer(f, v) {
  if (v == null || v === '' || (Array.isArray(v) && !v.length)) return '<span class="muted">—</span>';
  if (Array.isArray(v)) return v.map(escapeHtml).join(', ');
  if (f.type === 'yesno') return v ? 'Yes' : 'No';
  return escapeHtml(String(v));
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
    root.innerHTML = ProxRender.renderIntakeRows(fieldsArr, f => {
      const half = f.column === 'half' ? 'half' : 'full';
      const reqStar = f.required ? ' <span class="req">*</span>' : '';
      return `
        <div class="intake-cell ${half}">
          <div class="intake-label">${escapeHtml(f.label)}${reqStar}</div>
          <div class="intake-answer">${fmtAnswerDisplay(f, (sub.answers || {})[f.id])}</div>
        </div>
      `;
    });
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
  document.getElementById('btn-print-preview')?.addEventListener('click', () => {
    document.body.classList.add('printing-preview');
    const restore = () => document.body.classList.remove('printing-preview');
    window.addEventListener('afterprint', restore, { once: true });
    window.print();
    setTimeout(restore, 1500);
  });

  saveDraft = ProxStore.debounce(persistDraft, 400);

  document.getElementById('form-title')?.addEventListener('input', () => { saveDraft(); renderPreview(); });
  document.getElementById('form-desc')?.addEventListener('input',  () => { saveDraft(); renderPreview(); });

  // Click a preview cell → expand and jump to its editor row.
  document.getElementById('form-preview')?.addEventListener('click', (e) => {
    const el = e.target.closest('.preview-clickable');
    if (!el) return;
    focusEditorRow(el.dataset.fieldId);
  });

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
  } else {
    location.replace('/forms.html');
  }
});

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
