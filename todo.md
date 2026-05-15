# ProxForm — Builder TODO

All initial items completed. Kept as a record of what shipped.

## Quick wins

1. ✅ **Duplicate field** — clone button on each row, scrolls + focuses the clone.
2. ✅ **Help text per field** — optional one-liner under each question; `> text` in YAML.
3. ✅ **Section description** — optional subtitle on section bands; same `> text` syntax.
4. ✅ **Saving… / Saved indicator** — pill near the title with bouncing-dots while saving and a shield-shine sweep when saved.
5. ✅ **Default value per field** — pre-fills the patient view; `= value` in YAML, repeat lines for checkbox.
6. ✅ **Test-fill mode** — toggle the preview to interactive so the clinician can rehearse without transmitting.

## Mid-effort

7. ✅ **Form templates** — 5 industry starters (medical, legal, hospitality, HR, wellness) via the *From template…* picker on the forms list.
8. ✅ **Drag-and-drop reorder** — handle on each row, locked by default to prevent accidents, Esc cancels a drag.
9. ✅ **Field validation rules** — `min`/`max` (number), `minlen`/`maxlen` (text/textarea), `pattern` (text). Live `:user-invalid` styling.
10. ✅ **Undo / redo** — structural ops only; `⌘Z` / `⇧⌘Z` keyboard shortcuts + toolbar buttons.
11. ✅ **Form search / filter** — live filter the editor by label/type, count pill, Esc clears.
12. ✅ **Question numbering toggle** — form-level flag; auto-numbers visible questions, skips sections.
13. ✅ **Third / Quarter columns** — generalised the half/full pairing; same-width fields pack into rows.

## Big features

14. ✅ **Conditional logic** — `showIf` rule per field (equals/notEquals/contains/notContains/empty/notEmpty). Live re-evaluation in patient view + test-fill. Hidden required fields skipped on submit. JSON round-trip; YAML deferred.
15. ✅ **Multi-page forms** — `pagebreak` field type; patient view shows Prev/Next with per-page required validation; clinician sees the whole submission flat.
16. ✅ **File / photo upload** — `file` field type with `accept` (image/PDF/any). 5 MB cap. Chunked transfer over the existing WebRTC data channel — no backend, GDPR posture preserved.
17. ✅ **Signature field** — canvas pad (mouse / finger / stylus) → base64 PNG; rides the file chunk transport. Shared `ProxSig` widget used by both the patient view and the builder's test-fill.
18. ✅ **Native PDF export** — covered by the existing tuned print path (paper-style rendering, A4 portrait, `@page margin: 0` suppresses Chromium header/footer chrome). No library bundled.

## Side fixes that shipped along the way

- Pop-art theme (red / yellow / black ink / cream).
- Pop-art jumbotron explainer at the top of the builder.
- Halftone-scrollbar matching the theme.
- Custom `/404.html` with pop-art badge and "where you were probably trying to go" cards.
- `/gdpr.html` consolidating every GDPR-proof claim.
- `/forms.html`, `/received.html`, `/import.html` as standalone pages with unified navigation.
- Parallax background with a mirror overlay on the home page.
- Sticky footer (always at the bottom on short pages).
- Print output rewritten to render a paper-style form — no real `<input>` elements, just labels + underlines + checkbox marks. Consistent across browsers.
- Tooltips across the topbar controls + add-field chips + lock/undo/redo/test-fill buttons.
- Custom scrollbar.

## What's still NOT done (intentionally, for now)

- YAML round-trip for `showIf` (use JSON for now or set it in the builder).
- Multiple files per `file` field (single file in v1).
- File upload progress bar (small files OK without one).
- One-click PDF download (option 3 chosen — Print → Save as PDF is the path).
- Form analytics / submission count per form.
- Email integration / cloud sync (deliberately not built — would break the GDPR-proof architecture).
- Pricing page / paywall.
