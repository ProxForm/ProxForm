// © 2026 Artivicolab. All rights reserved. ProxForm — proprietary software. See LICENSE.
// ProxForm — form-definition import. Two formats supported:
//
//   1. Indented: human-friendly, custom syntax (see /help.html).
//   2. JSON:     either an exported form object {form, answers, ...} or a raw
//                form object {title, description, fields: [...]}.

(function () {
  const TYPES = new Set(['text', 'textarea', 'number', 'date', 'radio', 'checkbox', 'yesno', 'file', 'signature']);
  const STRUCT_TYPES = new Set(['section', 'pagebreak']);

  // ── Preprocessor ───────────────────────────────────────────────────────
  // Normalises raw input before parsing so common copy-paste mishaps don't
  // become parser errors: BOM, smart-quote pastes, mixed line endings, tabs
  // vs spaces, trailing whitespace, NBSP / zero-width spaces.
  function normalizeInput(src) {
    let s = String(src);
    if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1);          // strip BOM
    s = s.replace(/\r\n?/g, '\n');                            // CRLF / CR → LF
    s = s.replace(/\t/g, '    ');                             // tabs → 4 spaces
    s = s.replace(/[ ​‌‍]/g, ' ');        // NBSP / ZWSP → space
    s = s.replace(/[“”]/g, '"');                    // smart double quotes
    s = s.replace(/[‘’]/g, "'");                    // smart single quotes
    s = s.split('\n').map(line => line.replace(/[ \t]+$/, '')).join('\n');  // trim line ends
    s = s.replace(/^\s*\n+/, '').replace(/\n\s*$/, '\n');     // strip leading blank lines
    return s;
  }

  // ── Post-parse validator ───────────────────────────────────────────────
  // Catches structural problems the per-line parser can't see: zero fields,
  // empty labels, dangling sections, leading/trailing pagebreaks, radio /
  // checkbox without options, unknown column widths, etc. Throws on the
  // first error so the import dialog can surface it.
  function validateForm(form) {
    if (!form || typeof form !== 'object') throw new Error('Form is empty.');
    const fields = Array.isArray(form.fields) ? form.fields : [];
    if (!fields.length) throw new Error('Form has no fields.');

    const labels = new Set();
    let hasInput = false;
    let lastWasPagebreak = false;
    let firstNonStructural = -1;

    for (let i = 0; i < fields.length; i++) {
      const f = fields[i];
      if (!f || typeof f !== 'object' || !f.type) {
        throw new Error('Field at position ' + (i + 1) + ' is malformed.');
      }
      const t = f.type;
      const label = (f.label || '').trim();

      if (t === 'section') {
        if (!label) throw new Error('Section at position ' + (i + 1) + ' has no title.');
        lastWasPagebreak = false;
        continue;
      }
      if (t === 'pagebreak') {
        if (i === 0)               throw new Error('A page break cannot be the very first field.');
        if (i === fields.length-1) throw new Error('A page break cannot be the very last field.');
        if (lastWasPagebreak)      throw new Error('Two page breaks in a row at position ' + (i + 1) + '.');
        lastWasPagebreak = true;
        continue;
      }
      if (!STRUCT_TYPES.has(t) && !TYPES.has(t)) {
        throw new Error('Field "' + (label || '?') + '" has an unknown type "' + t + '".');
      }
      if (!label) {
        throw new Error('Question at position ' + (i + 1) + ' has no label.');
      }
      if (labels.has(label.toLowerCase())) {
        // Same-label duplicates are usually a copy-paste mistake — warn but allow.
      } else {
        labels.add(label.toLowerCase());
      }
      if ((t === 'radio' || t === 'checkbox')) {
        const opts = Array.isArray(f.options) ? f.options.filter(s => String(s).trim()) : [];
        if (!opts.length) throw new Error('"' + label + '" (' + t + ') needs at least one option.');
        if (new Set(opts.map(s => String(s).trim().toLowerCase())).size !== opts.length) {
          throw new Error('"' + label + '" (' + t + ') has duplicate options.');
        }
      }
      if (f.column && !['full','half','third','quarter'].includes(f.column)) {
        throw new Error('"' + label + '" has an unknown width "' + f.column + '".');
      }
      hasInput = true;
      if (firstNonStructural < 0) firstNonStructural = i;
      lastWasPagebreak = false;
    }
    if (!hasInput) throw new Error('Form has only sections / page breaks — no questions.');
    return true;
  }

  // ── Indented format ────────────────────────────────────────────────────
  // title: ...
  // description: ...
  // # Section name
  // <type>[*] [half|full] Field label
  //     - option            (only for radio/checkbox)
  //     - option
  //
  // `*` after the type marks the field as required.
  // `half` makes it share a row with the next half-width field.
  // Lines starting with // or # outside a section start are ignored as comments.
  function parseIndented(src) {
    const lines = normalizeInput(src).split('\n');
    const out = { title: '', description: '', fields: [] };
    let nextId = 1;
    let lastField = null;

    for (let lineNo = 0; lineNo < lines.length; lineNo++) {
      const raw = lines[lineNo];
      if (!raw.trim()) { continue; }

      // Comment: a line whose first non-space chars are //
      if (/^\s*\/\//.test(raw)) continue;

      // Indented option line: "  - value"  (only valid right after radio/checkbox)
      const optMatch = /^\s+-\s+(.+?)\s*$/.exec(raw);
      if (optMatch && lastField && (lastField.type === 'radio' || lastField.type === 'checkbox')) {
        lastField.options = lastField.options || [];
        lastField.options.push(optMatch[1]);
        continue;
      }

      // Indented "> text" line: attaches a hint to the field above, or a
      // description to the section above.
      const hintMatch = /^\s+>\s+(.+?)\s*$/.exec(raw);
      if (hintMatch && lastField) {
        if (lastField.type === 'section') lastField.description = hintMatch[1];
        else lastField.hint = hintMatch[1];
        continue;
      }

      // Indented "= value" line: pre-fills the default for the field above.
      // Checkbox accumulates multiple "=" lines into an array; every other
      // type takes a single value (later "=" overwrites the earlier one).
      const defaultMatch = /^\s+=\s+(.+?)\s*$/.exec(raw);
      if (defaultMatch && lastField && lastField.type !== 'section') {
        const v = defaultMatch[1];
        if (lastField.type === 'checkbox') {
          if (!Array.isArray(lastField.default)) lastField.default = [];
          lastField.default.push(v);
        } else {
          lastField.default = v;
        }
        continue;
      }

      // Indented "! key=value" line: validation rule for the field above.
      // Supported keys: min, max (numbers); minlen, maxlen (text/textarea);
      // pattern (text only — JS regex without slashes).
      const valMatch = /^\s+!\s+(\w+)\s*=\s*(.+?)\s*$/.exec(raw);
      if (valMatch && lastField && lastField.type !== 'section') {
        const k = valMatch[1].toLowerCase();
        const raw2 = valMatch[2];
        if (!lastField.validation) lastField.validation = {};
        if (k === 'min' || k === 'max') {
          const n = Number(raw2);
          if (!isNaN(n)) lastField.validation[k] = n;
        } else if (k === 'minlen' || k === 'maxlen') {
          const n = parseInt(raw2, 10);
          if (!isNaN(n)) lastField.validation[k] = n;
        } else if (k === 'pattern') {
          lastField.validation.pattern = raw2;
        } else if (k === 'maxsize') {
          const n = Number(raw2);
          if (!isNaN(n) && n > 0) lastField.validation.maxsize = n;
        } else if (k === 'minwidth' || k === 'maxwidth' || k === 'minheight' || k === 'maxheight') {
          const n = parseInt(raw2, 10);
          if (!isNaN(n) && n > 0) lastField.validation[k] = n;
        }
        continue;
      }

      const trimmed = raw.trim();

      // Meta: title: / description: / numbered:
      const meta = /^(title|description|numbered)\s*:\s*(.*)$/i.exec(trimmed);
      if (meta) {
        const key = meta[1].toLowerCase();
        if (key === 'numbered') {
          const v = meta[2].trim().toLowerCase();
          out.numbered = v === 'true' || v === 'yes' || v === '1' || v === 'on';
        } else {
          out[key] = meta[2].trim();
        }
        lastField = null;
        continue;
      }

      // Section header: # Section title
      const sec = /^#\s+(.*)$/.exec(trimmed);
      if (sec) {
        const f = { id: 'f' + (nextId++), type: 'section', label: sec[1].trim() };
        out.fields.push(f);
        lastField = f;
        continue;
      }

      // Page break: --- [optional page name]
      const pb = /^---(?:\s+(.*))?$/.exec(trimmed);
      if (pb) {
        const f = { id: 'f' + (nextId++), type: 'pagebreak', label: (pb[1] || '').trim() };
        out.fields.push(f);
        lastField = f;
        continue;
      }

      // Field: type[*] [half|full|third|quarter] label
      const fld = /^(\w+)(\*?)\s+(?:(half|full|third|quarter)\s+)?(.+)$/i.exec(trimmed);
      if (fld) {
        const type = fld[1].toLowerCase();
        if (!TYPES.has(type)) {
          throw new Error(`Line ${lineNo + 1}: unknown field type "${fld[1]}". ` +
            `Use one of: ${[...TYPES].join(', ')}, or "#" for sections.`);
        }
        const f = {
          id: 'f' + (nextId++),
          type,
          label: fld[4].trim(),
          required: !!fld[2],
          column: (fld[3] || 'full').toLowerCase()
        };
        if (type === 'radio' || type === 'checkbox') f.options = [];
        out.fields.push(f);
        lastField = f;
        continue;
      }

      throw new Error(`Line ${lineNo + 1}: could not parse "${trimmed.slice(0, 60)}". ` +
        `Expected "title:", "description:", "# Section", or "<type> Question".`);
    }

    // Final validation: every radio/checkbox needs at least one option
    for (const f of out.fields) {
      if ((f.type === 'radio' || f.type === 'checkbox') && (!f.options || !f.options.length)) {
        throw new Error(`Field "${f.label || f.id}" (${f.type}) needs at least one option ` +
          `(indented "- value" lines below it).`);
      }
    }

    return out;
  }

  // ── JSON format ────────────────────────────────────────────────────────
  // Accepts either the export shape ({form: {...}, answers: {...}}) or a raw
  // form object ({title, description, fields: [...]}).
  function lineColFromPosition(src, pos) {
    let line = 1, col = 1;
    const n = Math.min(pos, src.length);
    for (let i = 0; i < n; i++) {
      if (src.charCodeAt(i) === 10) { line++; col = 1; } else { col++; }
    }
    return { line, col };
  }

  // Try to recover the offset of a JSON.parse failure across V8 generations.
  // Old V8 / SpiderMonkey: "...at position 42" or "...at line 3 column 5".
  // Modern V8 (Chrome 117+, Node 21+): no position; instead the message
  // embeds a snippet of the source like: ... "{"a": ,}" is not valid JSON.
  // We extract the snippet and search the source for its offset.
  function jsonErrorOffset(msg, src) {
    let m = /position\s+(\d+)/i.exec(msg);
    if (m) return parseInt(m[1], 10);
    m = /line\s+(\d+)\s+column\s+(\d+)/i.exec(msg);
    if (m) {
      const ln = parseInt(m[1], 10), col = parseInt(m[2], 10);
      let off = 0, seen = 1;
      while (seen < ln && off < src.length) {
        if (src.charCodeAt(off) === 10) seen++;
        off++;
      }
      return off + Math.max(0, col - 1);
    }
    // Modern V8: pull the quoted snippet that comes after `Unexpected token X, `.
    m = /Unexpected token .*?,\s+"([^]+?)"\s+is not valid JSON/i.exec(msg);
    if (m && m[1]) {
      const snippet = m[1];
      const idx = src.indexOf(snippet);
      if (idx !== -1) return idx;
    }
    return -1;
  }

  function parseJSON(src) {
    const normalized = normalizeInput(src);
    let obj;
    try { obj = JSON.parse(normalized); }
    catch (e) {
      const msg = e && e.message ? String(e.message) : String(e);
      const off = jsonErrorOffset(msg, normalized);
      let where = '';
      if (off >= 0) {
        const { line, col } = lineColFromPosition(normalized, off);
        where = ` at line ${line}, column ${col}`;
      }
      throw new Error('Invalid JSON' + where + ' — ' + msg + '. Check for stray commas, missing quotes, or unescaped characters.');
    }
    const form = obj && typeof obj === 'object' && obj.form ? obj.form : obj;
    if (!form || !Array.isArray(form.fields)) {
      throw new Error('JSON must have a "fields" array (or be an exported form object).');
    }
    let nextId = 1;
    const fields = form.fields.map((f, i) => {
      if (!f || typeof f !== 'object') throw new Error(`fields[${i}] must be an object`);
      const type = String(f.type || '').toLowerCase();
      if (!STRUCT_TYPES.has(type) && !TYPES.has(type)) {
        throw new Error(`fields[${i}]: unknown type "${f.type}"`);
      }
      const out = {
        id: f.id || ('f' + (nextId++)),
        type,
        label: String(f.label || '').trim()
      };
      if (type === 'section') {
        if (f.description && String(f.description).trim()) out.description = String(f.description).trim();
      } else if (type === 'pagebreak') {
        // Slim shape — only id/type/label survive.
      } else {
        out.required = !!f.required;
        out.column   = ['half', 'third', 'quarter'].indexOf(f.column) !== -1 ? f.column : 'full';
        if (f.hint && String(f.hint).trim()) out.hint = String(f.hint).trim();
        if (type === 'file' && f.accept) out.accept = String(f.accept);
        if (f.default != null) {
          if (Array.isArray(f.default)) {
            const arr = f.default.map(String).filter(s => s.length);
            if (arr.length) out.default = arr;
          } else if (String(f.default).trim() !== '') {
            out.default = String(f.default).trim();
          }
        }
        if (f.validation && typeof f.validation === 'object') {
          const v = f.validation;
          const vOut = {};
          if (v.min     != null && !isNaN(Number(v.min)))    vOut.min    = Number(v.min);
          if (v.max     != null && !isNaN(Number(v.max)))    vOut.max    = Number(v.max);
          if (v.minlen  != null && !isNaN(Number(v.minlen))) vOut.minlen = Number(v.minlen);
          if (v.maxlen  != null && !isNaN(Number(v.maxlen))) vOut.maxlen = Number(v.maxlen);
          if (v.pattern && String(v.pattern).trim())         vOut.pattern = String(v.pattern).trim();
          if (v.maxsize  != null && !isNaN(Number(v.maxsize)) && Number(v.maxsize) > 0) vOut.maxsize = Number(v.maxsize);
          for (const k of ['minwidth', 'maxwidth', 'minheight', 'maxheight']) {
            if (v[k] != null && !isNaN(Number(v[k])) && Number(v[k]) > 0) vOut[k] = Number(v[k]);
          }
          if (Object.keys(vOut).length) out.validation = vOut;
        }
        if (f.showIf && typeof f.showIf === 'object' && f.showIf.field && f.showIf.op) {
          out.showIf = {
            field: String(f.showIf.field),
            op:    String(f.showIf.op),
            value: f.showIf.value != null ? String(f.showIf.value) : ''
          };
        }
      }
      if (Array.isArray(f.options) && f.options.length) {
        out.options = f.options.map(String);
      } else if (type === 'radio' || type === 'checkbox') {
        out.options = [];
      }
      return out;
    });
    return {
      title:       String(form.title || ''),
      description: String(form.description || ''),
      numbered:    !!form.numbered,
      fields
    };
  }

  // Auto-detect: if the first non-blank char is "{" or "[", treat as JSON.
  function parseAuto(src) {
    const s = normalizeInput(src).trim();
    if (!s) throw new Error('Definition is empty.');
    const parsed = (s.startsWith('{') || s.startsWith('['))
      ? parseJSON(s)
      : parseIndented(s);
    validateForm(parsed);
    return parsed;
  }

  // ── Serializer: form → YAML-style indented text ────────────────────────
  // Inverse of parseIndented. Columns are padded so the output reads cleanly
  // in a plain text editor. Round-trips through parseIndented losslessly for
  // the v1 field schema.
  function toIndented(form) {
    const out = [];
    if (form && form.title)       out.push('title: ' + String(form.title));
    if (form && form.description) out.push('description: ' + String(form.description));
    if (form && form.numbered)    out.push('numbered: true');

    const fields = (form && Array.isArray(form.fields)) ? form.fields : [];
    for (const f of fields) {
      if (!f || !f.type) continue;
      if (f.type === 'section') {
        if (out.length) out.push('');
        out.push('# ' + String(f.label || ''));
        if (f.description && String(f.description).trim()) {
          out.push('                 > ' + String(f.description).trim());
        }
        continue;
      }
      if (f.type === 'pagebreak') {
        if (out.length) out.push('');
        const lbl = String(f.label || '').trim();
        out.push(lbl ? '--- ' + lbl : '---');
        continue;
      }
      const star = f.required ? '*' : '';
      const mod  = ['half', 'third', 'quarter'].indexOf(f.column) !== -1 ? f.column : '';
      const typeCol = (f.type + star).padEnd(9, ' ');
      const modCol  = mod.padEnd(9, ' ');
      out.push(typeCol + modCol + String(f.label || ''));
      if (f.hint && String(f.hint).trim()) {
        out.push('                 > ' + String(f.hint).trim());
      }
      if ((f.type === 'radio' || f.type === 'checkbox') && Array.isArray(f.options)) {
        for (const opt of f.options) {
          out.push('                 - ' + String(opt));
        }
      }
      if (f.default != null) {
        if (Array.isArray(f.default)) {
          for (const v of f.default) {
            if (String(v).trim()) out.push('                 = ' + String(v).trim());
          }
        } else if (String(f.default).trim()) {
          out.push('                 = ' + String(f.default).trim());
        }
      }
      if (f.validation && typeof f.validation === 'object') {
        const v = f.validation;
        for (const k of ['min', 'max', 'minlen', 'maxlen', 'pattern', 'maxsize', 'minwidth', 'maxwidth', 'minheight', 'maxheight']) {
          if (v[k] == null || v[k] === '') continue;
          out.push('                 ! ' + k + '=' + String(v[k]));
        }
      }
    }
    return out.join('\n') + '\n';
  }

  // ── Summary for the standalone validator UI ───────────────────────────
  // Counts each kind of field so /import.html can show a quick breakdown
  // when validation succeeds. Pages = pagebreaks + 1.
  function summarize(form) {
    const fields = (form && Array.isArray(form.fields)) ? form.fields : [];
    const byType = Object.create(null);
    let questions = 0, sections = 0, pagebreaks = 0;
    for (const f of fields) {
      const t = f && f.type;
      if (!t) continue;
      byType[t] = (byType[t] || 0) + 1;
      if (t === 'section')        sections++;
      else if (t === 'pagebreak') pagebreaks++;
      else                        questions++;
    }
    return {
      total: fields.length,
      questions,
      sections,
      pages: pagebreaks + 1,
      byType
    };
  }

  // Detect format the same way parseAuto does.
  function detectFormat(src) {
    const s = normalizeInput(src).trim();
    if (!s) return 'empty';
    return (s[0] === '{' || s[0] === '[') ? 'json' : 'yaml';
  }

  window.ProxImport = {
    parseIndented, parseJSON, parseAuto, toIndented,
    normalizeInput, validateForm, summarize, detectFormat
  };

  // ── Standalone /import.html view (and #/import in the SPA shell) ──────
  //
  // Wires the textarea + file picker + Create/Validate/Clear buttons. Used
  // by both legacy import.html (DOMContentLoaded) and the SPA router (which
  // calls ProxImportView.mount(host) after injecting the view fragment).

  function $(id) { return document.getElementById(id); }

  function toast(msg) {
    const el = $('toast');
    if (!el) { console.warn(msg); return; }
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.add('hidden'), 3000);
  }

  function showError(msg) {
    hideResult();
    const el = $('import-error');
    if (!el) return;
    el.textContent = msg;
    el.classList.remove('hidden');
  }
  function hideError()  { $('import-error')?.classList.add('hidden'); }
  function hideResult() {
    const el = $('import-result');
    if (!el) return;
    el.classList.add('hidden');
    el.innerHTML = '';
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => (
      { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]
    ));
  }
  function showSuccess(parsed, format) {
    hideError();
    const stats = summarize(parsed);
    const typeBits = Object.keys(stats.byType).sort().map(k =>
      `<span class="kv"><strong>${stats.byType[k]}</strong> ${escapeHtml(k)}</span>`
    ).join('');
    const fmtLabel = format === 'json' ? 'JSON' : 'YAML-style';
    const title = escapeHtml(parsed.title || '(untitled form)');
    let pretty = '';
    if (format === 'json') {
      try { pretty = JSON.stringify(parsed, null, 2); } catch (_) {}
    }
    const prettyBlock = pretty
      ? `<details class="import-result-pretty"><summary>Pretty-printed JSON</summary><pre><code>${escapeHtml(pretty)}</code></pre></details>`
      : '';
    const el = $('import-result');
    if (!el) return;
    el.innerHTML =
      `<div class="import-result-head"><span class="ok-badge">Valid ${fmtLabel}</span> <strong>${title}</strong></div>` +
      `<div class="import-result-stats">` +
        `<span class="kv"><strong>${stats.questions}</strong> question${stats.questions === 1 ? '' : 's'}</span>` +
        `<span class="kv"><strong>${stats.sections}</strong> section${stats.sections === 1 ? '' : 's'}</span>` +
        `<span class="kv"><strong>${stats.pages}</strong> page${stats.pages === 1 ? '' : 's'}</span>` +
        (typeBits ? `<span class="kv-sep">·</span>${typeBits}` : '') +
      `</div>` +
      prettyBlock;
    el.classList.remove('hidden');
  }
  async function readFile() {
    const inp = $('import-file');
    const f = inp && inp.files && inp.files[0];
    return f ? await f.text() : null;
  }

  async function bootstrapStorage() {
    if (!window.ProxStore) return;
    const status = await ProxStore.checkStorage();
    if (!status.ok) toast('Storage unavailable: cannot save the imported form.');
    try { await ProxStore.migrateLegacyDraftIfNeeded(); } catch (_) {}
  }

  async function mount() {
    if (window.ProxNet) ProxNet.checkAndDisplay('net-status');
    await bootstrapStorage();

    $('import-file')?.addEventListener('change', async () => {
      try { const t = await readFile(); if (t) $('import-text').value = t; }
      catch (_) {}
    });

    $('btn-import-clear')?.addEventListener('click', () => {
      const t = $('import-text'); if (t) t.value = '';
      const f = $('import-file'); if (f) f.value = '';
      hideError();
      hideResult();
    });

    $('btn-import-validate')?.addEventListener('click', async () => {
      hideError();
      hideResult();
      let text = $('import-text')?.value || '';
      if (!text.trim()) {
        try { text = await readFile() || ''; } catch (_) {}
      }
      if (!text.trim()) { showError('Paste a definition or pick a file first.'); return; }
      const format = detectFormat(text);
      let parsed;
      try { parsed = parseAuto(text); }
      catch (e) { showError(e.message || String(e)); return; }
      showSuccess(parsed, format);
    });

    $('btn-import-do')?.addEventListener('click', async () => {
      hideError();
      hideResult();
      let text = $('import-text')?.value || '';
      if (!text.trim()) {
        try { text = await readFile() || ''; } catch (_) {}
      }
      if (!text.trim()) { showError('Paste a definition or pick a file first.'); return; }
      let parsed;
      try { parsed = parseAuto(text); }
      catch (e) { showError(e.message || String(e)); return; }
      try {
        const created = await ProxStore.createForm({
          title:       parsed.title || 'Imported form',
          description: parsed.description || '',
          fields:      parsed.fields || []
        });
        if (window.ProxRouter) ProxRouter.go('build', created.id);
        else location.href = '/builder.html?form=' + encodeURIComponent(created.id);
      } catch (e) {
        showError('Could not save the imported form: ' + (e.message || e));
      }
    });
  }

  function unmount() { /* listeners are on cloned elements; GC handles them */ }

  window.ProxImportView = { mount, unmount };

  // Legacy import.html entry point.
  document.addEventListener('DOMContentLoaded', () => {
    const page = document.body && document.body.dataset && document.body.dataset.page;
    if (page === 'app') return; // SPA router will call mount()
    if (!$('import-text')) return; // not on the import view
    mount();
  });
})();
