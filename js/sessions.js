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
  // breaking WebRTC keepalives. Holding an AudioContext active marks the tab
  // as audio-playing, which exempts it from the freeze (same trick used by
  // Zoom / Discord web). The context is silent — no oscillator connected to
  // destination — so the user hears nothing and no audio icon shows up in
  // the tab on Chrome (audible content is required for the icon).
  let antiThrottleCtx = null;
  function ensureAntiThrottle() {
    if (antiThrottleCtx) return;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      antiThrottleCtx = new Ctx();
      // Silent buffer source loop — keeps the context "active" without sound.
      const buf = antiThrottleCtx.createBuffer(1, 1, 22050);
      const src = antiThrottleCtx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.connect(antiThrottleCtx.destination);
      src.start(0);
    } catch (_) { antiThrottleCtx = null; }
  }
  function releaseAntiThrottleIfIdle() {
    if (!antiThrottleCtx) return;
    if (sessions.size > 0) return;
    try { antiThrottleCtx.close(); } catch (_) {}
    antiThrottleCtx = null;
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
          answers:      s.answers
        });
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

  async function create({ formSnapshot, formId, label } = {}) {
    if (!formSnapshot) throw new Error('formSnapshot required');
    const id = newSessionId();
    const record = {
      id,
      shortId: shortId(id),
      label: label || '',
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
      createdAt: Date.now(),
      connectedAt: null,
      submittedAt: null
    };
    sessions.set(id, record);
    emit('created', record);
    await openPortal(record);
    return record;
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
  }

  function get(id) { return sessions.get(id) || null; }

  function list() {
    return Array.from(sessions.values()).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  }

  // Spawn a fresh blank correction portal from a saved submission. New
  // sessionId — never reuses the submission's id, never carries the original
  // answers. Prefill-with-previous-answers is intentionally not built; the
  // wrong-row risk is too high to default-on.
  async function sendCorrection(submissionId, { label } = {}) {
    if (!window.ProxStore) throw new Error('storage unavailable');
    const sub = await ProxStore.getSubmission(submissionId);
    if (!sub) throw new Error('submission not found');
    const snap = sub.formSnapshot;
    if (!snap) throw new Error('submission has no form snapshot');
    return create({
      formSnapshot: snap,
      formId: sub.formId || null,
      label: label || ('Correction for #' + shortId(submissionId))
    });
  }

  window.ProxSessions = {
    create,
    reconnect,
    connect,
    end,
    remove,
    setLabel,
    get,
    list,
    sendCorrection,
    on,
    shortId,
    FILE_CHUNK_SIZE
  };
})();
