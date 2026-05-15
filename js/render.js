// © 2026 Artivicolab. All rights reserved. ProxForm — proprietary software. See LICENSE.
// ProxForm — shared form renderer.
// Used by fill.html (live, interactive) and builder.html (preview, disabled).

function _esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Render a single input field cell. opts: { disabled, key }.
// `key` namespaces radio `name` attributes so a preview and a live form on the
// same page (or a stale preview cell still in the DOM) don't share radio groups.
function fieldCell(f, opts) {
  opts = opts || {};
  const disabled = opts.disabled ? ' disabled' : '';
  const req = f.required && !opts.disabled ? ' required' : '';
  const key = opts.key || 'live';
  const reqStar = f.required ? ' <span class="req">*</span>' : '';
  const half = f.column === 'half' ? 'half' : 'full';
  const numPrefix = opts.qNum != null ? `<span class="intake-num">${opts.qNum}.</span> ` : '';
  const label = `<div class="intake-label">${numPrefix}${_esc(f.label || '(untitled question)')}${reqStar}</div>`;
  const hint = f.hint ? `<div class="intake-hint">${_esc(f.hint)}</div>` : '';

  // HTML5 validation attributes — only emitted on the live patient view
  // (skipped when the input is rendered as a disabled preview cell).
  const v = (f.validation && !opts.disabled) ? f.validation : {};
  const minAttr     = v.min     != null ? ` min="${_esc(v.min)}"`            : '';
  const maxAttr     = v.max     != null ? ` max="${_esc(v.max)}"`            : '';
  const minLenAttr  = v.minlen  != null ? ` minlength="${_esc(v.minlen)}"`   : '';
  const maxLenAttr  = v.maxlen  != null ? ` maxlength="${_esc(v.maxlen)}"`   : '';
  const patternAttr = v.pattern         ? ` pattern="${_esc(v.pattern)}"`    : '';
  const validityTitle = v.pattern
    ? ` title="Value must match the format: ${_esc(v.pattern)}"`
    : '';

  // Default value handling — pre-fills inputs (in both preview and patient view).
  // Patient-side fill.js separately seeds the `answers` map so a submit without
  // edits still carries the defaults through.
  const def = f.default;
  const defStr = (def != null && !Array.isArray(def)) ? String(def) : '';
  const defSet = Array.isArray(def) ? new Set(def.map(String)) : null;
  const yesnoChoice = defStr.toLowerCase() === 'yes' ? 'yes'
                    : defStr.toLowerCase() === 'no'  ? 'no'
                    : null;

  let body = '';
  if (f.type === 'text') {
    const val = defStr ? ` value="${_esc(defStr)}"` : '';
    body = `<input type="text" data-field="${f.id}" data-type="text"${val}${minLenAttr}${maxLenAttr}${patternAttr}${validityTitle}${req}${disabled}>`;
  } else if (f.type === 'textarea') {
    body = `<textarea data-field="${f.id}" data-type="textarea" rows="3"${minLenAttr}${maxLenAttr}${req}${disabled}>${_esc(defStr)}</textarea>`;
  } else if (f.type === 'number') {
    const val = defStr ? ` value="${_esc(defStr)}"` : '';
    body = `<input type="number" data-field="${f.id}" data-type="number"${val}${minAttr}${maxAttr}${req}${disabled}>`;
  } else if (f.type === 'date') {
    const val = defStr ? ` value="${_esc(defStr)}"` : '';
    body = `<input type="date" data-field="${f.id}" data-type="date"${val}${req}${disabled}>`;
  } else if (f.type === 'yesno') {
    body = `
      <div class="choices inline">
        <label><input type="radio" name="${f.id}-${key}" data-field="${f.id}" data-type="yesno" value="yes"${yesnoChoice === 'yes' ? ' checked' : ''}${req}${disabled}> Yes</label>
        <label><input type="radio" name="${f.id}-${key}" data-field="${f.id}" data-type="yesno" value="no"${yesnoChoice === 'no' ? ' checked' : ''}${req}${disabled}> No</label>
      </div>`;
  } else if (f.type === 'radio') {
    body = `
      <div class="choices inline">
        ${(f.options || []).map(o => `
          <label><input type="radio" name="${f.id}-${key}" data-field="${f.id}" data-type="radio" value="${_esc(o)}"${defStr === String(o) ? ' checked' : ''}${req}${disabled}> ${_esc(o)}</label>
        `).join('')}
      </div>`;
  } else if (f.type === 'checkbox') {
    body = `
      <div class="choices inline">
        ${(f.options || []).map(o => `
          <label><input type="checkbox" data-field="${f.id}" data-type="checkbox" value="${_esc(o)}"${defSet && defSet.has(String(o)) ? ' checked' : ''}${disabled}> ${_esc(o)}</label>
        `).join('')}
      </div>`;
  } else if (f.type === 'file') {
    const accept = f.accept ? ` accept="${_esc(f.accept)}"` : '';
    const cap = (f.accept || '').startsWith('image/') ? ' capture="environment"' : '';
    body = `<input type="file" data-field="${f.id}" data-type="file"${accept}${cap}${req}${disabled}>
            <div class="file-preview" data-file-preview="${f.id}"></div>`;
  } else if (f.type === 'signature') {
    body = `
      <div class="signature-pad" data-signature="${f.id}"${disabled ? ' data-disabled="1"' : ''}>
        <canvas data-field="${f.id}" data-type="signature" aria-label="Signature pad — sign with your finger, mouse, or stylus"${req}></canvas>
        <div class="signature-pad-actions">
          <span class="signature-hint muted">Sign above</span>
          <button type="button" class="secondary signature-clear" data-signature-clear="${f.id}"${disabled ? ' disabled' : ''}>Clear</button>
        </div>
      </div>`;
  }

  return `<div class="intake-cell ${half}" data-field-id="${f.id}">${label}${hint}${body}</div>`;
}

