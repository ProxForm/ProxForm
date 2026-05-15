// © 2026 Artivicolab. All rights reserved. ProxForm — proprietary software. See LICENSE.
// ProxForm — shared signature-pad widget. Wires pointer events on a canvas to
// produce a base64 PNG. Used by fill.js (patient view) and the builder's
// test-fill mode so they behave identically.
//
// Usage:
//   ProxSig.attach(padDiv, {
//     getExistingData: (id) => answers[id],   // optional, redraws on attach
//     onStroke:        (id, answer) => { ... },
//     onClear:         (id) => { ... }
//   });
//   ProxSig.clear(padDiv);   // wipes the canvas + fires onClear

(function () {
  function penColor() {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--text').trim();
    return v || '#0f0f0f';
  }

  // Resize the canvas to its CSS size at the device pixel ratio so strokes
  // stay crisp. Preserves whatever is currently drawn so a layout change
  // (e.g. window resize, the patient navigating to a new page) doesn't wipe
  // the signature in progress. Returns the new 2D context.
  function sizeCanvas(canvas) {
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.floor(rect.width));
    const h = Math.max(1, Math.floor(rect.height || 140));
    if (w < 4 || h < 4) return null;
    let snapshot = null;
    if (canvas.width && canvas.height) {
      try { snapshot = canvas.toDataURL('image/png'); } catch (_) {}
    }
    canvas.width  = w * ratio;
    canvas.height = h * ratio;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(ratio, ratio);
    ctx.lineWidth   = 2.2;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';
    ctx.strokeStyle = penColor();
    if (snapshot) {
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0, w, h);
      img.src = snapshot;
    }
    return { ratio, w, h, ctx };
  }

  function drawDataInto(canvas, dataUrl) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const ratio = Math.max(window.devicePixelRatio || 1, 1);
        const ctx = canvas.getContext('2d');
        // Draw at CSS pixel size; ctx is already scaled by ratio from sizeCanvas.
        ctx.drawImage(img, 0, 0, canvas.width / ratio, canvas.height / ratio);
        resolve();
      };
      img.onerror = () => resolve();
      img.src = dataUrl;
    });
  }

  function attach(pad, opts) {
    if (!pad || pad.dataset.disabled === '1' || pad.dataset.sigAttached === '1') return;
    const canvas = pad.querySelector('canvas');
    if (!canvas) return;
    pad.dataset.sigAttached = '1';
    const id = pad.dataset.signature;
    opts = opts || {};

    let dirty = false;
    let drawing = false;
    let ctx;

    const init = () => {
      const s = sizeCanvas(canvas);
      if (s) ctx = s.ctx;
      // Repaint any existing signature so re-renders don't wipe a draft.
      if (opts.getExistingData) {
        const ex = opts.getExistingData(id);
        if (ex && ex.data && (ex.mime || '').startsWith('image/')) {
          drawDataInto(canvas, 'data:' + ex.mime + ';base64,' + ex.data);
        }
      }
    };
    // rAF so layout has settled; plus a ResizeObserver so a delayed display
    // change (sized in a hidden parent) still triggers the resize once visible.
    requestAnimationFrame(init);
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => {
        const s = sizeCanvas(canvas);
        if (s) ctx = s.ctx;
      });
      ro.observe(canvas);
    }

    const pointAt = (e) => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };

    canvas.addEventListener('pointerdown', (e) => {
      if (!ctx) { const s = sizeCanvas(canvas); ctx = s.ctx; }
      // Refresh pen colour in case the theme changed since attach.
      ctx.strokeStyle = penColor();
      drawing = true;
      try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
      const p = pointAt(e);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      e.preventDefault();
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!drawing || !ctx) return;
      e.preventDefault();
      const p = pointAt(e);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      dirty = true;
    });
    const endStroke = (e) => {
      if (!drawing) return;
      drawing = false;
      try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
      if (!dirty) return;
      const dataUrl = canvas.toDataURL('image/png');
      const b64 = dataUrl.split(',')[1] || '';
      const answer = {
        name: 'signature.png',
        mime: 'image/png',
        size: Math.ceil(b64.length * 3 / 4),
        data: b64
      };
      if (opts.onStroke) opts.onStroke(id, answer);
    };
    canvas.addEventListener('pointerup',     endStroke);
    canvas.addEventListener('pointercancel', endStroke);
    canvas.addEventListener('pointerleave',  endStroke);
  }

  function clear(pad) {
    if (!pad) return;
    const canvas = pad.querySelector('canvas');
    if (canvas) {
      const c = canvas.getContext('2d');
      c.save();
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.clearRect(0, 0, canvas.width, canvas.height);
      c.restore();
    }
  }

  window.ProxSig = { attach, clear };
})();
