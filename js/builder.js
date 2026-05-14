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

const DRAFT_KEY = 'current';

let fields = [];   // [{ id, type, label, required, options?, column? }]
let nextId = 1;

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

  root.querySelectorAll('[data-act]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      const act = btn.dataset.act;
      if (act === 'remove') removeField(id);
      else if (act === 'up')   moveField(id, -1);
      else if (act === 'down') moveField(id, +1);
    });
  });

  root.querySelectorAll('[data-field-label]').forEach(inp => {
    inp.addEventListener('input', () => updateField(inp.dataset.fieldLabel, { label: inp.value }));
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
  root.innerHTML = ProxRender.renderIntakeRows(
    buildFormSnapshot().fields,
    f => ProxRender.fieldCell(f, { disabled: true, key: 'preview' })
  );
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

  return `
    <div class="field-edit ${isSection ? 'is-section' : ''}">
      <div class="field-edit-head">
        <span class="field-type">${typeLabel}</span>
        <div class="field-edit-actions">
          <button class="icon-btn" data-act="up"     data-id="${f.id}" ${i === 0 ? 'disabled' : ''}>↑</button>
          <button class="icon-btn" data-act="down"   data-id="${f.id}" ${i === fields.length - 1 ? 'disabled' : ''}>↓</button>
          <button class="icon-btn" data-act="remove" data-id="${f.id}" aria-label="Remove">✕</button>
        </div>
      </div>
      <label class="sub">
        <span>${isSection ? 'Section title' : 'Question'}</span>
        <input type="text" data-field-label="${f.id}" value="${escapeHtml(f.label)}" placeholder="${labelPlaceholder}">
      </label>
      ${optsHtml}
      ${flagsHtml}
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

async function restoreDraft() {
  if (!storageOk) return;
  let draft;
  try { draft = await ProxStore.loadBuilderDraft(DRAFT_KEY); }
  catch (_) { return; }
  if (!draft) return;
  document.getElementById('form-title').value = draft.title || '';
  document.getElementById('form-desc').value  = draft.description || '';
  fields = Array.isArray(draft.fields) ? draft.fields : [];
  // Recompute nextId so new IDs don't collide with restored ones.
  let max = 0;
  for (const f of fields) {
    const n = parseInt(String(f.id || '').replace(/^f/, ''), 10);
    if (!isNaN(n) && n > max) max = n;
  }
  nextId = max + 1;
  renderFields();
}

function snapshotDraft() {
  return {
    title: document.getElementById('form-title').value,
    description: document.getElementById('form-desc').value,
    fields,
    savedAt: Date.now()
  };
}

async function persistDraft() {
  if (!storageOk) return;
  try { await ProxStore.saveBuilderDraft(DRAFT_KEY, snapshotDraft()); }
  catch (_) {}
}

async function clearDraft() {
  if (!storageOk) return;
  try { await ProxStore.clearBuilderDraft(DRAFT_KEY); } catch (_) {}
  fields = [];
  nextId = 1;
  document.getElementById('form-title').value = '';
  document.getElementById('form-desc').value = '';
  renderFields();
  toast('Draft cleared');
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
      if (f.type !== 'section') {
        out.required = !!f.required;
        out.column = f.column === 'half' ? 'half' : 'full';
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
  ['step-build', 'step-share', 'step-live'].forEach(id => {
    document.getElementById(id).classList.toggle('hidden', id !== stepId);
  });
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
  document.querySelectorAll('[data-add]').forEach(btn => {
    btn.addEventListener('click', () => addField(btn.dataset.add));
  });
  document.getElementById('btn-generate').addEventListener('click', generateLink);
  document.getElementById('btn-connect').addEventListener('click', connect);
  document.getElementById('btn-download').addEventListener('click', downloadJson);
  document.getElementById('btn-print').addEventListener('click', () => window.print());
  document.getElementById('copy-url').addEventListener('click', () => copyFrom('invite-url'));
  document.getElementById('copy-pass').addEventListener('click', () => copyFrom('invite-pass'));
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

  ProxNet.checkAndDisplay('net-status');

  await initStorage();
  saveDraft = ProxStore.debounce(persistDraft, 400);

  document.getElementById('form-title').addEventListener('input', () => { saveDraft(); renderPreview(); });
  document.getElementById('form-desc').addEventListener('input',  () => { saveDraft(); renderPreview(); });

  await restoreDraft();
  if (!fields.length) renderFields();
  renderPreview();
});

function copyFrom(id) {
  const el = document.getElementById(id);
  el.select();
  navigator.clipboard?.writeText(el.value).then(
    () => toast('Copied'),
    () => document.execCommand('copy')
  );
}
