// ProxForm P2P session — WebRTC offer/answer flow.
// Depends on crypto.js (deriveKey, encryptText, decryptText, compress, decompress).

const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];

function waitForICE(conn) {
  return new Promise(resolve => {
    if (conn.iceGatheringState === 'complete') { resolve(); return; }
    const t = setTimeout(resolve, 6000);
    conn.addEventListener('icegatheringstatechange', function h() {
      if (conn.iceGatheringState === 'complete') {
        clearTimeout(t);
        conn.removeEventListener('icegatheringstatechange', h);
        resolve();
      }
    });
  });
}

// Clinician side: create the session and produce a shareable invite URL.
// `fillUrlBase` is the full URL to fill.html (e.g. 'https://proxform.com/fill.html').
async function createSession({ fillUrlBase }) {
  const passphrase = genPassphrase();
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  const channel = pc.createDataChannel('proxform');

  await pc.setLocalDescription(await pc.createOffer());
  await waitForICE(pc);

  const compressed = await compress(JSON.stringify(pc.localDescription));
  const encrypted  = await encryptText(compressed, passphrase);
  const url        = `${fillUrlBase}#offer=${encrypted}`;

  return { pc, channel, passphrase, url, encryptedOffer: encrypted };
}

// Patient side: given an encrypted offer + passphrase, build and return an encrypted answer URL.
async function joinSession({ encryptedOffer, passphrase, replyUrlBase, onChannel }) {
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  pc.addEventListener('datachannel', e => onChannel(e.channel));

  const compressed = await decryptText(encryptedOffer, passphrase); // throws if wrong pass
  const offer      = JSON.parse(await decompress(compressed));
  await pc.setRemoteDescription(new RTCSessionDescription(offer));
  await pc.setLocalDescription(await pc.createAnswer());
  await waitForICE(pc);

  const ansCompressed = await compress(JSON.stringify(pc.localDescription));
  const ansEncrypted  = await encryptText(ansCompressed, passphrase);
  const url           = `${replyUrlBase}#answer=${ansEncrypted}`;

  return { pc, url, encryptedAnswer: ansEncrypted };
}

// Clinician side: complete the connection by consuming the patient's encrypted answer.
async function completeSession({ pc, encryptedAnswer, passphrase }) {
  const compressed = await decryptText(encryptedAnswer, passphrase);
  const answer     = JSON.parse(await decompress(compressed));
  await pc.setRemoteDescription(new RTCSessionDescription(answer));
}

function parseHashParam(name) {
  const h = location.hash.replace(/^#/, '');
  for (const part of h.split('&')) {
    const [k, v] = part.split('=');
    if (k === name) return v;
  }
  return null;
}
