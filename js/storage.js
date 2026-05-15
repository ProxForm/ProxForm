// © 2026 Artivicolab. All rights reserved. ProxForm — proprietary software. See LICENSE.
// ProxForm local persistence — IndexedDB-backed drafts so a refresh doesn't lose work.
// All data stays on the user's device. No network call from this module.

const DB_NAME = 'proxform';
const DB_VERSION = 4;
// `forms` is the clinician's saved templates. `submissions` holds completed
// answer-sets received from patients, persisted on the clinician's own device
// so they survive a tab refresh. `builder_drafts` is kept for the legacy
// single-draft path until the dashboard migrates it on first load.
// `pending_sessions` holds invite metadata for sessions that were active when
// the tab unloaded — sessionId + formSnapshot + senderLabel + state, NEVER
// the invite URL, passphrase, or any patient answers. The old WebRTC peer
// connection is gone after reload, so any old invite link is dead; the
// clinician has to Reopen to mint a fresh portal.
const STORES = ['builder_drafts', 'fill_drafts', 'forms', 'submissions', 'pending_sessions'];

let dbPromise = null;

function isAvailable() {
  return typeof indexedDB !== 'undefined' && indexedDB !== null;
}

function openDb() {
  if (!isAvailable()) return Promise.reject(new Error('indexeddb-unavailable'));
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    let req;
    try { req = indexedDB.open(DB_NAME, DB_VERSION); }
    catch (e) { reject(e); return; }
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of STORES) {
        if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('indexeddb-open-failed'));
    req.onblocked = () => reject(new Error('indexeddb-blocked'));
  });
  return dbPromise;
}

function tx(store, mode, fn) {
  return openDb().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const result = fn(t.objectStore(store));
    t.oncomplete = () => resolve(result && 'result' in result ? result.result : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('tx-aborted'));
  }));
}

async function dbPut(store, key, value)   { return tx(store, 'readwrite', s => s.put(value, key)); }
async function dbGet(store, key)          { return tx(store, 'readonly',  s => s.get(key)); }
async function dbDelete(store, key)       { return tx(store, 'readwrite', s => s.delete(key)); }
async function dbClear(store)             { return tx(store, 'readwrite', s => s.clear()); }

function newFormId() {
  if (crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'f_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

// Forms library — many saved forms, each addressable by an id stored in the
// URL (?form=<id>). A form record is { id, title, description, fields[],
// createdAt, updatedAt }.
async function listForms() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction('forms', 'readonly');
    const req = t.objectStore('forms').getAll();
    req.onsuccess = () => {
      const out = (req.result || []).slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      resolve(out);
    };
    req.onerror = () => reject(req.error);
  });
}
async function getForm(id) { return dbGet('forms', id); }
async function deleteForm(id) { return dbDelete('forms', id); }
async function saveForm(id, form) {
  const now = Date.now();
  const existing = (await getForm(id)) || {};
  const record = {
    ...existing,
    ...form,
    id,
    createdAt: existing.createdAt || form.createdAt || now,
    updatedAt: now
  };
  await dbPut('forms', id, record);
  return record;
}
async function createForm(initial = {}) {
  const id = newFormId();
  return saveForm(id, {
    title: '',
    description: '',
    fields: [],
    ...initial
  });
}

// ── Submissions (received answer-sets) ─────────────────────────────────
// A submission record:
//   { id, formId?, formTitle, formSnapshot, answers, receivedAt }
// formSnapshot is captured at save-time so we can render the answer pairing
// even if the original form template is later deleted.

function newSubmissionId() {
  if (window.crypto && crypto.randomUUID) return 'sub_' + crypto.randomUUID();
  return 'sub_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

async function listSubmissions() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction('submissions', 'readonly');
    const req = t.objectStore('submissions').getAll();
    req.onsuccess = () => {
      // First-come-first-serve — hospital queue ordering. Oldest at the top
      // so the staff treats the front of the column as "next up".
      const out = (req.result || []).slice().sort((a, b) => (a.receivedAt || 0) - (b.receivedAt || 0));
      resolve(out);
    };
    req.onerror = () => reject(req.error);
  });
}

async function getSubmission(id) { return dbGet('submissions', id); }
async function deleteSubmission(id) { return dbDelete('submissions', id); }

async function saveSubmission(record) {
  const id = record.id || newSubmissionId();
  const stored = {
    id,
    formId:       record.formId || null,
    formTitle:    record.formTitle || (record.formSnapshot && record.formSnapshot.title) || 'Untitled form',
    formSnapshot: record.formSnapshot || null,
    answers:      record.answers || {},
    senderLabel:  record.senderLabel || '',
    receivedAt:   record.receivedAt || Date.now()
  };
  await dbPut('submissions', id, stored);
  return stored;
}

