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
      renderForm();
      go('step-form');
    }
  });

  channel.addEventListener('close', () => setStatus('Disconnected'));
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

  const root = document.getElementById('patient-form');
  root.innerHTML = ProxRender.renderIntakeRows(form.fields || [], f => ProxRender.fieldCell(f, { key: 'live' }));

  root.querySelectorAll('[data-field]').forEach(input => {
    input.addEventListener('input', () => collectField(input));
    input.addEventListener('change', () => collectField(input));
  });

  applyRestoredValues();
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

function collectField(input) {
  const id = input.dataset.field;
  const type = input.dataset.type;
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
}

function sendAnswerUpdate(fieldId) {
  if (!dc || dc.readyState !== 'open') return;
  const now = Date.now();
  if (now - lastSentAt < 300) return;
  lastSentAt = now;
  dc.send(JSON.stringify({ type: 'answer-update', fieldId, value: answers[fieldId] }));
}

async function submit() {
  if (!form) return;
  for (const f of form.fields) {
    if (f.type === 'section' || !f.required) continue;
    const v = answers[f.id];
    const empty = v == null || v === '' || (Array.isArray(v) && !v.length);
    if (empty) {
      toast('Please answer: ' + f.label);
      return;
    }
  }
  if (!dc || dc.readyState !== 'open') {
    toast('Connection lost');
    return;
  }
  dc.send(JSON.stringify({ type: 'submit', answers }));
  if (storageOk && draftKey) {
    try { await ProxStore.clearFillDraft(draftKey); } catch (_) {}
  }
  go('step-done');
}
