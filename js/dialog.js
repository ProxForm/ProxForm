// © 2026 Artivicolab. All rights reserved. ProxForm — proprietary software. See LICENSE.
// ProxForm — themed confirm dialog. Replaces window.confirm() so destructive
// actions match the pop-art chrome instead of the gray browser default.
//
// Usage:
//   const ok = await ProxConfirm('Delete this form?', {
//     title: 'Delete form',
//     confirmText: 'Delete',
//     danger: true
//   });
//   if (!ok) return;

(function () {
  let dlg = null;

  function ensure() {
    if (dlg && document.body.contains(dlg)) return dlg;
    dlg = document.createElement('dialog');
    dlg.className = 'prox-confirm';
    dlg.innerHTML = `
      <h2 class="prox-confirm-title"></h2>
      <p class="prox-confirm-message"></p>
      <div class="prox-confirm-actions">
        <button type="button" class="secondary" data-act="cancel">Cancel</button>
        <button type="button" class="primary"   data-act="confirm">Confirm</button>
      </div>
    `;
    document.body.appendChild(dlg);
    return dlg;
  }

  function confirmAsync(message, opts) {
    opts = opts || {};
    return new Promise((resolve) => {
      // Native fallback if HTMLDialogElement isn't supported (very old browsers).
      // Keeps destructive flows working even before the polyfill case is hit.
      if (typeof HTMLDialogElement === 'undefined') {
        resolve(window.confirm(message));
        return;
      }

      const d = ensure();
      d.querySelector('.prox-confirm-title').textContent   = opts.title   || 'Are you sure?';
      d.querySelector('.prox-confirm-message').textContent = message      || '';
      const confirmBtn = d.querySelector('[data-act="confirm"]');
      const cancelBtn  = d.querySelector('[data-act="cancel"]');
      confirmBtn.textContent = opts.confirmText || 'Confirm';
      cancelBtn.textContent  = opts.cancelText  || 'Cancel';
      confirmBtn.classList.toggle('danger', !!opts.danger);

      function cleanup(value) {
        confirmBtn.removeEventListener('click', onConfirm);
        cancelBtn.removeEventListener('click', onCancel);
        d.removeEventListener('cancel', onEsc);
        d.removeEventListener('click', onBackdrop);
        try { d.close(); } catch (_) {}
        resolve(value);
      }
      function onConfirm()       { cleanup(true);  }
      function onCancel()        { cleanup(false); }
      function onEsc(e)          { e.preventDefault(); cleanup(false); }
      // Backdrop click (browsers fire click on the <dialog> element when the
      // user clicks outside the inner box) — treat as cancel.
      function onBackdrop(e)     { if (e.target === d) cleanup(false); }

      confirmBtn.addEventListener('click', onConfirm);
      cancelBtn.addEventListener('click', onCancel);
      d.addEventListener('cancel', onEsc);
      d.addEventListener('click', onBackdrop);

      try { d.showModal(); }
      catch (_) {
        d.setAttribute('open', '');
        confirmBtn.focus();
      }
      // Default focus on Cancel so a stray Enter doesn't fire the destructive
      // action.
      cancelBtn.focus();
    });
  }

  window.ProxConfirm = confirmAsync;
})();
