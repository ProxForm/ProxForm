// © 2026 Artivicolab. All rights reserved. ProxForm — proprietary software. See LICENSE.
// ProxForm — dashboard: parallel active sessions + completed submissions.
//
// Lives on /received.html. Owns the "Send new invite" picker + "Active
// sessions" cards, listens to ProxSessions events for live updates, and
// surfaces a "Resend (blank)" action on completed submission rows.

(function () {
  'use strict';

  if (typeof document === 'undefined') return;

  // The dashboard only activates on the received page. Builder.js still
  // renders the completed-submissions list itself; we layer on top.
  function isDashboardPage() {
    return document.body && document.body.dataset && document.body.dataset.page === 'received';
  }

  // ── Helpers ───────────────────────────────────────────────────────────

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function shortId(id) {
    return ProxSessions ? ProxSessions.shortId(id) : String(id || '').slice(0, 8);
  }

  function fmtTime(ms) {
    if (!ms) return '';
    const d = new Date(ms);
    const t = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    return t;
  }

  function statusLabel(state) {
    switch (state) {
      case 'waiting':      return 'Waiting for reply';
      case 'connecting':   return 'Connecting…';
      case 'connected':    return 'Connected';
      case 'disconnected': return 'Disconnected';
      case 'submitted':    return 'Submitted ✓';
      case 'closed':       return 'Ended';
      case 'dormant':      return 'Survived reload — Reopen to share';
      default:             return state || '';
    }
  }

  function toast(msg) {
    const el = document.getElementById('toast');
    if (!el) { console.warn(msg); return; }
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.add('hidden'), 3000);
  }

  async function populateFormPicker() {
    const sel = document.getElementById('dash-form-select');
    if (!sel || !window.ProxStore) return;
    let forms = [];
    try { forms = await ProxStore.listForms(); } catch (_) {}
    sel.innerHTML = '';
    // First-run guidance: show the onboarding card only when the clinic
    // has zero saved forms (fresh device / after End Shift never touches
    // forms, so this really means "brand new install").
    const hint = document.getElementById('onboarding-hint');
    if (hint) hint.hidden = forms.length > 0;
    if (!forms.length) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = '— no saved forms — build one first';
      opt.disabled = true;
      opt.selected = true;
      sel.appendChild(opt);
      return;
    }
    for (const f of forms) {
      const opt = document.createElement('option');
      opt.value = f.id;
      opt.textContent = (f.title || 'Untitled form') + ' · ' + (Array.isArray(f.fields) ? f.fields.length : 0) + ' field' + ((f.fields || []).length === 1 ? '' : 's');
      sel.appendChild(opt);
    }
  }

  // ── Card rendering ────────────────────────────────────────────────────

  function cardHtml(s) {
    const stateCls = 'state-' + (s.state || 'waiting');
    const label = s.label ? escapeHtml(s.label) : '<span class="muted">(no label)</span>';
    const title = escapeHtml((s.formSnapshot && s.formSnapshot.title) || 'Untitled form');
    const sas = s.sas ? `🔐 ${escapeHtml(s.sas)}` : '';
    const created = fmtTime(s.createdAt);

    const linkRow = (s.state === 'dormant')
      ? `<p class="muted small">This session was active when the tab reloaded. The old invite link is no longer usable — anyone who has it gets nothing. Click <em>Reopen</em> to mint a fresh link and passphrase to reshare with the patient.</p>
         <div class="card-actions">
           <button class="primary"   type="button" data-act="reopen">Reopen — new link & passphrase</button>
           <button class="secondary" type="button" data-act="end">Discard</button>
         </div>`
      : (s.state === 'waiting' || s.state === 'disconnected')
      ? `<label class="readonly-field">
           <span>Invite link</span>
           <div class="copy-row">
             <input type="text" readonly value="${escapeHtml(s.inviteUrl || '')}" data-link>
             <button class="secondary" type="button" data-act="copy-link">Copy</button>
           </div>
         </label>
         <label class="readonly-field">
           <span>Passphrase</span>
           <div class="copy-row">
             <input type="text" readonly value="${escapeHtml(s.passphrase || '')}" data-pass>
             <button class="secondary" type="button" data-act="copy-pass">Copy</button>
           </div>
         </label>
         <label class="readonly-field">
           <span>Reply link from patient</span>
           <textarea rows="2" data-reply placeholder="Paste the reply link they sent back"></textarea>
         </label>
         <div class="card-actions">
           <button class="primary"   type="button" data-act="connect">Connect →</button>
           <button class="secondary" type="button" data-act="reconnect" title="Generate a new portal for this same session">↻ New portal</button>
           <button class="secondary" type="button" data-act="end">End</button>
         </div>`
      : (s.state === 'connected' || s.state === 'connecting')
      ? `<div class="card-actions">
           <button class="secondary" type="button" data-act="reconnect" title="Generate a new portal (use if the patient disconnected)">↻ Reconnect</button>
           <button class="secondary" type="button" data-act="end">End</button>
         </div>
         <div class="card-preview" data-preview></div>`
      : (s.state === 'submitted')
      ? `<div class="card-actions">
           <a class="secondary" data-act="open-sub" title="Open the submission detail view" target="_self">Open submission</a>
           <button class="secondary" type="button" data-act="end">Dismiss</button>
         </div>`
      : `<div class="card-actions"><button class="secondary" type="button" data-act="end">Dismiss</button></div>`;

    return `
      <article class="session-card ${stateCls}" data-session="${escapeHtml(s.id)}">
        <header class="session-card-head">
          <button class="session-card-toggle" type="button" data-act="toggle" aria-expanded="false" title="Expand / collapse this session">▾</button>
          <span class="session-card-id">#${escapeHtml(shortId(s.id))}</span>
          <span class="session-card-label">${label}</span>
          <span class="session-card-title">${title}</span>
          <span class="session-card-sas">${sas}</span>
          <span class="session-card-time" title="Created at">${escapeHtml(created)}</span>
          <span class="session-card-state">${escapeHtml(statusLabel(s.state))}</span>
        </header>
        <div class="session-card-body" hidden>
          ${linkRow}
        </div>
      </article>
    `;
  }

  function renderActive() {
    const root = document.getElementById('active-sessions');
    if (!root || !window.ProxSessions) return;
    const list = ProxSessions.list();
    if (!list.length) {
      root.innerHTML = '<p class="muted empty">No active sessions yet. Pick a form above and click <em>Send invite</em>.</p>';
      return;
    }
    root.innerHTML = list.map(cardHtml).join('');
    // Restore expanded state for any card the user had opened.
    for (const id of expandedCards) {
      const card = root.querySelector(`[data-session="${cssEscape(id)}"]`);
      if (card) {
        card.querySelector('.session-card-body')?.removeAttribute('hidden');
        card.querySelector('[data-act="toggle"]')?.setAttribute('aria-expanded', 'true');
        const tog = card.querySelector('[data-act="toggle"]');
        if (tog) tog.textContent = '▾';
        renderPreviewInto(card, ProxSessions.get(id));
      }
    }
  }

  function cssEscape(s) { return String(s).replace(/[^a-z0-9_-]/gi, c => '\\' + c); }

  function renderPreviewInto(card, s) {
    if (!s) return;
    const preview = card.querySelector('[data-preview]');
    if (!preview) return;
    const fields = (s.formSnapshot && s.formSnapshot.fields) || [];
    const answers = s.answers || {};
    const rows = fields.map(f => {
      if (f.type === 'section' || f.type === 'pagebreak') {
        if (f.type === 'pagebreak') return '';
        return `<div class="intake-section">${escapeHtml(f.label || '(section)')}</div>`;
      }
      const v = answers[f.id];
      const colCls = ['half', 'third', 'quarter'].includes(f.column) ? f.column : 'full';
      const empty = v == null || v === '' || (Array.isArray(v) && !v.length);
      const display = empty ? '<span class="muted">—</span>'
        : Array.isArray(v) ? v.map(escapeHtml).join(', ')
        : (v && typeof v === 'object' && v._pendingFile) ? `<span class="muted">📎 ${escapeHtml(v.name || 'file')} — uploading on submit</span>`
        : (v && typeof v === 'object' && v.data) ? `<span class="muted">📎 ${escapeHtml(v.name || 'file')}</span>`
        : f.type === 'yesno' ? (v ? 'Yes' : 'No')
        : escapeHtml(String(v));
      return `<div class="intake-cell ${colCls}">
        <div class="intake-label">${escapeHtml(f.label)}${f.required ? ' <span class="req">*</span>' : ''}</div>
        <div class="intake-answer">${display}</div>
      </div>`;
    }).join('');
    preview.innerHTML = `<div class="patient-form preview-form">${rows}</div>`;
  }

  function updateCard(s) {
    const root = document.getElementById('active-sessions');
    if (!root) return;
    const existing = root.querySelector(`[data-session="${cssEscape(s.id)}"]`);
    if (!existing) { renderActive(); return; }
    const wasOpen = !existing.querySelector('.session-card-body')?.hasAttribute('hidden');
    const replacement = document.createElement('div');
    replacement.innerHTML = cardHtml(s).trim();
    const next = replacement.firstChild;
    existing.replaceWith(next);
    if (wasOpen) {
      next.querySelector('.session-card-body')?.removeAttribute('hidden');
      next.querySelector('[data-act="toggle"]')?.setAttribute('aria-expanded', 'true');
      const tog = next.querySelector('[data-act="toggle"]');
      if (tog) tog.textContent = '▾';
      renderPreviewInto(next, s);
    }
  }

  // ── Interaction ───────────────────────────────────────────────────────

  const expandedCards = new Set();

  function onClick(e) {
    const root = document.getElementById('active-sessions');
    if (!root || !root.contains(e.target)) return;
    const card = e.target.closest('.session-card');
    if (!card) return;
    const sessionId = card.dataset.session;
    const s = ProxSessions.get(sessionId);
    if (!s) return;
    const act = e.target.dataset.act || e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;

    if (act === 'toggle') {
      const body = card.querySelector('.session-card-body');
      const tog  = card.querySelector('[data-act="toggle"]');
      if (!body) return;
      const open = body.hasAttribute('hidden');
      if (open) {
        body.removeAttribute('hidden');
        tog?.setAttribute('aria-expanded', 'true');
        expandedCards.add(sessionId);
        renderPreviewInto(card, s);
      } else {
        body.setAttribute('hidden', '');
        tog?.setAttribute('aria-expanded', 'false');
        expandedCards.delete(sessionId);
      }
    } else if (act === 'copy-link') {
      const inp = card.querySelector('[data-link]');
      if (inp) { inp.select(); navigator.clipboard?.writeText(inp.value).then(() => toast('Link copied'), () => {}); }
    } else if (act === 'copy-pass') {
      const inp = card.querySelector('[data-pass]');
      if (inp) { inp.select(); navigator.clipboard?.writeText(inp.value).then(() => toast('Passphrase copied'), () => {}); }
    } else if (act === 'connect') {
      const ta = card.querySelector('[data-reply]');
      const text = ta ? ta.value.trim() : '';
      if (!text) { toast('Paste the reply link from your patient first'); return; }
      ProxSessions.connect(sessionId, text).catch(() => toast('Could not decrypt the reply — passphrase mismatch or wrong link'));
    } else if (act === 'reconnect') {
      ProxSessions.reconnect(sessionId).then(() => toast('New portal generated — share the new link + passphrase')).catch(() => toast('Could not generate a new portal'));
    } else if (act === 'reopen') {
      ProxSessions.reopenDormant(sessionId)
        .then(() => toast('Fresh portal minted — copy the new link and passphrase, share them with the patient'))
        .catch(() => toast('Could not reopen this session'));
    } else if (act === 'end') {
      if (s.state === 'connected' || s.state === 'connecting') {
        ProxConfirm('The patient will lose their connection immediately. Any answers they haven\'t submitted are gone.', {
          title: 'End session?',
          confirmText: 'End',
          danger: true
        }).then(ok => { if (ok) ProxSessions.end(sessionId); });
        return;
      }
      ProxSessions.end(sessionId);
    } else if (act === 'open-sub') {
      // handleSubmit() stamps s.submissionId on the in-memory session record
      // as soon as the submission lands in IndexedDB. Use that directly — no
      // time-window heuristic that could miss when formId is null on both
      // sides or when receivedAt nudges past the submittedAt window.
      const id = s.submissionId;
      if (!id) { toast('Submission record not ready yet'); return; }
      if (window.ProxRouter) ProxRouter.go('submission', id);
      else location.href = '/builder.html?submission=' + encodeURIComponent(id);
    }
  }

  // ── "Send new invite" ─────────────────────────────────────────────────
  // Auto-labeling (DMV ticket: 1A, 1B, ...) lives in ProxSessions.create.

  async function onSend() {
    const sel = document.getElementById('dash-form-select');
    const lblInp = document.getElementById('dash-label');
    if (!sel || !sel.value) { toast('Pick a form first'); return; }
    let form = null;
    try { form = await ProxStore.getForm(sel.value); } catch (_) {}
    if (!form) { toast('That form has gone missing'); return; }
    if (!Array.isArray(form.fields) || !form.fields.some(f => f.type !== 'section' && f.type !== 'pagebreak')) {
      toast('That form has no questions to send');
      return;
    }
    const snap = { title: form.title || 'Untitled form', description: form.description || '', numbered: !!form.numbered, fields: form.fields };
    // Typed label wins; empty label means ProxSessions auto-assigns the next
    // ticket. Either way the counter only advances when an auto label is
    // actually emitted (handled inside ProxSessions.create).
    const typedLabel = (lblInp && lblInp.value.trim()) || '';
    try {
      const session = await ProxSessions.create({
        formSnapshot: snap,
        formId: form.id,
        label: typedLabel
      });
      if (lblInp) lblInp.value = '';
      toast('Invite ' + session.label + ' created — copy the link & passphrase, share them on different channels');
    } catch (_) {
      toast('Could not create invite');
    }
  }

  // ── Bootstrap ─────────────────────────────────────────────────────────
  //
  // The "Resend (blank)" action on completed submission rows is wired by
  // builder.js renderSubmissions() (each row carries data-sub-act="resend"
  // and calls ProxSessions.sendCorrection itself). We don't duplicate it.

  // When the tab comes back to the foreground, surface any sessions that
  // dropped while we weren't looking. Doesn't auto-reconnect (could create
  // surprise charges/data flows on a metered connection) — we just point
  // the clinician at the Reconnect button.
  function onVisibilityChange() {
    if (document.visibilityState !== 'visible') return;
    if (!window.ProxSessions) return;
    const dropped = ProxSessions.list().filter(s => s.state === 'disconnected');
    if (!dropped.length) return;
    const label = dropped.length === 1
      ? `Session ${ProxSessions.shortId(dropped[0].id)} dropped — click Reconnect on the card`
      : `${dropped.length} sessions dropped while away — click Reconnect on each card`;
    toast(label);
    // Re-render so the state-pill colour matches reality after any throttled
    // events finally drain on resume.
    renderActive();
  }

  // ProxSessions subscriptions stay active for the whole document lifetime —
  // the sessions Map lives at module scope and outlives any single mount.
  // Each handler no-ops when the dashboard isn't currently in the DOM.
  let _subscribed = false;
  function subscribeOnce() {
    if (_subscribed || !window.ProxSessions) return;
    _subscribed = true;
    const ifMounted = (fn) => (s) => {
      if (!document.getElementById('active-sessions')) return;
      fn(s);
    };
    ProxSessions.on('created',       ifMounted(() => renderActive()));
    ProxSessions.on('portal-ready',  ifMounted(updateCard));
    ProxSessions.on('state-changed', ifMounted(updateCard));
    ProxSessions.on('sas',           ifMounted(updateCard));
    ProxSessions.on('answer-update', ifMounted((s) => {
      const card = document.querySelector(`.session-card[data-session="${cssEscape(s.id)}"]`);
      if (card && !card.querySelector('.session-card-body')?.hasAttribute('hidden')) renderPreviewInto(card, s);
    }));
    ProxSessions.on('state-sync', ifMounted((s) => {
      const card = document.querySelector(`.session-card[data-session="${cssEscape(s.id)}"]`);
      if (card && !card.querySelector('.session-card-body')?.hasAttribute('hidden')) renderPreviewInto(card, s);
    }));
    ProxSessions.on('submitted', async () => {
      // Refresh the completed-submissions list so the new arrival appears.
      // Runs even when the view isn't mounted so the cache is fresh next nav.
      if (typeof window.renderSubmissions === 'function') {
        try { await window.renderSubmissions(); } catch (_) {}
      }
    });
    ProxSessions.on('closed', ifMounted(() => renderActive()));
  }

  async function onEndShift() {
    const ok = await ProxConfirm(
      'This deletes every patient submission, active invite, dormant session, and draft on THIS device. Form templates and your theme/shield settings stay. Use at the end of a shift so the next person starts clean.',
      { title: 'End shift?', confirmText: 'Wipe patient data', danger: true }
    );
    if (!ok) return;
    try {
      // Tear down every live session first so RTCPeerConnections close cleanly.
      for (const s of ProxSessions.list()) {
        try { ProxSessions.end(s.id); } catch (_) {}
      }
      // Nuke each store in one transaction per store. Forms are preserved on
      // purpose — those are clinic templates, not patient data.
      await ProxStore.clearStore('submissions');
      await ProxStore.clearStore('pending_sessions');
      await ProxStore.clearStore('fill_drafts');
      await ProxStore.clearStore('builder_drafts');
      // Ticket counter resets so the next shift starts at 1A.
      try { localStorage.removeItem('proxform_label_counter'); } catch (_) {}
      toast('Shift ended — device is clean. Ready for the next person.');
      renderActive();
      if (typeof window.renderSubmissions === 'function') {
        try { await window.renderSubmissions(); } catch (_) {}
      }
    } catch (e) {
      toast('Could not finish wipe: ' + (e.message || e));
    }
  }

  async function mount() {
    if (!window.ProxSessions) return;
    subscribeOnce();
    // Rehydrate any invites that were live when the tab last unloaded. They
    // come back in 'dormant' state — old links are dead, clinician clicks
    // Reopen to mint a fresh portal under the same sessionId.
    try { await ProxSessions.restoreDormant(); } catch (_) {}
    // Sync the ticket counter against what's already in IndexedDB so we
    // never hand out a label that collides with a saved submission or a
    // dormant session. First load on a fresh device → counter stays 0 → next
    // ticket is 1A.
    try { await ProxSessions.reconcileLabelCounter(); } catch (_) {}
    await populateFormPicker();
    document.getElementById('dash-send')?.addEventListener('click', onSend);
    document.getElementById('btn-end-shift')?.addEventListener('click', onEndShift);
    document.addEventListener('click', onClick);
    document.addEventListener('visibilitychange', onVisibilityChange);
    renderActive();
    if (typeof window.renderSubmissions === 'function') {
      try { await window.renderSubmissions(); } catch (_) {}
    }
  }

  function unmount() {
    document.removeEventListener('click', onClick);
    document.removeEventListener('visibilitychange', onVisibilityChange);
  }

  // SPA entry point.
  window.ProxReceivedView = { mount, unmount };

  // Legacy standalone-page entry point (received.html). Skip when running
  // inside the SPA shell (data-page === 'app'); the router calls mount().
  window.addEventListener('DOMContentLoaded', () => {
    const page = document.body && document.body.dataset && document.body.dataset.page;
    if (page === 'app') return;
    if (!isDashboardPage()) return;
    mount();
  });
})();
