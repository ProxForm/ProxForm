// © 2026 Artivicolab. All rights reserved. ProxForm — proprietary software. See LICENSE.
// ProxForm — patient form-fill app.

let encryptedOffer = null;
let pc = null;
let dc = null;
let form = null;
let answers = {};
let lastSentAt = 0;
let myNonce = '';
let peerNonce = '';

let storageOk = false;
let draftKey = null;
let saveAnswersDraft = () => {};
let currentPage = 0;
let pageGroups = [];   // each entry: array of fields (no pagebreaks inside)

function setStatus(text) {
  document.getElementById('conn-status').textContent = text;
}

function go(id) {
  ['step-noinvite', 'step-pass', 'step-reply', 'step-form', 'step-done'].forEach(s => {
    document.getElementById(s).classList.toggle('hidden', s !== id);
  });
}

function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add('hidden'), 3000);
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ── Init from URL ─────────────────────────────────────────────────────────

window.addEventListener('DOMContentLoaded', async () => {
  encryptedOffer = parseHashParam('offer');
  if (!encryptedOffer) {
    go('step-noinvite');
    return;
  }
  go('step-pass');
  document.getElementById('pass-input').focus();

  document.getElementById('btn-unlock').addEventListener('click', unlock);
  document.getElementById('pass-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') unlock();
  });
  document.getElementById('copy-reply').addEventListener('click', () => {
    const el = document.getElementById('reply-url');
    el.select();
    navigator.clipboard?.writeText(el.value).then(() => toast('Copied'), () => {});
  });
  document.getElementById('btn-submit').addEventListener('click', submit);
  document.getElementById('btn-prev')?.addEventListener('click', gotoPrevPage);
  document.getElementById('btn-next')?.addEventListener('click', gotoNextPage);

  ProxNet.checkAndDisplay('net-status');

  await initStorage();
});

async function initStorage() {
  const status = await ProxStore.checkStorage();
  if (!status.ok) {
    storageOk = false;
    toast('Drafts disabled: this browser has no IndexedDB. Refresh will lose answers.');
    return;
  }
  storageOk = true;
  await ProxStore.requestPersistence();
  if (status.lowSpace) toast('Low disk space — answers may not persist if you close this tab.');
  draftKey = await ProxStore.hashKey(encryptedOffer);
  saveAnswersDraft = ProxStore.debounce(persistAnswers, 400);
}

async function persistAnswers() {
  if (!storageOk || !draftKey) return;
  try { await ProxStore.saveFillDraft(draftKey, { answers, savedAt: Date.now() }); }
  catch (_) {}
}

// ── Unlock + send reply ───────────────────────────────────────────────────

async function unlock() {
  const passInput = document.getElementById('pass-input');
  const passphrase = passInput.value.trim();
  const err = document.getElementById('pass-error');
  err.classList.add('hidden');
  if (!passphrase) return;

  setStatus('Decrypting…');
  try {
    const replyUrlBase = location.origin + '/fill.html';
    const session = await joinSession({
      encryptedOffer,
      passphrase,
      replyUrlBase,
      onChannel: ch => { dc = ch; setupChannel(ch); }
    });
    pc = session.pc;
    document.getElementById('reply-url').value = session.url;
    go('step-reply');
    setStatus('Waiting for clinician');
    navigator.clipboard?.writeText(session.url).then(
      () => toast('Reply link copied — send it back to your clinician'),
      () => {}
    );
  } catch (_) {
    err.classList.remove('hidden');
    setStatus('Not connected');
    passInput.focus();
    passInput.select();
  }
}

// ── DataChannel ───────────────────────────────────────────────────────────

function setupChannel(channel) {
  myNonce = genNonce();

  channel.addEventListener('open', () => {
    setStatus('Connected');
    channel.send(JSON.stringify({ type: 'hello', nonce: myNonce }));
  });

  channel.addEventListener('message', async (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch (_) { return; }
    if (msg.type === 'form') {
      form = msg.form;
      peerNonce = msg.nonce || '';
      const code = await computeSessionCode(myNonce, peerNonce);
      const el = document.getElementById('session-code');
      if (el) el.textContent = '🔐 ' + code;
      await restoreAnswers();
      seedDefaults();
      renderForm();
      go('step-form');
    }
  });

  channel.addEventListener('close', () => setStatus('Disconnected'));
}

