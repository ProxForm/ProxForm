// © 2026 Artivicolab. All rights reserved. ProxForm — proprietary software. See LICENSE.
// ProxForm crypto primitives — PBKDF2 → AES-GCM, with compression + base64url.
// Lifted from btwinus. Same parameters (100k iters, 16-byte salt, 12-byte IV).

const WORDS = [
  'blue','red','swift','storm','fox','wolf','river','stone',
  'fire','moon','dark','cloud','rain','wind','star','snow',
  'oak','iron','gold','ghost','amber','coral','jade','onyx',
  'sage','frost','dusk','ember','ridge','vale'
];

function genPassphrase() {
  const pick = () => WORDS[Math.floor(Math.random() * WORDS.length)];
  const num  = String(crypto.getRandomValues(new Uint16Array(1))[0] % 9000 + 1000);
  return `${pick()}-${pick()}-${pick()}-${num}`;
}

async function deriveKey(passphrase, salt) {
  const raw = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(passphrase),
    'PBKDF2', false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    raw,
    { name: 'AES-GCM', length: 256 },
    false, ['encrypt', 'decrypt']
  );
}

async function encryptText(text, passphrase) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv   = crypto.getRandomValues(new Uint8Array(12));
  const key  = await deriveKey(passphrase, salt);
  const enc  = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, key, new TextEncoder().encode(text)
  );
  const out = new Uint8Array(16 + 12 + enc.byteLength);
  out.set(salt, 0);
  out.set(iv, 16);
  out.set(new Uint8Array(enc), 28);
  return toB64(out);
}

async function decryptText(encoded, passphrase) {
  const buf  = fromB64(encoded);
  const salt = buf.slice(0, 16);
  const iv   = buf.slice(16, 28);
  const data = buf.slice(28);
  const key  = await deriveKey(passphrase, salt);
  const dec  = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
  return new TextDecoder().decode(dec);
}

async function compress(str) {
  const bytes = new TextEncoder().encode(str);
  if (window.CompressionStream) {
    const cs = new CompressionStream('deflate-raw');
    const w  = cs.writable.getWriter();
    w.write(bytes); w.close();
    const chunks = [];
    const r = cs.readable.getReader();
    while (true) { const { done, value } = await r.read(); if (done) break; chunks.push(value); }
    let len = 0; for (const c of chunks) len += c.length;
    const out = new Uint8Array(len); let off = 0;
    for (const c of chunks) { out.set(c, off); off += c.length; }
    return toB64(out);
  }
  return toB64(bytes);
}

async function decompress(str) {
  const bytes = fromB64(str);
  if (window.DecompressionStream) {
    try {
      const ds = new DecompressionStream('deflate-raw');
      const w  = ds.writable.getWriter();
      w.write(bytes); w.close();
      const chunks = [];
      const r = ds.readable.getReader();
      while (true) { const { done, value } = await r.read(); if (done) break; chunks.push(value); }
      let len = 0; for (const c of chunks) len += c.length;
      const out = new Uint8Array(len); let off = 0;
      for (const c of chunks) { out.set(c, off); off += c.length; }
      return new TextDecoder().decode(out);
    } catch (_) {}
  }
  return new TextDecoder().decode(bytes);
}

function toB64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function fromB64(str) {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function genNonce() {
  return Array.from(crypto.getRandomValues(new Uint8Array(8)))
    .map(b => b.toString(16).padStart(2, '0')).join('');
}

async function computeSessionCode(a, b) {
  const [n1, n2] = [a, b].sort();
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(n1 + n2));
  return Array.from(new Uint8Array(buf)).slice(0, 6)
    .map(x => x.toString(16).padStart(2, '0').toUpperCase())
    .join('·');
}