// ── Pending sessions (survive reload) ───────────────────────────────────
// Persisted ONLY: sessionId, formSnapshot, formId, senderLabel, state,
// createdAt. NEVER the invite URL or passphrase — those die with the in-
// memory RTCPeerConnection. On reload, ProxSessions reads these and shows
// dormant cards with a "Reopen" button that mints a fresh portal under the
// same sessionId (so the patient's mid-fill draft re-attaches).

async function listPendingSessions() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction('pending_sessions', 'readonly');
    const req = t.objectStore('pending_sessions').getAll();
    req.onsuccess = () => {
      const out = (req.result || []).slice().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      resolve(out);
    };
    req.onerror = () => reject(req.error);
  });
}
async function getPendingSession(id) { return dbGet('pending_sessions', id); }
async function deletePendingSession(id) { return dbDelete('pending_sessions', id); }
async function savePendingSession(record) {
  if (!record || !record.id) throw new Error('savePendingSession: id required');
  const stored = {
    id:           record.id,
    formId:       record.formId || null,
    formSnapshot: record.formSnapshot || null,
    senderLabel:  record.senderLabel || '',
    state:        record.state || 'dormant',
    createdAt:    record.createdAt || Date.now(),
    updatedAt:    Date.now()
  };
  await dbPut('pending_sessions', record.id, stored);
  return stored;
}

// One-shot migration: when the dashboard first loads on a browser that has
// the old single 'current' draft, promote it into a real form so the user's
// in-progress work doesn't vanish. Safe to call repeatedly — no-op once done.
async function migrateLegacyDraftIfNeeded() {
  try {
    const existing = await listForms();
    if (existing.length) return null;
    const legacy = await dbGet('builder_drafts', 'current');
    if (!legacy || !Array.isArray(legacy.fields) || !legacy.fields.length) return null;
    const created = await createForm({
      title:       legacy.title || 'Untitled form',
      description: legacy.description || '',
      fields:      legacy.fields
    });
    await dbDelete('builder_drafts', 'current');
    return created;
  } catch (_) {
    return null;
  }
}

// Ask the browser to keep our data through storage pressure.
// On Chrome/Edge this can grant silently if engagement is high; on Firefox it prompts.
async function requestPersistence() {
  if (!navigator.storage || !navigator.storage.persist) return false;
  try { return await navigator.storage.persist(); } catch (_) { return false; }
}

async function isPersisted() {
  if (!navigator.storage || !navigator.storage.persisted) return false;
  try { return await navigator.storage.persisted(); } catch (_) { return false; }
}

// { ok, reason?, quota?, usage?, freeBytes?, lowSpace? }
// lowSpace = under 5 MB free. Drafts are tiny (KB), so this only fires on a near-full disk.
async function checkStorage() {
  if (!isAvailable()) return { ok: false, reason: 'no-indexeddb' };
  if (!navigator.storage || !navigator.storage.estimate) {
    return { ok: true, quota: null, usage: null, freeBytes: null, lowSpace: false };
  }
  try {
    const { quota = 0, usage = 0 } = await navigator.storage.estimate();
    const freeBytes = Math.max(0, quota - usage);
    return { ok: true, quota, usage, freeBytes, lowSpace: freeBytes < 5 * 1024 * 1024 };
  } catch (_) {
    return { ok: true, quota: null, usage: null, freeBytes: null, lowSpace: false };
  }
}

// Short hex hash for keying drafts by encrypted offer payload.
async function hashKey(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf).slice(0, 8))
    .map(b => b.toString(16).padStart(2, '0')).join('');
}

// Debounce helper for autosave-on-input.
function debounce(fn, ms) {
  let t = null;
  return function (...args) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), ms);
  };
}

window.ProxStore = {
  isAvailable,
  requestPersistence,
  isPersisted,
  checkStorage,
  hashKey,
  debounce,
  saveBuilderDraft:  (key, draft) => dbPut('builder_drafts', key, draft),
  loadBuilderDraft:  (key)        => dbGet('builder_drafts', key),
  clearBuilderDraft: (key)        => dbDelete('builder_drafts', key),
  saveFillDraft:     (key, draft) => dbPut('fill_drafts', key, draft),
  loadFillDraft:     (key)        => dbGet('fill_drafts', key),
  clearFillDraft:    (key)        => dbDelete('fill_drafts', key),
  // Forms library (multi-form dashboard)
  listForms,
  getForm,
  saveForm,
  deleteForm,
  createForm,
  newFormId,
  migrateLegacyDraftIfNeeded,
  // Submissions (received from patients).
  listSubmissions,
  getSubmission,
  saveSubmission,
  deleteSubmission,
  newSubmissionId,
  // Pending sessions (survive a reload — metadata only, no PHI).
  listPendingSessions,
  getPendingSession,
  savePendingSession,
  deletePendingSession,
  // End-of-shift hygiene. Wipes every entry in a store in one transaction.
  // Forms templates are preserved on purpose — wipe them separately if you
  // want a true factory reset.
  clearStore: dbClear
};
