// © 2026 Artivicolab. All rights reserved. ProxForm — proprietary software. See LICENSE.
// ProxForm — WebRTC connectivity probe.
// WebRTC has no fixed inbound port; what can fail is outbound UDP to STUN and
// NAT-mapped (srflx) candidate gathering. Without srflx, P2P won't traverse NAT.
// We run a short ICE-gather against our STUN server and classify the result.

const NET_ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];
const GATHER_TIMEOUT_MS = 4500;

async function check() {
  const r = {
    supported: false,
    host:  false,   // local-network candidate (always present if WebRTC works at all)
    srflx: false,   // NAT-reflexive — STUN reachable, P2P should traverse
    relay: false,   // TURN — we don't configure one, so this stays false
    state: 'unknown',
    message: ''
  };

  if (typeof RTCPeerConnection === 'undefined') {
    r.state = 'unsupported';
    r.message = 'WebRTC not supported in this browser';
    return r;
  }
  r.supported = true;

  let pc;
  try { pc = new RTCPeerConnection({ iceServers: NET_ICE_SERVERS }); }
  catch (_) {
    r.state = 'blocked';
    r.message = 'WebRTC blocked by browser policy';
    return r;
  }

  // A datachannel is needed so ICE has something to gather for.
  try { pc.createDataChannel('netcheck'); } catch (_) {}

  return new Promise(resolve => {
    let done = false;

    const finish = () => {
      if (done) return;
      done = true;
      try { pc.close(); } catch (_) {}

      if (r.srflx) {
        r.state = 'ok';
        r.message = 'Direct P2P should work — STUN reachable, NAT mapping found';
      } else if (r.host) {
        r.state = 'limited';
        r.message = 'Local network only — outbound UDP to STUN appears blocked. P2P will likely fail across networks (firewall/VPN/restrictive Wi-Fi).';
      } else {
        r.state = 'blocked';
        r.message = 'No ICE candidates gathered — UDP appears fully blocked';
      }
      resolve(r);
    };

    pc.addEventListener('icecandidate', e => {
      if (!e.candidate) { finish(); return; }
      const cand = e.candidate.candidate || '';
      if      (/ typ host/.test(cand))  r.host  = true;
      else if (/ typ srflx/.test(cand)) r.srflx = true;
      else if (/ typ relay/.test(cand)) r.relay = true;
    });
    pc.addEventListener('icegatheringstatechange', () => {
      if (pc.iceGatheringState === 'complete') finish();
    });

    setTimeout(finish, GATHER_TIMEOUT_MS);

    pc.createOffer()
      .then(o => pc.setLocalDescription(o))
      .catch(() => finish());
  });
}

// Render the result into a status badge element in the topbar.
function applyToBadge(el, r) {
  if (!el) return;
  el.classList.remove('net-ok', 'net-limited', 'net-blocked', 'net-unsupported', 'net-checking');
  let cls, label;
  if (r.state === 'ok')             { cls = 'net-ok';          label = '✓ P2P ready'; }
  else if (r.state === 'limited')   { cls = 'net-limited';     label = '⚠ Local only'; }
  else if (r.state === 'blocked')   { cls = 'net-blocked';     label = '✗ UDP blocked'; }
  else if (r.state === 'unsupported') { cls = 'net-unsupported'; label = '✗ No WebRTC'; }
  else                              { cls = 'net-checking';    label = 'Checking…'; }
  el.classList.add(cls);
  el.textContent = label;
  el.title = r.message || '';
}

async function checkAndDisplay(elementId) {
  const el = document.getElementById(elementId);
  if (el) { el.classList.add('net-status', 'net-checking'); el.textContent = 'Checking…'; }
  const r = await check();
  applyToBadge(el, r);
  return r;
}

window.ProxNet = { check, applyToBadge, checkAndDisplay };