// Walk the schema, output section bands and pack same-width fields into rows.
// `column` can be 'full' (1/row), 'half' (2/row), 'third' (3/row), or
// 'quarter' (4/row). Mixed widths break the row, the new run starts fresh.
// rowOpts.numbered → cellRenderer receives a running 1-based question number
// as its second argument (sections are skipped in the count).
function _rowCapacity(col) {
  if (col === 'half')    return 2;
  if (col === 'third')   return 3;
  if (col === 'quarter') return 4;
  return 1;
}
function renderIntakeRows(items, cellRenderer, rowOpts) {
  rowOpts = rowOpts || {};
  let out = '';
  let row = [];
  let rowCap = 0;
  let qNum = 0;

  const flushRow = () => {
    if (!row.length) return;
    out += `<div class="intake-row">${row.join('')}</div>`;
    row = [];
    rowCap = 0;
  };

  for (const f of items) {
    if (f.type === 'section') {
      flushRow();
      const desc = f.description ? `<div class="intake-section-desc">${_esc(f.description)}</div>` : '';
      out += `<div class="intake-section">${_esc(f.label || '(untitled section)')}${desc}</div>`;
      continue;
    }
    if (f.type === 'pagebreak') {
      // Pagebreaks are virtual — emitted as a visible divider in non-paginated
      // contexts (clinician's live view, builder preview). The patient view's
      // pagination logic in fill.js splits on them before calling here.
      flushRow();
      const lbl = f.label ? `<span class="intake-pagebreak-label">${_esc(f.label)}</span>` : '';
      out += `<div class="intake-pagebreak" data-field-id="${f.id}">⤵ Page break${lbl}</div>`;
      continue;
    }
    qNum += 1;
    const cell = cellRenderer(f, rowOpts.numbered ? qNum : null);
    const cap = _rowCapacity(f.column);
    if (cap === 1) {
      flushRow();
      out += `<div class="intake-row">${cell}</div>`;
    } else {
      if (rowCap && rowCap !== cap) flushRow();
      row.push(cell);
      rowCap = cap;
      if (row.length === cap) flushRow();
    }
  }
  flushRow();
  return out;
}

window.ProxRender = { fieldCell, renderIntakeRows, escape: _esc };