// Pre-populate `answers` from each field's `default` so a submit without
// touching the field still carries the default through. Skips fields that
// already have a value (from a restored draft) so the patient's prior work
// isn't overwritten.
function seedDefaults() {
  if (!form || !Array.isArray(form.fields)) return;
  for (const f of form.fields) {
    if (f.type === 'section' || f.default == null) continue;
    const cur = answers[f.id];
    const hasCur = cur != null && cur !== '' && !(Array.isArray(cur) && !cur.length);
    if (hasCur) continue;
    if (f.type === 'yesno') {
      const d = String(f.default).toLowerCase();
      answers[f.id] = d === 'yes' || f.default === true ? true
                    : d === 'no'  || f.default === false ? false
                    : null;
    } else if (f.type === 'checkbox') {
      answers[f.id] = Array.isArray(f.default) ? f.default.map(String) : [String(f.default)];
    } else if (f.type === 'number') {
      const n = Number(f.default);
      answers[f.id] = isNaN(n) ? null : n;
    } else {
      answers[f.id] = String(f.default);
    }
  }
}

async function restoreAnswers() {
  if (!storageOk || !draftKey) return;
  try {
    const draft = await ProxStore.loadFillDraft(draftKey);
    if (draft && draft.answers && typeof draft.answers === 'object') {
      answers = draft.answers;
      toast('Restored answers from your previous session');
    }
  } catch (_) {}
}

// ── Render the form ───────────────────────────────────────────────────────

function renderForm() {
  document.getElementById('form-title-display').textContent = form.title || 'Form';
  document.getElementById('form-desc-display').textContent = form.description || '';

  // Split fields on pagebreak markers. One group = one page.
  pageGroups = [[]];
  for (const f of (form.fields || [])) {
    if (f.type === 'pagebreak') {
      if (pageGroups[pageGroups.length - 1].length) pageGroups.push([]);
    } else {
      pageGroups[pageGroups.length - 1].push(f);
    }
  }
  if (!pageGroups[pageGroups.length - 1].length) pageGroups.pop();
  if (!pageGroups.length) pageGroups = [[]];
  if (currentPage >= pageGroups.length) currentPage = pageGroups.length - 1;
  if (currentPage < 0) currentPage = 0;

  renderCurrentPage();
}

function renderCurrentPage() {
  const root = document.getElementById('patient-form');
  const pageFields = pageGroups[currentPage] || [];
  root.innerHTML = ProxRender.renderIntakeRows(
    pageFields,
    (f, qNum) => ProxRender.fieldCell(f, { key: 'live', qNum }),
    { numbered: !!form.numbered }
  );

  root.querySelectorAll('[data-field]').forEach(input => {
    input.addEventListener('input', () => collectField(input));
    input.addEventListener('change', () => collectField(input));
  });
  root.querySelectorAll('.signature-pad').forEach(pad => {
    if (typeof ProxSig === 'undefined') return;
    ProxSig.attach(pad, {
      getExistingData: (id) => answers[id],
      onStroke: (id, answer) => {
        answers[id] = answer;
        saveAnswersDraft();
        sendAnswerUpdate(id);
        applyConditional();
      }
    });
  });
  root.querySelectorAll('[data-signature-clear]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.signatureClear;
      const pad = document.querySelector(`.signature-pad[data-signature="${id}"]`);
      if (typeof ProxSig !== 'undefined') ProxSig.clear(pad);
      delete answers[id];
      saveAnswersDraft();
      sendAnswerUpdate(id);
      applyConditional();
    });
  });

  applyRestoredValues();
  applyConditional();
  updatePageNav();
}


