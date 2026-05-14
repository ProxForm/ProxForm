// ProxForm local persistence — IndexedDB-backed drafts so a refresh doesn't lose work.
// All data stays on the user's device. No network call from this module.

const DB_NAME = 'proxform';
const DB_VERSION = 1;
const STORES = ['builder_drafts', 'fill_drafts'];

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
  clearFillDraft:    (key)        => dbDelete('fill_drafts', key)
};
