// © 2026 Artivicolab. All rights reserved. ProxForm — proprietary software. See LICENSE.
// ProxForm — form-definition import. Two formats supported:
//
//   1. Indented: human-friendly, custom syntax (see /help.html).
//   2. JSON:     either an exported form object {form, answers, ...} or a raw
//                form object {title, description, fields: [...]}.

(function () {
  const TYPES = new Set(['text', 'textarea', 'number', 'date', 'radio', 'checkbox', 'yesno']);

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
    const lines = String(src).replace(/\r\n/g, '\n').split('\n');
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

      const trimmed = raw.trim();

      // Meta: title: / description:
      const meta = /^(title|description)\s*:\s*(.*)$/i.exec(trimmed);
      if (meta) {
        const key = meta[1].toLowerCase();
        out[key] = meta[2].trim();
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

      // Field: type[*] [half|full] label
      const fld = /^(\w+)(\*?)\s+(?:(half|full)\s+)?(.+)$/i.exec(trimmed);
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
  function parseJSON(src) {
    let obj;
    try { obj = JSON.parse(src); }
    catch (e) { throw new Error('Invalid JSON: ' + e.message); }
    const form = obj && typeof obj === 'object' && obj.form ? obj.form : obj;
    if (!form || !Array.isArray(form.fields)) {
      throw new Error('JSON must have a "fields" array (or be an exported form object).');
    }
    let nextId = 1;
    const fields = form.fields.map((f, i) => {
      if (!f || typeof f !== 'object') throw new Error(`fields[${i}] must be an object`);
      const type = String(f.type || '').toLowerCase();
      if (type !== 'section' && !TYPES.has(type)) {
        throw new Error(`fields[${i}]: unknown type "${f.type}"`);
      }
      const out = {
        id: f.id || ('f' + (nextId++)),
        type,
        label: String(f.label || '').trim()
      };
      if (type !== 'section') {
        out.required = !!f.required;
        out.column   = f.column === 'half' ? 'half' : 'full';
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
      fields
    };
  }

  // Auto-detect: if the first non-blank char is "{" or "[", treat as JSON.
  function parseAuto(src) {
    const s = String(src).trim();
    if (s.startsWith('{') || s.startsWith('[')) return parseJSON(s);
    return parseIndented(s);
  }

  window.ProxImport = { parseIndented, parseJSON, parseAuto };
})();