function updatePageNav() {
  const nav   = document.getElementById('page-nav');
  const prev  = document.getElementById('btn-prev');
  const next  = document.getElementById('btn-next');
  const sub   = document.getElementById('btn-submit');
  const count = document.getElementById('page-count');
  const total = pageGroups.length;
  if (nav) nav.classList.toggle('hidden', total <= 1);
  if (count) count.textContent = total > 1 ? `Page ${currentPage + 1} of ${total}` : '';
  if (prev) prev.disabled = currentPage === 0;
  const onLast = currentPage >= total - 1;
  if (next) next.classList.toggle('hidden', onLast);
  if (sub)  sub.classList.toggle('hidden', !onLast);
}

function gotoPrevPage() {
  if (currentPage <= 0) return;
  currentPage -= 1;
  renderCurrentPage();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function gotoNextPage() {
  // Validate the current page before advancing.
  const formEl = document.getElementById('patient-form');
  if (formEl && typeof formEl.checkValidity === 'function' && !formEl.checkValidity()) {
    if (typeof formEl.reportValidity === 'function') formEl.reportValidity();
    return;
  }
  const hidden = (typeof ProxCond !== 'undefined')
    ? new Set((form.fields || []).filter(f => f.showIf && !ProxCond.evaluate(f.showIf, answers)).map(f => f.id))
    : new Set();
  for (const f of (pageGroups[currentPage] || [])) {
    if (f.type === 'section' || !f.required) continue;
    if (hidden.has(f.id)) continue;
    const v = answers[f.id];
    const empty = v == null || v === '' || (Array.isArray(v) && !v.length);
    if (empty) {
      toast('Please answer: ' + f.label);
      return;
    }
  }
  if (currentPage >= pageGroups.length - 1) return;
  currentPage += 1;
  renderCurrentPage();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Re-evaluate every field's `showIf` rule against the current answers map.
// Called after each input change so dependent fields appear/disappear live.
function applyConditional() {
  if (typeof ProxCond === 'undefined' || !form) return;
  const root = document.getElementById('patient-form');
  ProxCond.applyVisibility(root, form.fields || [], answers);
}

function applyRestoredValues() {
  for (const [id, v] of Object.entries(answers)) {
    if (v == null) continue;
    const inputs = document.querySelectorAll(`[data-field="${id}"]`);
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

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const FILE_CHUNK_SIZE = 8000;

function arrayBufferToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(s);
}

async function handleFilePick(input) {
  const id = input.dataset.field;
  const file = input.files && input.files[0];
  if (!file) { delete answers[id]; applyConditional(); saveAnswersDraft(); return; }
  if (file.size > MAX_FILE_SIZE) {
    toast('File too large (max ' + Math.floor(MAX_FILE_SIZE / (1024 * 1024)) + ' MB). Pick a smaller one.');
    input.value = '';
    delete answers[id];
    return;
  }
  try {
    const buf = await file.arrayBuffer();
    const data = arrayBufferToBase64(buf);
    answers[id] = { name: file.name, mime: file.type || 'application/octet-stream', size: file.size, data };
  } catch (e) {
    toast('Could not read the file: ' + (e.message || e));
    return;
  }
  // Tiny preview if it's an image.
  const preview = document.querySelector(`[data-file-preview="${id}"]`);
  if (preview) {
    preview.innerHTML = '';
    if (answers[id].mime.startsWith('image/')) {
      const img = document.createElement('img');
      img.src = 'data:' + answers[id].mime + ';base64,' + answers[id].data;
      img.alt = answers[id].name;
      preview.appendChild(img);
    } else {
      preview.textContent = answers[id].name + ' · ' + Math.ceil(file.size / 1024) + ' KB';
    }
  }
  applyConditional();
  saveAnswersDraft();
}

function collectField(input) {
  const id = input.dataset.field;
  const type = input.dataset.type;
  if (type === 'file') { handleFilePick(input); applyConditional(); return; }
  if (type === 'checkbox') {
    const boxes = document.querySelectorAll(`[data-field="${id}"][data-type="checkbox"]`);
    answers[id] = Array.from(boxes).filter(b => b.checked).map(b => b.value);
  } else if (type === 'yesno') {
    const picked = document.querySelector(`[data-field="${id}"][data-type="yesno"]:checked`);
    answers[id] = picked ? (picked.value === 'yes') : null;
  } else if (type === 'radio') {
    const picked = document.querySelector(`[data-field="${id}"][data-type="radio"]:checked`);
    answers[id] = picked ? picked.value : '';
  } else if (type === 'number') {
    answers[id] = input.value === '' ? null : Number(input.value);
  } else {
    answers[id] = input.value;
  }
  saveAnswersDraft();
  sendAnswerUpdate(id);
  applyConditional();
}

function sendAnswerUpdate(fieldId) {
  if (!dc || dc.readyState !== 'open') return;
  const v = answers[fieldId];
  // File and signature blobs would blow past the data-channel single-message
  // ceiling. They ride the chunked file-start/file-chunk/file-end protocol
  // when the patient hits Submit. Send a slim placeholder so the clinician
  // sees that the field is filled, without the data.
  if (v && typeof v === 'object' && typeof v.data === 'string' && typeof v.mime === 'string') {
    const now = Date.now();
    if (now - lastSentAt < 300) return;
    lastSentAt = now;
    dc.send(JSON.stringify({
      type: 'answer-update',
      fieldId,
      value: { _pendingFile: true, name: v.name || '', mime: v.mime, size: v.size || 0 }
    }));
    return;
  }
  const now = Date.now();
  if (now - lastSentAt < 300) return;
  lastSentAt = now;
  dc.send(JSON.stringify({ type: 'answer-update', fieldId, value: v }));
}

async function submit() {
  if (!form) return;
  // HTML5 validation: numeric min/max, text minlength/maxlength, regex pattern.
  // The browser shows an inline error bubble on the first invalid field and
  // refuses to "submit" — better UX than our manual toast for format errors.
  const formEl = document.getElementById('patient-form');
  if (formEl && typeof formEl.checkValidity === 'function') {
    if (!formEl.checkValidity()) {
      if (typeof formEl.reportValidity === 'function') formEl.reportValidity();
      return;
    }
  }
  const hidden = (typeof ProxCond !== 'undefined')
    ? new Set(form.fields.filter(f => f.showIf && !ProxCond.evaluate(f.showIf, answers)).map(f => f.id))
    : new Set();
  for (let pIdx = 0; pIdx < pageGroups.length; pIdx++) {
    for (const f of pageGroups[pIdx]) {
      if (f.type === 'section' || !f.required) continue;
      if (hidden.has(f.id)) continue;
      const v = answers[f.id];
      const empty = v == null || v === '' || (Array.isArray(v) && !v.length);
      if (empty) {
        if (currentPage !== pIdx) { currentPage = pIdx; renderCurrentPage(); }
        toast('Please answer: ' + f.label);
        return;
      }
    }
  }
  if (!dc || dc.readyState !== 'open') {
    toast('Connection lost');
    return;
  }
  // Send file answers first (chunked), then the submit message with file
  // fields removed — the clinician's setupChannel reassembles each file
  // before merging the rest of the answers.
  const fileIds = [];
  const lean = {};
  for (const [k, v] of Object.entries(answers)) {
    if (v && typeof v === 'object' && typeof v.data === 'string' && typeof v.mime === 'string') {
      fileIds.push(k);
    } else {
      lean[k] = v;
    }
  }
  for (const id of fileIds) {
    const f = answers[id];
    const total = Math.ceil(f.data.length / FILE_CHUNK_SIZE);
    dc.send(JSON.stringify({ type: 'file-start', fieldId: id, name: f.name, mime: f.mime, size: f.size, totalChunks: total }));
    for (let i = 0; i < total; i++) {
      dc.send(JSON.stringify({
        type: 'file-chunk',
        fieldId: id,
        index: i,
        data: f.data.slice(i * FILE_CHUNK_SIZE, (i + 1) * FILE_CHUNK_SIZE)
      }));
      // Yield occasionally so the UI thread doesn't choke on a big file.
      if (i % 20 === 19) await new Promise(r => setTimeout(r, 0));
    }
    dc.send(JSON.stringify({ type: 'file-end', fieldId: id }));
  }
  dc.send(JSON.stringify({ type: 'submit', answers: lean }));
  if (storageOk && draftKey) {
    try { await ProxStore.clearFillDraft(draftKey); } catch (_) {}
  }
  go('step-done');
}
