// © 2026 Artivicolab. All rights reserved. ProxForm — proprietary software. See LICENSE.
// ProxForm — multi-session protocol manager.
//
// Owns the per-session state that used to live as module-scope globals in
// builder.js (pc, dc, answers, filesInProgress, nonces). Consumers subscribe
// via .on(event, handler) and never touch RTCPeerConnection or the wire
// protocol directly. Keeps the dashboard and the legacy single-session flow
// agnostic of each other.
//
// Depends on: p2p.js (createSession, completeSession), crypto.js (genNonce,
// computeSessionCode), storage.js (ProxStore.saveSubmission, getSubmission).

(function () {
  'use strict';

  const FILE_CHUNK_SIZE = 8000;

  const sessions = new Map();          // sessionId -> record
  const handlers = Object.create(null); // event -> [handler...]

  // Chrome / Edge freeze background tabs after ~5min, throttling JS timers and
  // breaking WebRTC keepalives. Holding a RUNNING AudioContext exempts the tab
  // from that freeze (same trick used by Zoom / Discord web). Critical: the
  // context must be in 'running' state — a 'suspended' context doesn't count.
  // Chrome only lets us resume an AudioContext during a user gesture, so we
  // attach a one-time document-level click handler that boots it before any
  // session even exists. The context stays silent (a 1-frame buffer looped
  // into destination at full silence) so no tab audio icon appears.
  let antiThrottleCtx = null;
  let antiThrottlePrimed = false;

  function bootAntiThrottle() {
    if (antiThrottleCtx) {
      // Already created — just make sure it's running.
      if (antiThrottleCtx.state === 'suspended') {
        antiThrottleCtx.resume().catch(() => {});
      }
      return;
    }
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      antiThrottleCtx = new Ctx();
      const buf = antiThrottleCtx.createBuffer(1, 1, 22050);
      const src = antiThrottleCtx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.connect(antiThrottleCtx.destination);
      src.start(0);
      if (antiThrottleCtx.state === 'suspended') {
        antiThrottleCtx.resume().catch(() => {});
      }
    } catch (_) { antiThrottleCtx = null; }
  }

  function primeAntiThrottle() {
    if (antiThrottlePrimed || typeof document === 'undefined') return;
    antiThrottlePrimed = true;
    // The very first user gesture (any click anywhere) boots the context in
    // 'running' state. Without a gesture, Chrome will block the resume call.
    const onGesture = () => {
      bootAntiThrottle();
      document.removeEventListener('click',    onGesture, true);
      document.removeEventListener('keydown',  onGesture, true);
      document.removeEventListener('touchstart', onGesture, true);
    };
    document.addEventListener('click',    onGesture, true);
    document.addEventListener('keydown',  onGesture, true);
    document.addEventListener('touchstart', onGesture, true);
  }

  // Prime the gesture handler at module load — covers every page that loads
  // sessions.js, not just the dashboard.
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', primeAntiThrottle, { once: true });
    } else {
      primeAntiThrottle();
    }
  }

  function ensureAntiThrottle() { bootAntiThrottle(); }
  function releaseAntiThrottleIfIdle() {
    if (!antiThrottleCtx) return;
    if (sessions.size > 0) return;
    try { antiThrottleCtx.close(); } catch (_) {}
    antiThrottleCtx = null;
    antiThrottlePrimed = false;
    primeAntiThrottle();
  }

  function on(event, handler) {
    (handlers[event] = handlers[event] || []).push(handler);
  }
  function emit(event, ...args) {
    const list = handlers[event];
    if (!list) return;
    for (const h of list) { try { h(...args); } catch (_) {} }
  }

  function newSessionId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    const a = new Uint8Array(8);
    crypto.getRandomValues(a);
    return Array.from(a).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // DMV-ticket label scheme — 1A, 2A, ... 200A, 1B, 2B, ... 200B, 1C ...
  // Number cycles 1→200, then the letter advances. Cap at letter Z (200×26 =
  // 5200 tickets) — past that we wrap to 1A again, which in practice means
  // never since a clinic burning 5200 tickets has bigger problems than
  // ticket collisions.
  //
  // The counter sits in localStorage and is reconciled with IndexedDB on
  // dashboard boot (reconcileLabelCounter below) so we never reuse a number
  // that's already attached to a saved submission or a dormant session.
  const LABEL_COUNTER_KEY = 'proxform_label_counter';
  const TICKETS_PER_LETTER = 200;
  const LETTERS = 26;
  const LABEL_RE = /^(\d+)([A-Z])$/;

  function labelFromPosition(n) {
    const safe = ((n % (TICKETS_PER_LETTER * LETTERS)) + (TICKETS_PER_LETTER * LETTERS)) % (TICKETS_PER_LETTER * LETTERS);
    const number = (safe % TICKETS_PER_LETTER) + 1;
    const letter = String.fromCharCode(65 + Math.floor(safe / TICKETS_PER_LETTER));
    return number + letter;
  }
  function positionFromLabel(label) {
    const m = LABEL_RE.exec(String(label || '').trim());
    if (!m) return -1;
    const number = parseInt(m[1], 10);
    const letterIdx = m[2].charCodeAt(0) - 65;
    if (!Number.isFinite(number) || number < 1 || number > TICKETS_PER_LETTER) return -1;
    return letterIdx * TICKETS_PER_LETTER + (number - 1);
  }
  function readCounter() {
    let n;
    try { n = parseInt(localStorage.getItem(LABEL_COUNTER_KEY) || '0', 10); } catch (_) { n = 0; }
    if (!Number.isFinite(n) || n < 0) n = 0;
    return n;
  }
  function writeCounter(n) {
    try { localStorage.setItem(LABEL_COUNTER_KEY, String(n)); } catch (_) {}
  }
  function nextAutoLabel() {
    const n = readCounter();
    writeCounter(n + 1);
    return labelFromPosition(n);
  }

  // Walk the submissions + pending_sessions stores and sync the counter to
  // one past the highest ticket already in use. Runs on demand from the
  // dashboard mount path; safe to call multiple times.
  async function reconcileLabelCounter() {
    if (!window.ProxStore || !ProxStore.isAvailable || !ProxStore.isAvailable()) return;
    let highest = -1;
    try {
      const subs = await ProxStore.listSubmissions();
      for (const s of subs) {
        const pos = positionFromLabel(s && s.senderLabel);
        if (pos > highest) highest = pos;
      }
    } catch (_) {}
    try {
      const pend = await ProxStore.listPendingSessions();
      for (const p of pend) {
        const pos = positionFromLabel(p && p.senderLabel);
        if (pos > highest) highest = pos;
      }
    } catch (_) {}
    // Also account for sessions live in this tab (e.g. multiple invites in a
    // row without intervening DB writes).
    for (const s of sessions.values()) {
      const pos = positionFromLabel(s && s.label);
      if (pos > highest) highest = pos;
    }
    const needed = highest + 1;
    if (needed > readCounter()) writeCounter(needed);
  }

  function shortId(id) {
    const s = String(id || '').replace(/[^a-z0-9]/gi, '');
    return s.slice(0, 8);
  }

  function setState(s, state) {
    if (s.state === state) return;
    s.state = state;
    if (state === 'connected' && !s.connectedAt) s.connectedAt = Date.now();
    if (state === 'submitted' && !s.submittedAt) s.submittedAt = Date.now();
    emit('state-changed', s);
    persistRecord(s).catch(() => {});
  }

  // Mirror the in-memory record into IndexedDB, minus URL / passphrase /
  // answers — we keep only what's safe to retain across a reload. See
  // storage.js for the GDPR rationale.
  async function persistRecord(s) {
    if (!window.ProxStore || !ProxStore.isAvailable || !ProxStore.isAvailable()) return;
    if (s.state === 'submitted' || s.state === 'closed') {
      try { await ProxStore.deletePendingSession(s.id); } catch (_) {}
      return;
    }
    try {
      await ProxStore.savePendingSession({
        id:           s.id,
        formId:       s.formId,
        formSnapshot: s.formSnapshot,
        senderLabel:  s.label || '',
        state:        s.state,
        createdAt:    s.createdAt
      });
    } catch (_) {}
  }

  // ── Wire ──────────────────────────────────────────────────────────────

  function attachIceWatcher(s) {
    if (!s.pc || s._iceWired) return;
    s._iceWired = true;
    const onIce = () => {
      const st = s.pc && s.pc.iceConnectionState;
      // 'disconnected' often recovers on its own (brief network hiccup) —
      // we surface it but keep the dc open so it can rebind. 'failed' /
      // 'closed' are terminal; flip state so the dashboard offers Reconnect.
      if (st === 'failed' || st === 'closed') {
        if (s.state !== 'submitted' && s.state !== 'closed') setState(s, 'disconnected');
      } else if (st === 'disconnected') {
        if (s.state === 'connected') setState(s, 'disconnected');
      } else if (st === 'connected' || st === 'completed') {
        if (s.state === 'disconnected' || s.state === 'connecting') setState(s, 'connected');
      }
    };
    s.pc.addEventListener('iceconnectionstatechange', onIce);
    s.pc.addEventListener('connectionstatechange', () => {
      const cs = s.pc && s.pc.connectionState;
      if (cs === 'failed' || cs === 'closed') {
        if (s.state !== 'submitted' && s.state !== 'closed') setState(s, 'disconnected');
      }
    });
  }

  function attachChannel(s, channel) {
    s.dc = channel;
    s.myNonce = genNonce();
    attachIceWatcher(s);
    ensureAntiThrottle();

    channel.addEventListener('open', () => {
      setState(s, 'connected');
      try {
        channel.send(JSON.stringify({
          type: 'form',
          nonce: s.myNonce,
          sessionId: s.id,
          form: s.formSnapshot
        }));
      } catch (_) {}
      s.formSent = true;
      emit('channel-open', s);
    });

    channel.addEventListener('message', async (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch (_) { return; }
      if (msg.type === 'hello' && msg.nonce) {
        s.peerNonce = msg.nonce;
        try { s.sas = await computeSessionCode(s.myNonce, s.peerNonce); } catch (_) {}
        emit('sas', s);
      } else if (msg.type === 'answer-update') {
        s.answers[msg.fieldId] = msg.value;
        emit('answer-update', s, msg.fieldId);
      } else if (msg.type === 'state-sync') {
        const incoming = msg.answers || {};
        s.answers = {};
        for (const k of Object.keys(incoming)) s.answers[k] = incoming[k];
        emit('state-sync', s);
      } else if (msg.type === 'file-start') {
        s.filesInProgress[msg.fieldId] = {
          name: msg.name, mime: msg.mime, size: msg.size,
          chunks: new Array(msg.totalChunks)
        };
      } else if (msg.type === 'file-chunk') {
        const fip = s.filesInProgress[msg.fieldId];
        if (fip) fip.chunks[msg.index] = msg.data;
      } else if (msg.type === 'file-end') {
        const fip = s.filesInProgress[msg.fieldId];
        if (fip) {
          s.answers[msg.fieldId] = {
            name: fip.name, mime: fip.mime, size: fip.size,
            data: fip.chunks.join('')
          };
          delete s.filesInProgress[msg.fieldId];
          emit('answer-update', s, msg.fieldId);
        }
      } else if (msg.type === 'submit') {
        const incoming = msg.answers || {};
        for (const k of Object.keys(incoming)) s.answers[k] = incoming[k];
        await handleSubmit(s);
      }
    });

    channel.addEventListener('close', () => {
      if (s.state !== 'submitted' && s.state !== 'closed') {
        setState(s, 'disconnected');
      }
    });
  }

  async function handleSubmit(s) {
    // Persist the submission before purging in-memory state. The submission
    // record is the only thing that survives — drafts and the live preview
    // are wiped so a stale row can never be accidentally re-shared.
    let saved = null;
    if (window.ProxStore && ProxStore.isAvailable && ProxStore.isAvailable()) {
      try {
        saved = await ProxStore.saveSubmission({
          formId:       s.formId || null,
          formTitle:    (s.formSnapshot && s.formSnapshot.title) || 'Untitled form',
          formSnapshot: s.formSnapshot,
          answers:      s.answers,
          // Whatever label the clinician put on the invite ("1A", "Mrs. Smith").
          // It's how this submission is identified after the fact; the WebRTC
          // channel itself carries no patient identity.
          senderLabel:  s.label || ''
        });
        // Remember the persisted record's id on the in-memory session so the
        // dashboard's "Open submission" button can jump straight to it. No
        // more heuristic (timestamp + formId) which fails when formId is null
        // on both sides.
        if (saved && saved.id) s.submissionId = saved.id;
      } catch (_) { /* keep in-memory copy for the UI */ }
    }
    emit('submitted', s, saved);
    setState(s, 'submitted');
    // Keep s.answers in memory so the legacy step-live Download button (and
    // the dashboard card) can still surface what just arrived. The submission
    // record in IndexedDB is the canonical persisted copy; closing the tab
    // wipes the in-memory map. Correction-portal leak prevention happens in
    // sendCorrection() by minting a fresh empty session record — never by
    // copying these answers into another session.
    s.filesInProgress = {};
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────

  async function create({ formSnapshot, formId, label, existingId, existingCreatedAt } = {}) {
    if (!formSnapshot) throw new Error('formSnapshot required');
    const id = existingId || newSessionId();
    const finalLabel = (label && String(label).trim()) || nextAutoLabel();
    const record = {
      id,
      shortId: shortId(id),
      label: finalLabel,
      formId: formId || null,
      formSnapshot,
      pc: null,
      dc: null,
      answers: {},
      filesInProgress: {},
      myNonce: '',
      peerNonce: '',
      sas: '',
      formSent: false,
      passphrase: '',
      inviteUrl: '',
      state: 'waiting',
      createdAt: existingCreatedAt || Date.now(),
      connectedAt: null,
      submittedAt: null
    };
    sessions.set(id, record);
    emit('created', record);
    persistRecord(record).catch(() => {});
    await openPortal(record);
    return record;
  }

  // Add a dormant record (no pc, no channel) for a session that was active
  // when the tab unloaded. The clinician sees a card with a "Reopen" button;
  // clicking it routes to reopenDormant() below which mints a fresh portal.
  function addDormant(rec) {
    if (!rec || !rec.id) return null;
    if (sessions.has(rec.id)) return sessions.get(rec.id);
    const record = {
      id: rec.id,
      shortId: shortId(rec.id),
      label: rec.senderLabel || '',
      formId: rec.formId || null,
      formSnapshot: rec.formSnapshot,
      pc: null,
      dc: null,
      answers: {},
      filesInProgress: {},
      myNonce: '',
      peerNonce: '',
      sas: '',
      formSent: false,
      passphrase: '',
      inviteUrl: '',
      state: 'dormant',
      createdAt: rec.createdAt || Date.now(),
      connectedAt: null,
      submittedAt: null
    };
    sessions.set(record.id, record);
    emit('created', record);
    return record;
  }

  // Restore every persisted record. Returns the list of dormant records the
  // dashboard should now render. Idempotent — calling twice is a no-op for
  // already-mounted ids.
  async function restoreDormant() {
    if (!window.ProxStore || !ProxStore.isAvailable || !ProxStore.isAvailable()) return [];
    let rows = [];
    try { rows = await ProxStore.listPendingSessions(); } catch (_) { return []; }
    const out = [];
    for (const r of rows) {
      const added = addDormant(r);
      if (added) out.push(added);
    }
    return out;
  }

  // Reopen a dormant session: mint a fresh pc + fresh passphrase + fresh URL,
  // bound to the SAME sessionId so the patient's draft restores when they
  // open the new link. The old invite URL is permanently dead.
  async function reopenDormant(id) {
    const s = sessions.get(id);
    if (!s) throw new Error('unknown session');
    if (s.state !== 'dormant' && s.state !== 'disconnected') {
      // already has a portal — fall through to standard reconnect path
      return reconnect(id);
    }
    setState(s, 'waiting');
    await openPortal(s);
    return s;
  }

  async function openPortal(s) {
    const fillUrlBase = location.origin + '/fill.html';
    const handshake = await createSession({ fillUrlBase });
    s.pc = handshake.pc;
    s.passphrase = handshake.passphrase;
    s.inviteUrl = handshake.url;
    attachChannel(s, handshake.channel);
    setState(s, 'waiting');
    emit('portal-ready', s);
  }

  async function reconnect(id) {
    const s = sessions.get(id);
    if (!s) throw new Error('unknown session');
    // Close the prior pc/dc cleanly. The patient is expected to paste the new
    // link in the same tab (in-memory answers survive) or open it in a fresh
    // tab (IndexedDB draft restores via the stable sessionId).
    try { if (s.dc) s.dc.close(); } catch (_) {}
    try { if (s.pc) s.pc.close(); } catch (_) {}
    s.dc = null;
    s.pc = null;
    s.formSent = false;
    s.myNonce = '';
    s.peerNonce = '';
    s.sas = '';
    await openPortal(s);
    return s;
  }

  async function connect(id, replyText) {
    const s = sessions.get(id);
    if (!s) throw new Error('unknown session');
    if (!s.pc) throw new Error('no portal');
    const raw = String(replyText || '').trim();
    if (!raw) throw new Error('empty reply');
    let encoded = raw;
    if (raw.includes('#answer=')) encoded = raw.split('#answer=')[1];
    else if (raw.includes('answer=')) encoded = raw.split('answer=')[1];
    encoded = encoded.split('&')[0];
    setState(s, 'connecting');
    try {
      await completeSession({ pc: s.pc, encryptedAnswer: encoded, passphrase: s.passphrase });
    } catch (err) {
      setState(s, 'waiting');
      throw err;
    }
    return s;
  }

  function end(id) {
    const s = sessions.get(id);
    if (!s) return;
    try { if (s.dc) s.dc.close(); } catch (_) {}
    try { if (s.pc) s.pc.close(); } catch (_) {}
    s.answers = {};
    s.filesInProgress = {};
    setState(s, 'closed');
    sessions.delete(id);
    emit('closed', s);
    releaseAntiThrottleIfIdle();
  }

  function remove(id) { end(id); }

  function setLabel(id, label) {
    const s = sessions.get(id);
    if (!s) return;
    s.label = String(label || '');
    emit('state-changed', s);
    persistRecord(s).catch(() => {});
  }

  function get(id) { return sessions.get(id) || null; }

  function list() {
    return Array.from(sessions.values()).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  }

  // Spawn a fresh blank correction portal from a saved submission. New
  // sessionId — never reuses the submission's id, never carries the original
  // answers. Prefill-with-previous-answers is intentionally not built; the
  // wrong-row risk is too high to default-on.
  //
  // Label inherits the original ticket and gets a "(correction)" tag so
  // hospital staff can keep the row tied to the same patient on the
  // dashboard. The auto-counter doesn't advance — the regex check in
  // reconcileLabelCounter ignores labels containing "(correction)".
  async function sendCorrection(submissionId, { label } = {}) {
    if (!window.ProxStore) throw new Error('storage unavailable');
    const sub = await ProxStore.getSubmission(submissionId);
    if (!sub) throw new Error('submission not found');
    const snap = sub.formSnapshot;
    if (!snap) throw new Error('submission has no form snapshot');
    const baseLabel = sub.senderLabel || ('#' + shortId(submissionId));
    return create({
      formSnapshot: snap,
      formId: sub.formId || null,
      label: label || (baseLabel + ' (correction)')
    });
  }

  window.ProxSessions = {
    create,
    reconnect,
    reopenDormant,
    restoreDormant,
    connect,
    end,
    remove,
    setLabel,
    get,
    list,
    sendCorrection,
    on,
    shortId,
    reconcileLabelCounter,
    FILE_CHUNK_SIZE
  };
})();
