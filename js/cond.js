// © 2026 Artivicolab. All rights reserved. ProxForm — proprietary software. See LICENSE.
// ProxForm — conditional-logic evaluator shared by the patient form (fill.js)
// and the builder's test-fill mode. Reads a field's `showIf` rule and the
// current answers map; returns true if the field should be visible.

(function () {
  function isEmptyValue(v) {
    if (v == null) return true;
    if (typeof v === 'string') return v.trim() === '';
    if (Array.isArray(v)) return v.length === 0;
    return false;
  }

  function asString(v) {
    if (v === true)  return 'yes';
    if (v === false) return 'no';
    if (v == null)   return '';
    return String(v);
  }

  // rule: { field, op, value }; answers: map of fieldId → value (string,
  // boolean, number, or string[] for checkbox). Returns boolean.
  function evaluate(rule, answers) {
    if (!rule || !rule.field) return true;
    const v = answers ? answers[rule.field] : undefined;
    const target = rule.value != null ? String(rule.value) : '';
    switch (rule.op) {
      case 'equals':       return asString(v) === target;
      case 'notEquals':    return asString(v) !== target;
      case 'empty':        return isEmptyValue(v);
      case 'notEmpty':     return !isEmptyValue(v);
      case 'contains':     return Array.isArray(v) ? v.map(String).indexOf(target) !== -1
                                                   : asString(v) === target;
      case 'notContains':  return Array.isArray(v) ? v.map(String).indexOf(target) === -1
                                                   : asString(v) !== target;
      default:             return true;
    }
  }

  // Apply visibility to a root that contains intake cells. Walks the field
  // list; cells with a showIf rule that evaluates false get the `hidden-cond`
  // class which CSS sets to display:none. Returns the array of hidden field
  // IDs so callers (e.g. submit-time validation) can skip them.
  function applyVisibility(root, fields, answers) {
    if (!root || !Array.isArray(fields)) return [];
    const hidden = [];
    for (const f of fields) {
      if (!f.showIf || !f.showIf.field) continue;
      const visible = evaluate(f.showIf, answers);
      const cells = root.querySelectorAll('[data-field-id="' + cssEscape(f.id) + '"]');
      cells.forEach(el => el.classList.toggle('hidden-cond', !visible));
      // Also hide the [data-field] inputs in case they're not wrapped in an
      // intake-cell (e.g. answer-view).
      const inputs = root.querySelectorAll('[data-field="' + cssEscape(f.id) + '"]');
      inputs.forEach(el => {
        const cell = el.closest('.intake-cell, .paper-cell');
        if (cell) cell.classList.toggle('hidden-cond', !visible);
      });
      if (!visible) hidden.push(f.id);
    }
    return hidden;
  }

  function cssEscape(s) {
    return String(s).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
  }

  window.ProxCond = { evaluate, applyVisibility, isEmpty: isEmptyValue };
})();
