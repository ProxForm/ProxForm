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
  const label = `<div class="intake-label">${_esc(f.label || '(untitled question)')}${reqStar}</div>`;
  const hint = f.hint ? `<div class="intake-hint">${_esc(f.hint)}</div>` : '';

  let body = '';
  if (f.type === 'text') {
    body = `<input type="text" data-field="${f.id}" data-type="text"${req}${disabled}>`;
  } else if (f.type === 'textarea') {
    body = `<textarea data-field="${f.id}" data-type="textarea" rows="3"${req}${disabled}></textarea>`;
  } else if (f.type === 'number') {
    body = `<input type="number" data-field="${f.id}" data-type="number"${req}${disabled}>`;
  } else if (f.type === 'date') {
    body = `<input type="date" data-field="${f.id}" data-type="date"${req}${disabled}>`;
  } else if (f.type === 'yesno') {
    body = `
      <div class="choices inline">
        <label><input type="radio" name="${f.id}-${key}" data-field="${f.id}" data-type="yesno" value="yes"${req}${disabled}> Yes</label>
        <label><input type="radio" name="${f.id}-${key}" data-field="${f.id}" data-type="yesno" value="no"${req}${disabled}> No</label>
      </div>`;
  } else if (f.type === 'radio') {
    body = `
      <div class="choices inline">
        ${(f.options || []).map(o => `
          <label><input type="radio" name="${f.id}-${key}" data-field="${f.id}" data-type="radio" value="${_esc(o)}"${req}${disabled}> ${_esc(o)}</label>
        `).join('')}
      </div>`;
  } else if (f.type === 'checkbox') {
    body = `
      <div class="choices inline">
        ${(f.options || []).map(o => `
          <label><input type="checkbox" data-field="${f.id}" data-type="checkbox" value="${_esc(o)}"${disabled}> ${_esc(o)}</label>
        `).join('')}
      </div>`;
  }

  return `<div class="intake-cell ${half}">${label}${hint}${body}</div>`;
}

// Walk the schema, output section bands and pair half-width fields into rows.
function renderIntakeRows(items, cellRenderer) {
  let out = '';
  let row = [];

  const flushRow = () => {
    if (!row.length) return;
    out += `<div class="intake-row">${row.join('')}</div>`;
    row = [];
  };

  for (const f of items) {
    if (f.type === 'section') {
      flushRow();
      const desc = f.description ? `<div class="intake-section-desc">${_esc(f.description)}</div>` : '';
      out += `<div class="intake-section">${_esc(f.label || '(untitled section)')}${desc}</div>`;
      continue;
    }
    const cell = cellRenderer(f);
    if (f.column === 'half') {
      row.push(cell);
      if (row.length === 2) flushRow();
    } else {
      flushRow();
      out += `<div class="intake-row">${cell}</div>`;
    }
  }
  flushRow();
  return out;
}

window.ProxRender = { fieldCell, renderIntakeRows, escape: _esc };
